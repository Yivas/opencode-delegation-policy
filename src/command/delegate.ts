import type { AgentInspection } from "../setup.js";
import type { PreferenceView } from "../state/effective.js";
import {
  ADVISOR_MODES,
  type GlobalPreferenceChange,
  INTENSITIES,
  MAX_ADVISORS,
  PreferenceStateError,
  ROLE_KEYS,
  type RoleKey,
  type RoleSetting,
} from "../state/schema.js";
import type { PreferenceStore } from "../state/store.js";
import {
  type ModelCatalog,
  type ValidationIssue,
  validatePreferenceAxes,
} from "../validation/models.js";

// The smallest way to set the defaults from inside OpenCode, ahead of the full selector. It writes
// only the global document: agents are created once when the host starts and cannot follow a session,
// so a value that lives only in a session would have no agent to launch. Thinking levels are not
// configurable here; a role runs at whatever its model does by default until that part is built.

export type DelegateCommandPorts = {
  readonly store: Pick<PreferenceStore, "readGlobal" | "saveDefaults">;
  readonly catalog: ModelCatalog;
  // The check of the agents the host actually ended up with. Without it the status has nothing to
  // say about them, and says so instead of looking clean.
  readonly inspect?: () => Promise<AgentInspection>;
};

const COMMAND_NAME = "delegate";

// The name a user types for each role. Typed by RoleKey so a new role cannot be added without a name
// here, and the report walks ROLE_KEYS so it cannot leave one out. `visual-design` is hyphenated
// because that is how the registered agent is spelled.
const ROLE_NAMES: Readonly<Record<RoleKey, string>> = {
  small: "small",
  medium: "medium",
  large: "large",
  visualDesign: "visual-design",
};

function roleKeyFor(name: string | undefined): RoleKey | undefined {
  return ROLE_KEYS.find((key) => ROLE_NAMES[key] === name);
}

const USAGE = [
  "Usage:",
  "  /delegate [status]                     show the saved defaults and whether they work",
  "  /delegate help                         show this text",
  `  /delegate intensity <${INTENSITIES.join("|")}>`,
  `  /delegate advisor-mode <${ADVISOR_MODES.join("|")}>`,
  `  /delegate role <${ROLE_KEYS.map((key) => ROLE_NAMES[key]).join("|")}> <provider/model[#variant]|off|unset>`,
  `  /delegate advisors <off|unset|provider/model[#variant] ...>   up to ${MAX_ADVISORS} models`,
  "",
  "Agents are created when OpenCode starts, so a change takes effect after you restart it.",
].join("\n");

// Whatever follows the command name. The host may pass the whole line or only the arguments, so a
// leading "/delegate" is dropped rather than assumed present.
export function delegateArguments(text: string): string {
  const trimmed = text.trim();
  const slash = `/${COMMAND_NAME}`;
  if (trimmed === slash) return "";
  if (trimmed.startsWith(slash) && /\s/.test(trimmed.charAt(slash.length))) {
    return trimmed.slice(slash.length).trim();
  }
  return trimmed;
}

export async function runDelegate(
  line: string,
  ports: DelegateCommandPorts,
): Promise<string> {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const [subcommand, ...rest] = words;

  if (subcommand === undefined || subcommand === "status") {
    try {
      return await report(await ports.store.readGlobal(), ports, undefined);
    } catch (error) {
      // The same document that would be refused on save has to be explained on read: a command whose
      // whole job is the report cannot answer with a raw rejection. The store's messages carry no
      // stored value. Anything else is a defect and surfaces as one.
      if (error instanceof PreferenceStateError) {
        return `The saved defaults cannot be read: ${error.message}`;
      }
      throw error;
    }
  }
  if (subcommand === "help") return USAGE;

  const change = parseChange(subcommand, rest);
  if (typeof change === "string") return `${change}\n\n${USAGE}`;

  try {
    const view = await ports.store.saveDefaults(change);
    return await report(view, ports, "Saved.");
  } catch (error) {
    if (error instanceof PreferenceStateError) {
      // A write that rejected may still have landed, and the store says so; "Not saved" would
      // contradict it.
      return error.persistence === "unknown"
        ? `Could not confirm the save: ${error.message}`
        : `Not saved: ${error.message}`;
    }
    throw error;
  }
}

// Returns the change to save, or the reason the input cannot be understood.
function parseChange(
  subcommand: string,
  rest: readonly string[],
): GlobalPreferenceChange | string {
  switch (subcommand) {
    case "intensity": {
      const [value, ...extra] = rest;
      if (!isOneOf(INTENSITIES, value) || extra.length > 0) {
        return `intensity takes one of: ${INTENSITIES.join(", ")}.`;
      }
      return { intensity: value };
    }
    case "advisor-mode": {
      const [value, ...extra] = rest;
      if (!isOneOf(ADVISOR_MODES, value) || extra.length > 0) {
        return `advisor-mode takes one of: ${ADVISOR_MODES.join(", ")}.`;
      }
      return { advisorMode: value };
    }
    case "role": {
      const [name, value, ...extra] = rest;
      const key = roleKeyFor(name);
      if (key === undefined || value === undefined || extra.length > 0) {
        return `role takes a name (${ROLE_KEYS.map((role) => ROLE_NAMES[role]).join(", ")}) and a model, off or unset.`;
      }
      return { roles: { [key]: roleSetting(value) } };
    }
    case "advisors": {
      const keyword = rest.find((word) => word === "off" || word === "unset");
      if (keyword !== undefined) {
        // A keyword mixed with models would be saved as a model reference called "off".
        if (rest.length > 1) {
          return `advisors ${keyword} cannot be combined with models.`;
        }
        return {
          advisors: { kind: keyword === "off" ? "disabled" : "unset" },
        };
      }
      if (rest.length === 0) {
        return `advisors takes off, unset or up to ${MAX_ADVISORS} model references.`;
      }
      if (rest.length > MAX_ADVISORS) {
        return `advisors takes at most ${MAX_ADVISORS} models.`;
      }
      return { advisors: { kind: "configured", models: [...rest] } };
    }
    default:
      return `Unknown subcommand "${subcommand}".`;
  }
}

function roleSetting(value: string): RoleSetting {
  if (value === "off") return { kind: "disabled" };
  if (value === "unset") return { kind: "unset" };
  return { kind: "configured", model: value };
}

function isOneOf<T extends string>(
  allowed: readonly T[],
  value: string | undefined,
): value is T {
  return value !== undefined && (allowed as readonly string[]).includes(value);
}

async function report(
  view: PreferenceView,
  ports: DelegateCommandPorts,
  heading: string | undefined,
): Promise<string> {
  const { preferences } = view;
  const lines: string[] = [];
  if (heading !== undefined) lines.push(heading);

  lines.push(
    `Intensity: ${preferences.intensity}`,
    `Advisor mode: ${preferences.advisorMode}`,
  );
  for (const key of ROLE_KEYS) {
    lines.push(
      `Role ${ROLE_NAMES[key]}: ${describeRole(preferences.roles[key])}`,
    );
  }
  lines.push(`Advisors: ${describeAdvisors(preferences.advisors)}`);

  // Saving a value the catalogue does not offer is allowed (a provider may simply be offline), so
  // what the saved defaults actually do is reported separately and never hidden. The validator turns
  // a catalogue failure into its own result; anything it throws is a defect and is not swallowed.
  lines.push(...(await describeValidation(preferences, ports.catalog)));
  lines.push(...(await describeAgents(ports.inspect)));
  lines.push(
    "",
    "Agents are created when OpenCode starts; restart it for changes to take effect.",
  );
  return lines.join("\n");
}

function describeRole(setting: RoleSetting): string {
  if (setting.kind === "configured") return setting.model;
  return setting.kind === "disabled" ? "off" : "not set";
}

function describeAdvisors(
  setting: PreferenceView["preferences"]["advisors"],
): string {
  if (setting.kind === "configured") return setting.models.join(", ");
  return setting.kind === "disabled" ? "off" : "not set";
}

async function describeValidation(
  preferences: PreferenceView["preferences"],
  catalog: ModelCatalog,
): Promise<string[]> {
  const { delegation, advisor } = await validatePreferenceAxes({
    preferences,
    catalog,
  });
  const lines: string[] = [];

  lines.push(
    delegation.status === "active"
      ? `Delegation check: active, roles ${delegation.roles.map((role) => role.role).join(", ")}`
      : delegation.status === "off"
        ? "Delegation check: off"
        : `Delegation check: ${describeIssues(delegation.issues)}`,
  );
  if (advisor.status === "off") {
    lines.push("Advisor check: off");
  } else if (advisor.status === "error") {
    lines.push(`Advisor check: ${describeIssues(advisor.issues)}`);
  } else {
    const usable = advisor.advisors.map((entry) => entry.advisor).join(", ");
    const trouble =
      advisor.status === "partial" ? `; ${describeIssues(advisor.issues)}` : "";
    lines.push(`Advisor check: ${advisor.status}, usable ${usable}${trouble}`);
    for (const warning of advisor.warnings) {
      lines.push(`  warning: ${describeIssue(warning)}`);
    }
  }
  return lines;
}

// What the plugin found out about its own agents after the host applied its configuration. Silence
// would be ambiguous (nothing wrong, or nothing looking), so every outcome has a line of its own.
async function describeAgents(
  inspect: DelegateCommandPorts["inspect"],
): Promise<string[]> {
  if (inspect === undefined) return ["Agent check: not available."];

  let inspection: AgentInspection;
  try {
    inspection = await inspect();
  } catch {
    // The host's own message is not shown: it is not ours to vouch for.
    return ["Agent check: the host's agent list could not be read."];
  }

  if (inspection.registration === "unreadable") {
    return [
      "Agent check: the saved defaults could not be read when OpenCode started, so no agents were created.",
    ];
  }
  if (inspection.registration === "pending") {
    return ["Agent check: not run yet; the agents are not registered."];
  }

  const lines: string[] = [];
  for (const issue of inspection.advisors) {
    lines.push(
      issue.kind === "unregistered"
        ? `Agent check: ${issue.id} is configured but the host does not have it.`
        : `Agent check: ${issue.id} can still do ${issue.actions.join(", ")}; something re-enabled actions on an agent that must have none.`,
    );
  }
  for (const id of inspection.orphans) {
    lines.push(
      `Agent check: ${id} is left over from an earlier configuration and is still launchable; remove it from your OpenCode agent configuration.`,
    );
  }
  return lines.length > 0 ? lines : ["Agent check: nothing to report."];
}

function describeIssues(issues: readonly ValidationIssue[]): string {
  return `problem (${issues.map(describeIssue).join("; ")})`;
}

function describeIssue(issue: ValidationIssue): string {
  const subject =
    issue.advisor !== undefined
      ? `advisor ${issue.advisor}`
      : issue.role !== undefined
        ? `role ${issue.role}`
        : issue.field;
  return `${subject}: ${issue.code}`;
}

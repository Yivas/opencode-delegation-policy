import type { PreferenceView } from "../state/effective.js";
import {
  ADVISOR_MODES,
  type GlobalPreferenceChange,
  INTENSITIES,
  MAX_ADVISORS,
  PreferenceStateError,
  type RoleKey,
  type RoleSetting,
} from "../state/schema.js";
import type { PreferenceStore } from "../state/store.js";
import {
  type DelegationValidation,
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
};

const COMMAND_NAME = "delegate";

// The name a user types for each role. `visual-design` is hyphenated because that is how the
// registered agent is spelled; the stored key keeps the code's camelCase.
const ROLE_NAMES: Readonly<Record<string, RoleKey>> = {
  small: "small",
  medium: "medium",
  large: "large",
  "visual-design": "visualDesign",
};

const USAGE = [
  "Usage:",
  "  /delegate                              show the saved defaults and whether they work",
  `  /delegate intensity <${INTENSITIES.join("|")}>`,
  `  /delegate advisor-mode <${ADVISOR_MODES.join("|")}>`,
  `  /delegate role <${Object.keys(ROLE_NAMES).join("|")}> <provider/model[#variant]|off|unset>`,
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
  if (trimmed.startsWith(`${slash} `)) return trimmed.slice(slash.length + 1);
  return trimmed;
}

export async function runDelegate(
  line: string,
  ports: DelegateCommandPorts,
): Promise<string> {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const [subcommand, ...rest] = words;

  if (subcommand === undefined || subcommand === "status") {
    return report(await ports.store.readGlobal(), ports.catalog, undefined);
  }
  if (subcommand === "help") return USAGE;

  const change = parseChange(subcommand, rest);
  if (typeof change === "string") return `${change}\n\n${USAGE}`;

  try {
    const view = await ports.store.saveDefaults(change);
    return report(view, ports.catalog, "Saved.");
  } catch (error) {
    // The store's messages carry no stored value, so they are safe to show; anything else is a
    // defect and must surface as one.
    if (error instanceof PreferenceStateError) {
      return `Not saved: ${error.message}`;
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
      const key = name === undefined ? undefined : ROLE_NAMES[name];
      if (key === undefined || value === undefined || extra.length > 0) {
        return `role takes a name (${Object.keys(ROLE_NAMES).join(", ")}) and a model, off or unset.`;
      }
      return { roles: { [key]: roleSetting(value) } };
    }
    case "advisors": {
      if (rest.length === 0) {
        return "advisors takes off, unset or up to three model references.";
      }
      if (rest.length === 1 && rest[0] === "off") {
        return { advisors: { kind: "disabled" } };
      }
      if (rest.length === 1 && rest[0] === "unset") {
        return { advisors: { kind: "unset" } };
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
  catalog: ModelCatalog,
  heading: string | undefined,
): Promise<string> {
  const { preferences } = view;
  const lines: string[] = [];
  if (heading !== undefined) lines.push(heading);

  lines.push(
    `Intensity: ${preferences.intensity}`,
    `Advisor mode: ${preferences.advisorMode}`,
  );
  for (const [name, key] of Object.entries(ROLE_NAMES)) {
    lines.push(`Role ${name}: ${describeRole(preferences.roles[key])}`);
  }
  lines.push(`Advisors: ${describeAdvisors(preferences.advisors)}`);

  // Saving a value the catalogue does not offer is allowed (a provider may simply be offline), so
  // what the saved defaults actually do is reported separately and never hidden.
  lines.push(...(await describeValidation(preferences, catalog)));
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
  let validation: DelegationValidation;
  try {
    validation = await validatePreferenceAxes({ preferences, catalog });
  } catch {
    return ["Check: the model catalogue could not be read."];
  }
  const lines: string[] = [];
  const { delegation, advisor } = validation;

  lines.push(
    delegation.status === "active"
      ? `Delegation: active, roles ${delegation.roles.map((role) => role.role).join(", ")}`
      : delegation.status === "off"
        ? "Delegation: off"
        : `Delegation: ${describeIssues(delegation.issues)}`,
  );
  if (advisor.status === "off") {
    lines.push("Advisors: off");
  } else if (advisor.status === "error") {
    lines.push(`Advisors: ${describeIssues(advisor.issues)}`);
  } else {
    const usable = advisor.advisors.map((entry) => entry.advisor).join(", ");
    const trouble =
      advisor.status === "partial" ? `; ${describeIssues(advisor.issues)}` : "";
    lines.push(`Advisors: ${advisor.status}, usable ${usable}${trouble}`);
    for (const warning of advisor.warnings) {
      lines.push(`  warning: ${describeIssue(warning)}`);
    }
  }
  return lines;
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

export type CommandInvocation = {
  readonly sessionID: string;
  readonly prompt: { readonly text: string };
};

// The registered command. `reply` is how the answer reaches the session, a port because the host
// channel that shows it to the user is the part nothing can check without a real host.
export function createDelegateCommand(
  ports: DelegateCommandPorts & {
    readonly reply: (sessionID: string, text: string) => Promise<void>;
  },
) {
  return {
    name: COMMAND_NAME,
    description: "Set the delegation defaults and see whether they work.",
    async execute(input: CommandInvocation): Promise<void> {
      const text = await runDelegate(
        delegateArguments(input.prompt.text),
        ports,
      );
      await ports.reply(input.sessionID, text);
    },
  };
}

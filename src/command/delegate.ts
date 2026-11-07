import type { AgentDefinition } from "../agents/register.js";
import type { LogEntry } from "../log/local-log.js";
import type { InjectionReport } from "../policy/inject.js";
import type { GuardState } from "../policy/permission-guard.js";
import { restrictToRegistered } from "../policy/registered.js";
import type { TurnWatchState } from "../policy/turns.js";
import type { AgentInspection } from "../setup.js";
import type { PreferenceSource, PreferenceView } from "../state/effective.js";
import {
  ADVISOR_MODES,
  type GlobalPreferenceChange,
  INTENSITIES,
  MAX_ADVISORS,
  PREFERENCES,
  PreferenceStateError,
  ROLE_KEYS,
  type RoleKey,
  type RoleSetting,
  type SessionPreferenceChange,
  type ThinkingSetting,
} from "../state/schema.js";
import type { NextSessionState, PreferenceStore } from "../state/store.js";
import {
  type ModelCatalog,
  type ValidationIssue,
  validatePreferenceAxes,
} from "../validation/models.js";

// `/delegate`, with Pi's split between the session and the defaults: the bare commands change the
// session that is open, and the defaults change only through `/delegate defaults ...`, so saving them
// is never a side effect of a session change. A session can change intensity, Advisor mode and
// preference. It cannot change which models the roles and Advisors use: agents are created once
// when OpenCode starts, from the defaults, and nothing has shown that a launch honours a model the
// agent was not created with. Thinking is set in the defaults; the full selector replaces this text.

export type DelegateCommandPorts = {
  readonly store: Pick<
    PreferenceStore,
    | "readGlobal"
    | "readNext"
    | "readSession"
    | "saveDefaults"
    | "saveNext"
    | "applySession"
    | "resetSession"
    | "clearSession"
  >;
  readonly catalog: ModelCatalog;
  // Confirms that a session the TUI named exists before anything is written for it: the TUI's view
  // can be stale, and an override for a session that is gone would be left behind for nothing.
  readonly sessionExists?: (sessionID: string) => Promise<boolean>;
  // The check of the agents the host actually ended up with. Without it the status has nothing to
  // say about them, and says so instead of looking clean.
  readonly inspect?: () => Promise<AgentInspection>;
  // The agents the host was given. The checks below are made against them, because the policy only
  // names what is registered.
  readonly agents?: () => Promise<readonly AgentDefinition[]>;
  // What happened to the policy block on the latest request of the main agent.
  readonly injection?: () => InjectionReport;
  // Whether the runtime guard is registered. The policy text alone stops nothing.
  readonly guard?: () => GuardState;
  // Whether the host's event stream, which ends notice turns, is being read.
  readonly turns?: () => TurnWatchState;
  // The newest entries of the local, content-free log.
  readonly log?: (limit: number) => Promise<readonly LogEntry[]>;
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

const ROLE_LIST = ROLE_KEYS.map((key) => ROLE_NAMES[key]).join("|");

const USAGE = [
  "Usage, for the session that is open:",
  "  /delegate [status]                       show the settings and whether they work",
  `  /delegate <${INTENSITIES.join("|")}>      set this session's intensity`,
  `  /delegate advisor <${ADVISOR_MODES.join("|")}>`,
  `  /delegate preference <${PREFERENCES.join("|")}>`,
  "  /delegate reset                          turn this session's delegation and Advisor off",
  "  /delegate clear                          drop this session's changes and follow the defaults",
  "",
  "Usage, for the next session (the first one created after this):",
  `  /delegate next <${INTENSITIES.join("|")}>   set what the next session starts with`,
  `  /delegate next advisor <${ADVISOR_MODES.join("|")}>`,
  `  /delegate next preference <${PREFERENCES.join("|")}>`,
  "  /delegate next clear                     discard the setting saved for the next session",
  "",
  "Usage, for the defaults of every session:",
  `  /delegate defaults <intensity|advisor-mode|preference> <value>`,
  `  /delegate defaults role <${ROLE_LIST}> <provider/model[#variant]|off|unset>`,
  `  /delegate defaults thinking <${ROLE_LIST}> <level|from..to|unset>`,
  `  /delegate defaults advisors <off|unset|provider/model[#variant] ...>   up to ${MAX_ADVISORS}`,
  "",
  "  /delegate log                            show the newest entries of the local log",
  "  /delegate help                           show this text",
  "",
  "Session settings are saved and survive a restart. Agents are created when OpenCode starts, from",
  "the defaults, so a change to roles, Advisors or thinking takes effect after a restart.",
].join("\n");

const NO_SESSION =
  "Open a session first: this changes the session that is open. To change the defaults of every session, use /delegate defaults ...";

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

type Request =
  | { readonly kind: "status" }
  | { readonly kind: "help" }
  | { readonly kind: "log" }
  | { readonly kind: "defaults"; readonly change: GlobalPreferenceChange }
  | { readonly kind: "session"; readonly change: SessionPreferenceChange }
  | { readonly kind: "next"; readonly change: SessionPreferenceChange }
  | { readonly kind: "reset" }
  | { readonly kind: "clear" };

export async function runDelegate(
  line: string,
  ports: DelegateCommandPorts,
  scope: { readonly sessionID?: string } = {},
): Promise<string> {
  const request = parseRequest(line);
  if (typeof request === "string") return `${request}\n\n${USAGE}`;
  if (request.kind === "help") return USAGE;
  if (request.kind === "log") return describeLog(ports.log);

  const sessionID = scope.sessionID;
  try {
    switch (request.kind) {
      case "status": {
        if (sessionID !== undefined) {
          return await describePreferenceView(
            await ports.store.readSession(sessionID),
            ports,
            "This session:",
          );
        }
        // At home the defaults are the subject, and what the next session would get is reported
        // separately: it is a saved setting, not a default.
        const next = describeNextSession(await ports.store.readNext());
        const defaults = await describePreferenceView(
          await ports.store.readGlobal(),
          ports,
          "No session is open; these are the defaults.",
        );
        return next === undefined ? defaults : `${defaults}\n\n${next}`;
      }
      case "defaults":
        return await describePreferenceView(
          await ports.store.saveDefaults(request.change),
          ports,
          "Defaults saved.",
        );
      case "next":
        return await describePreferenceView(
          await ports.store.saveNext(request.change),
          ports,
          "Next session, saved:",
          NEXT_SESSION_SOURCES,
        );
      default: {
        if (sessionID === undefined) return NO_SESSION;
        if (
          ports.sessionExists !== undefined &&
          !(await ports.sessionExists(sessionID))
        ) {
          // A failed lookup and a deleted session look the same from here, so neither is claimed.
          return "The host could not confirm that session exists; nothing was changed.";
        }
        const view =
          request.kind === "reset"
            ? await ports.store.resetSession(sessionID)
            : request.kind === "clear"
              ? await ports.store.clearSession(sessionID)
              : await ports.store.applySession(sessionID, request.change);
        return await describePreferenceView(
          view,
          ports,
          "This session, saved:",
        );
      }
    }
  } catch (error) {
    if (error instanceof PreferenceStateError) {
      // A write that rejected may still have landed, and the store says so; "Not saved" would
      // contradict it. The store's messages carry no stored value. Anything else is a defect and
      // surfaces as one.
      if (error.persistence === "unknown") {
        return `Could not confirm the save: ${error.message}`;
      }
      return request.kind === "status"
        ? `The saved settings cannot be read: ${error.message}`
        : `Not saved: ${error.message}`;
    }
    throw error;
  }
}

// Returns what to do, or the reason the input cannot be understood. Nothing is written for input
// that is not understood.
function parseRequest(line: string): Request | string {
  // Command words and named values are case-insensitive, as in Pi. Model references are not touched:
  // provider and model ids are matched exactly by the validator.
  const [typed, ...rest] = line.trim().split(/\s+/).filter(Boolean);
  const first = typed?.toLowerCase();
  if (first === undefined || (first === "status" && rest.length === 0)) {
    return { kind: "status" };
  }
  if (first === "help" && rest.length === 0) return { kind: "help" };
  if (first === "log" && rest.length === 0) return { kind: "log" };
  if (first === "reset" && rest.length === 0) return { kind: "reset" };
  if (first === "clear" && rest.length === 0) return { kind: "clear" };
  const scalar = parseScalarChange(first, rest);
  if (scalar !== undefined) {
    return typeof scalar === "string"
      ? scalar
      : { kind: "session", change: scalar };
  }
  if (first === "next") {
    const [setting, ...values] = rest;
    if (setting === undefined) {
      return "next needs a setting: an intensity, advisor, preference or clear.";
    }
    // An empty change is what removes the pending setting, so "clear" needs no separate kind.
    if (setting.toLowerCase() === "clear" && values.length === 0) {
      return { kind: "next", change: {} };
    }
    const change = parseScalarChange(setting, values);
    if (change === undefined) {
      return "next takes an intensity, advisor, preference or clear.";
    }
    return typeof change === "string" ? change : { kind: "next", change };
  }
  if (first === "defaults") {
    const [setting, ...values] = rest;
    if (setting === undefined) return "defaults needs a setting.";
    const change = parseDefaultsChange(setting.toLowerCase(), values);
    return typeof change === "string" ? change : { kind: "defaults", change };
  }
  return `Unknown subcommand "${typed}".`;
}

// The three settings a session and the next session share. Undefined means the first word is not one
// of them, so the caller keeps looking; a string is the reason the value cannot be understood.
function parseScalarChange(
  setting: string | undefined,
  rest: readonly string[],
): SessionPreferenceChange | string | undefined {
  if (isOneOf(INTENSITIES, setting) && rest.length === 0) {
    return { intensity: setting };
  }
  if (setting === "advisor") {
    const [typedMode, ...extra] = rest;
    const mode = typedMode?.toLowerCase();
    if (!isOneOf(ADVISOR_MODES, mode) || extra.length > 0) {
      return `advisor takes one of: ${ADVISOR_MODES.join(", ")}.`;
    }
    return { advisorMode: mode };
  }
  if (setting === "preference") {
    const [typedValue, ...extra] = rest;
    const value = typedValue?.toLowerCase();
    if (!isOneOf(PREFERENCES, value) || extra.length > 0) {
      return `preference takes one of: ${PREFERENCES.join(", ")}.`;
    }
    return { preference: value };
  }
  return undefined;
}

// Lower-cases a named value; a model reference passes through as typed.
function named(value: string | undefined): string | undefined {
  return value?.toLowerCase();
}

function parseDefaultsChange(
  setting: string,
  rest: readonly string[],
): GlobalPreferenceChange | string {
  switch (setting) {
    case "intensity": {
      const [typed, ...extra] = rest;
      const value = named(typed);
      if (!isOneOf(INTENSITIES, value) || extra.length > 0) {
        return `defaults intensity takes one of: ${INTENSITIES.join(", ")}.`;
      }
      return { intensity: value };
    }
    case "advisor-mode": {
      const [typed, ...extra] = rest;
      const value = named(typed);
      if (!isOneOf(ADVISOR_MODES, value) || extra.length > 0) {
        return `defaults advisor-mode takes one of: ${ADVISOR_MODES.join(", ")}.`;
      }
      return { advisorMode: value };
    }
    case "preference": {
      const [typed, ...extra] = rest;
      const value = named(typed);
      if (!isOneOf(PREFERENCES, value) || extra.length > 0) {
        return `defaults preference takes one of: ${PREFERENCES.join(", ")}.`;
      }
      return { preference: value };
    }
    case "role": {
      const [name, value, ...extra] = rest;
      const key = roleKeyFor(named(name));
      if (key === undefined || value === undefined || extra.length > 0) {
        return `defaults role takes a name (${ROLE_LIST}) and a model, off or unset.`;
      }
      return { roles: { [key]: roleSetting(value) } };
    }
    case "thinking": {
      const [name, value, ...extra] = rest;
      const key = roleKeyFor(named(name));
      const setting = value === undefined ? undefined : thinkingSetting(value);
      if (key === undefined || setting === undefined || extra.length > 0) {
        return `defaults thinking takes a name (${ROLE_LIST}) and a level, a range from..to, or unset.`;
      }
      return { thinking: { [key]: setting } };
    }
    case "advisors": {
      const keyword = rest
        .map((word) => word.toLowerCase())
        .find((word) => word === "off" || word === "unset");
      if (keyword !== undefined) {
        // A keyword mixed with models would be saved as a model reference called "off".
        if (rest.length > 1) {
          return `defaults advisors ${keyword} cannot be combined with models.`;
        }
        return {
          advisors: { kind: keyword === "off" ? "disabled" : "unset" },
        };
      }
      if (rest.length === 0) {
        return `defaults advisors takes off, unset or up to ${MAX_ADVISORS} model references.`;
      }
      if (rest.length > MAX_ADVISORS) {
        return `defaults advisors takes at most ${MAX_ADVISORS} models.`;
      }
      return { advisors: { kind: "configured", models: [...rest] } };
    }
    default:
      return `Unknown defaults setting "${setting}".`;
  }
}

function roleSetting(value: string): RoleSetting {
  const word = value.toLowerCase();
  if (word === "off") return { kind: "disabled" };
  if (word === "unset") return { kind: "unset" };
  return { kind: "configured", model: value };
}

// Whether a level exists is the validator's question, which reports it on the next status; here the
// text only has to say which shape the user meant. Anything with ".." is a range, and a range with a
// missing or extra bound is refused rather than saved as a level with dots in it.
function thinkingSetting(value: string): ThinkingSetting | undefined {
  const word = value.toLowerCase();
  if (word === "unset") return { kind: "unset" };
  if (!word.includes(".")) return { kind: "fixed", level: word };
  // Levels never contain a dot, so a range is exactly two dot-free bounds around "..".
  const range = /^([^.]+)\.\.([^.]+)$/.exec(word);
  if (range === null) return undefined;
  return { kind: "range", from: range[1] ?? "", to: range[2] ?? "" };
}

function isOneOf<T extends string>(
  allowed: readonly T[],
  value: string | undefined,
): value is T {
  return value !== undefined && (allowed as readonly string[]).includes(value);
}

const SOURCE_NAMES: Readonly<Record<PreferenceSource, string>> = {
  default: "built-in",
  global: "defaults",
  session: "session",
};

// The same view, named for the session it describes: a pending value is not this session's.
export const NEXT_SESSION_SOURCES: Readonly<Record<PreferenceSource, string>> =
  {
    ...SOURCE_NAMES,
    session: "next session",
  };

export async function describePreferenceView(
  view: PreferenceView,
  ports: DelegateCommandPorts,
  heading: string,
  sources: Readonly<Record<PreferenceSource, string>> = SOURCE_NAMES,
): Promise<string> {
  const { preferences, provenance } = view;
  const from = (source: PreferenceSource) => ` (${sources[source]})`;
  const lines: string[] = [heading];

  lines.push(
    `Intensity: ${preferences.intensity}${from(provenance.intensity)}`,
    `Advisor mode: ${preferences.advisorMode}${from(provenance.advisorMode)}`,
    `Preference: ${preferences.preference}${from(provenance.preference)}`,
  );
  for (const key of ROLE_KEYS) {
    lines.push(
      `Role ${ROLE_NAMES[key]}: ${describeRole(preferences.roles[key])}${from(provenance.roles[key])}; thinking ${describeThinking(preferences.thinking[key])}${from(provenance.thinking[key])}`,
    );
  }
  lines.push(
    `Advisors: ${describeAdvisors(preferences.advisors)}${from(provenance.advisors)}`,
  );

  // Saving a value the catalogue does not offer is allowed (a provider may simply be offline), so
  // what the settings actually do is reported separately and never hidden. The validator turns a
  // catalogue failure into its own result; anything it throws is a defect and is not swallowed.
  lines.push(
    ...(await describeValidation(preferences, ports.catalog, ports.agents)),
  );
  lines.push(...(await describeAgents(ports.inspect)));
  lines.push(describeInjection(ports.injection));
  lines.push(describeGuard(ports.guard));
  if (ports.turns !== undefined && ports.turns() !== "listening") {
    lines.push(
      "Notice check: the host's event stream is not being read, so a change notice repeats until it returns.",
    );
  }
  lines.push(
    "",
    "Agents are created when OpenCode starts, from the defaults; restart it after changing roles, Advisors or thinking.",
  );
  return lines.join("\n");
}

// The pending setting is reported even when nothing is waiting, so a person who saved one and then
// wonders where it went has an answer. A damaged one is named by its code: it is never claimed.
function describeNextSession(state: NextSessionState): string | undefined {
  if (state.status === "none") return undefined;
  if (state.status === "unreadable") {
    return [
      `Next session: the saved setting cannot be read (${state.code}), so no session will claim it; the next session uses the defaults.`,
      "Save it again from /delegate to replace it, or discard it with /delegate next clear.",
    ].join("\n");
  }
  const { preferences } = state.view;
  return [
    `Next session (saved ${new Date(state.savedAt).toISOString()}): intensity ${preferences.intensity}, Advisor mode ${preferences.advisorMode}, preference ${preferences.preference}.`,
    "The first root session created after that time takes these values as its own and the saved setting is removed. /delegate next clear discards it.",
  ].join("\n");
}

function describeThinking(setting: ThinkingSetting): string {
  if (setting.kind === "fixed") return setting.level;
  if (setting.kind === "range") return `${setting.from}..${setting.to}`;
  return "not set";
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
  agents: DelegateCommandPorts["agents"],
): Promise<string[]> {
  const validated = await validatePreferenceAxes({ preferences, catalog });
  let registered: readonly AgentDefinition[] | undefined;
  let agentsUnknown = false;
  if (agents !== undefined) {
    try {
      registered = await agents();
    } catch {
      // Without the host's list the settings are reported as validated; the line below says the
      // agents themselves could not be checked.
      agentsUnknown = true;
    }
  }
  const { delegation, advisor } =
    registered === undefined
      ? validated
      : restrictToRegistered(validated, registered);
  const lines: string[] = [];
  if (agentsUnknown) {
    lines.push(
      "Registration check: the host's agent list could not be read, so the checks below ignore which agents exist.",
    );
  }

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
  const issues = [
    ...(delegation.status === "error" ? delegation.issues : []),
    ...(advisor.status === "error" || advisor.status === "partial"
      ? advisor.issues
      : []),
  ];
  if (issues.some((issue) => issue.code === "agent-not-registered")) {
    lines.push(
      "  Agents exist only for what the defaults defined when OpenCode started: set these with /delegate defaults and restart OpenCode.",
    );
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
        : `Agent check: ${issue.id} can still do ${issue.actions.join(", ")}; something re-enabled actions on an agent that may only read.`,
    );
  }
  for (const id of inspection.orphans) {
    lines.push(
      `Agent check: ${id} is left over from an earlier configuration and is still launchable; remove it from your OpenCode agent configuration.`,
    );
  }
  return lines.length > 0 ? lines : ["Agent check: nothing to report."];
}

const INJECTION_TEXT: Readonly<
  Record<
    | Exclude<InjectionReport["outcome"], "skipped" | "failed">
    | Extract<InjectionReport, { reason: string }>["reason"],
    string
  >
> = {
  "none-yet": "no request has been seen yet.",
  injected: "the latest request carried the delegation policy.",
  "plugin-agent":
    "the latest request came from one of the plugin's own agents, which never get the policy.",
  "child-session":
    "the latest request came from a delegated child session, which never gets the policy.",
  "nothing-active":
    "the latest request carried no policy because nothing is active for that session.",
  "session-lookup":
    "the latest request carried no policy: the host could not say whether its session is a child.",
  "agent-lookup":
    "the latest request carried no policy: the host's agent list could not be read.",
  "preferences-unreadable":
    "the latest request carried no policy: the saved preferences could not be read.",
  "unexpected-error":
    "the latest request carried no policy because of an unexpected error in the plugin.",
};

// The latest request may belong to any session, so this describes that request, not this one.
function describeInjection(
  injection: DelegateCommandPorts["injection"],
): string {
  if (injection === undefined) return "Policy check: not available.";
  const report = injection();
  const key = "reason" in report ? report.reason : report.outcome;
  const kind =
    "kind" in report && report.kind !== undefined ? ` (${report.kind})` : "";
  // The plugin sees requests from every session, so this is the latest one it handled, whichever
  // session it belonged to, and describes what the plugin did to it, not what the provider received.
  return `Policy check (latest request handled, any session): ${INJECTION_TEXT[key]}${kind}`;
}

// What the guard does, and what is left when the host has no hook to do it with. Silence would read
// as enforcement that is not there.
function describeGuard(guard: DelegateCommandPorts["guard"]): string {
  if (guard === undefined) return "Guard check: not available.";
  return guard() === "active"
    ? "Guard check: active; a launch the session does not offer and an Advisor's non-read actions are refused at runtime."
    : "Guard check: the host does not offer the permission hook, so nothing is refused at runtime.";
}

const LOG_LINES = 20;

// The log holds no content, so it can be shown as it is: what was injected, what was launched and what
// the guard refused.
async function describeLog(log: DelegateCommandPorts["log"]): Promise<string> {
  if (log === undefined) return "The local log is not available.";
  let entries: readonly LogEntry[];
  try {
    entries = await log(LOG_LINES);
  } catch {
    return "The local log could not be read.";
  }
  if (entries.length === 0) return "The local log is empty.";
  return [
    `Newest ${entries.length} entries of the local log (no prompts, answers or session ids are kept):`,
    ...entries.map(describeLogEntry),
  ].join("\n");
}

function describeLogEntry(entry: LogEntry): string {
  switch (entry.kind) {
    case "policy":
      return `${entry.at} policy ${entry.hash}: intensity ${entry.intensity}, advisor ${entry.advisorMode}, preference ${entry.preference}`;
    case "launch":
      return `${entry.at} launch ${entry.agent}${entry.background ? " (background)" : ""}: ${entry.outcome} after ${entry.ms} ms`;
    case "denial":
      return `${entry.at} refused ${entry.action} for ${entry.agent}`;
  }
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

import type { RoleKey } from "../state/schema.js";

// Shared by the registration and the post-activation permission check. Keeping these here avoids a
// cycle between the two modules: the check needs the prefix and the deny list, and the registration
// needs the deny list, so neither imports the other for them.

// Product-owned ids. The editor has no owner field and no `add`, so registration upserts these exact
// ids; no other `ocv2-` id is claimed.
export const AGENT_PREFIX = "ocv2-";

const ADVISOR_PREFIX = `${AGENT_PREFIX}advisor-`;

// The only actions an advisor may perform, named after the built-in tools of OpenCode 2.2.6
// (dc2ffcf8): `read` also lists a directory, `glob` matches names and `grep` searches content. The
// host asks for `read` on a project-relative path and for `glob` and `grep` on the pattern, so a
// resource rule cannot confine the last two to a set of paths.
export const ADVISOR_READ_ACTIONS = ["read", "glob", "grep"] as const;

// Every other action the built-in tools of 2.2.6 request. `edit` covers edit, write, patch and
// worktree removal, `execute` is Code Mode, and an MCP tool asks for `<server>_<tool>`, which only
// the wildcard rule covers. A tool with no action of its own, such as todo, is closed by it too.
export const ADVISOR_DENIED_ACTIONS = [
  "edit",
  "shell",
  "execute",
  "subagent",
  "skill",
  "webfetch",
  "websearch",
  "external_directory",
  "question",
] as const;

export function isAdvisorReadAction(action: string): boolean {
  return ADVISOR_READ_ACTIONS.some((allowed) => allowed === action);
}

export type AgentPermission = {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny" | "ask";
};

// The host's own default asks before reading an environment file. An Advisor runs as a child that
// nobody is watching, so the same files are denied instead, keeping the example file readable.
// `grep` asks with its pattern, not a path, so this narrows `read` only; it is not confidentiality.
// Order matters as everywhere in these rules: the last matching rule wins, so the example file is
// allowed after the two denies. The guard reads the same list, so the two cannot disagree.
export const ADVISOR_ENVIRONMENT_RULES: readonly AgentPermission[] = [
  { action: "read", resource: "*.env", effect: "deny" },
  { action: "read", resource: "*.env.*", effect: "deny" },
  { action: "read", resource: "*.env.example", effect: "allow" },
];

// Typed by RoleKey on purpose: adding a role without an entry here becomes a compile error instead
// of an agent that is silently never registered.
export const ROLE_AGENTS: Readonly<
  Record<RoleKey, { id: string; name: string }>
> = {
  small: { id: `${AGENT_PREFIX}small`, name: "Small" },
  medium: { id: `${AGENT_PREFIX}medium`, name: "Medium" },
  large: { id: `${AGENT_PREFIX}large`, name: "Large" },
  visualDesign: {
    id: `${AGENT_PREFIX}visual-design`,
    name: "Visual Design",
  },
};

// The exact ids the plugin may own. Everything else, even under the same prefix, belongs to the user.
export function reservedAgentIDs(): readonly string[] {
  return [
    ...Object.values(ROLE_AGENTS).map((role) => role.id),
    ...[1, 2, 3].map((number) => advisorAgentID(number)),
  ];
}

// Advisors are numbered by their position in the configured list, so two entries with the same model
// still get distinct ids. `isAdvisorAgentID` reads the same shape, so an id cannot be built one way
// and recognised another.
export function advisorAgentID(advisor: number): string {
  return `${ADVISOR_PREFIX}${advisor}`;
}

export function isAdvisorAgentID(id: string): boolean {
  return id.startsWith(ADVISOR_PREFIX);
}

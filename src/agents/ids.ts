import type { RoleKey } from "../state/schema.js";

// Shared by the registration and the post-activation permission check. Keeping these here avoids a
// cycle between the two modules: the check needs the prefix and the deny list, and the registration
// needs the deny list, so neither imports the other for them.

// Product-owned ids. The editor has no owner field and no `add`, so registration upserts these exact
// ids; no other `ocv2-` id is claimed.
export const AGENT_PREFIX = "ocv2-";

const ADVISOR_PREFIX = `${AGENT_PREFIX}advisor-`;

// Actions the host documents today. The wildcard rule covers anything else, and an action named by
// the effective rules is checked too.
export const ADVISOR_DENIED_ACTIONS = [
  "read",
  "edit",
  "shell",
  "execute",
  "subagent",
  "skill",
  "webfetch",
  "websearch",
  "external_directory",
] as const;

export type AgentPermission = {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny" | "ask";
};

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

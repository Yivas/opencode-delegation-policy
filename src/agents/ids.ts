// Shared by the registration and the post-activation permission check. Keeping these here avoids a
// cycle between the two modules: the check needs the prefix and the deny list, and the registration
// needs the deny list, so neither imports the other for them.

// Product-owned ids. The editor has no owner field and no `add`, so registration upserts these exact
// ids; no other `ocv2-` id is claimed.
export const AGENT_PREFIX = "ocv2-";

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

export function isAdvisorAgentID(id: string): boolean {
  return id.startsWith(`${AGENT_PREFIX}advisor-`);
}

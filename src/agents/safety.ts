import type { AgentDefinition, AgentPermission } from "./register.js";

// The host applies `opencode.config.agent` after the plugin's transform and the last matching
// permission rule wins, so the user's own configuration can append an `allow` after the advisor's
// deny-all and re-enable execution. Nothing can prevent that from inside the transform; the only
// safe answer is to read the effective agents afterwards and refuse to consult an advisor that
// stopped being advice-only. This module is that check, and it is pure so the caller decides what
// to do with the result.

// Actions the host documents today. The list is not a boundary by itself: an action named by the
// effective rules is checked too, and the wildcard rule covers anything else.
const KNOWN_ACTIONS = [
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

export type EffectiveAgent = {
  readonly id: string;
  readonly permissions: readonly AgentPermission[];
};

export type AdvisorSafetyIssue =
  | { readonly kind: "unregistered"; readonly id: string }
  | {
      readonly kind: "actions-allowed";
      readonly id: string;
      readonly actions: readonly string[];
    };

// An advisor is safe only while every action still resolves to deny after the whole rule list is
// applied. A rule the plugin did not write, appended later for a narrower resource, is a hole for
// that action: it would let the child act on that resource.
export function advisorSafetyIssues(input: {
  readonly definitions: readonly AgentDefinition[];
  readonly effective: readonly EffectiveAgent[];
}): readonly AdvisorSafetyIssue[] {
  const issues: AdvisorSafetyIssue[] = [];
  const byID = new Map(input.effective.map((agent) => [agent.id, agent]));
  for (const definition of input.definitions) {
    if (definition.permissions === undefined) continue;
    const agent = byID.get(definition.id);
    if (agent === undefined) {
      issues.push({ kind: "unregistered", id: definition.id });
      continue;
    }
    const actions = allowedActions(agent.permissions);
    if (actions.length > 0) {
      issues.push({ kind: "actions-allowed", id: definition.id, actions });
    }
  }
  return issues;
}

// Which actions still end on something other than `deny` once the documented matcher runs: the last
// rule whose action matches exactly or through the wildcard decides.
export function allowedActions(
  rules: readonly AgentPermission[],
): readonly string[] {
  const candidates = new Set<string>([...KNOWN_ACTIONS, "*"]);
  for (const rule of rules) {
    candidates.add(rule.action);
  }
  const allowed: string[] = [];
  for (const action of candidates) {
    let decision: AgentPermission["effect"] | undefined;
    for (const rule of rules) {
      if (rule.action === action || rule.action === "*") {
        decision = rule.effect;
      }
    }
    // No matching rule falls back to "ask", which in a background child can block the work, so it
    // is not treated as safe either.
    if (decision !== "deny") {
      allowed.push(action);
    }
  }
  return allowed.sort();
}

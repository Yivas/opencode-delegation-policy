import {
  ADVISOR_DENIED_ACTIONS,
  type AgentPermission,
  isAdvisorAgentID,
  reservedAgentIDs,
} from "./ids.js";
import type { AgentDefinition } from "./register.js";

// The host applies `opencode.config.agent` after the plugin's transform and the last matching
// permission rule wins, so the user's own configuration can append an `allow` after the advisor's
// deny-all and re-enable execution. Nothing can prevent that from inside the transform; the only
// safe answer is to read the effective agents afterwards and refuse to consult an advisor that
// stopped being advice-only. This module is that check, and it is pure so the caller decides what
// to do with the result.

export type EffectiveAgent = {
  readonly id: string;
  readonly permissions: readonly AgentPermission[];
};

export type AdvisorSafetyIssue =
  | { readonly kind: "unregistered"; readonly id: string }
  | {
      readonly kind: "actions-not-denied";
      readonly id: string;
      readonly actions: readonly string[];
    };

// An advisor is safe only while every action still resolves to deny after the whole rule list is
// applied. Anything that leaves part of an action's space open is reported: a later `allow` for one
// resource, an `ask`, or no matching rule at all.
export function advisorSafetyIssues(input: {
  readonly definitions: readonly AgentDefinition[];
  readonly effective: readonly EffectiveAgent[];
}): readonly AdvisorSafetyIssue[] {
  const issues: AdvisorSafetyIssue[] = [];
  const byID = new Map(input.effective.map((agent) => [agent.id, agent]));
  for (const definition of input.definitions) {
    if (!isAdvisorAgentID(definition.id)) continue;
    const agent = byID.get(definition.id);
    if (agent === undefined) {
      issues.push({ kind: "unregistered", id: definition.id });
      continue;
    }
    const actions = actionsNotDenied(agent.permissions);
    if (actions.length > 0) {
      issues.push({
        kind: "actions-not-denied",
        id: definition.id,
        actions,
      });
    }
  }
  return issues;
}

// Agents among the plugin's reserved ids that the current configuration no longer defines. They stay
// launchable because the plugin only removes what it created in the same run, and after a reload it
// cannot prove ownership. They are reported, never deleted. Only the exact reserved ids are reported:
// a user agent that happens to share the prefix is none of the plugin's business.
export function orphanAgentIDs(input: {
  readonly definitions: readonly AgentDefinition[];
  readonly effective: readonly EffectiveAgent[];
}): readonly string[] {
  const defined = new Set(input.definitions.map((definition) => definition.id));
  return input.effective
    .map((agent) => agent.id)
    .filter((id) => reservedAgentIDs().includes(id) && !defined.has(id))
    .sort();
}

// Which actions are not closed once the documented matcher runs. For one action, a rule with the
// wildcard resource decides the whole resource space; a narrower deny removes nothing, and a
// narrower `allow` or `ask` opens the part of the space it names. So an action is safe only when
// the last rule that can affect any of its resources leaves it closed by a wildcard deny.
export function actionsNotDenied(
  rules: readonly AgentPermission[],
): readonly string[] {
  const candidates = new Set<string>([...ADVISOR_DENIED_ACTIONS, "*"]);
  for (const rule of rules) {
    candidates.add(rule.action);
  }
  const open: string[] = [];
  for (const action of candidates) {
    let closed = false;
    for (const rule of rules) {
      if (rule.action !== action && rule.action !== "*") continue;
      closed = rule.effect === "deny" ? rule.resource === "*" || closed : false;
    }
    // No matching rule falls back to "ask", which in a background child can block the work, so it
    // is not treated as safe either.
    if (!closed) open.push(action);
  }
  return open.sort();
}

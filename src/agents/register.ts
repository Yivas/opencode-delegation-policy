import type { Plugin } from "@opencode/plugin";

import type { AdvisorSelection, RoleSelection } from "../validation/models.js";

// Product-owned agent ids. These exact ids are managed by the plugin: the editor has no owner field
// and no `add`, so registration upserts them and the product documents them as reserved. Nothing
// else is touched, and no other `ocv2-` id is claimed.
export const AGENT_PREFIX = "ocv2-";

const ROLE_AGENT_IDS = {
  small: "ocv2-small",
  medium: "ocv2-medium",
  large: "ocv2-large",
  visualDesign: "ocv2-visual-design",
} as const;

const ROLE_AGENT_NAMES = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  visualDesign: "Visual Design",
} as const;

// `action` and `resource` accept full-value wildcards, the last matching rule wins, an agent's base
// policy allows everything, and an action no rule matches falls back to "ask" rather than "deny".
// So the advisor boundary denies every action known today and then denies the wildcard, which has to
// come last: the enumerated rules still close the door if a wildcard is not honoured, and the
// wildcard closes actions a later host or another extension adds.
const ADVISOR_ACTIONS = [
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

const DENY_EVERYTHING = [
  ...ADVISOR_ACTIONS.map((action) => ({
    action,
    resource: "*",
    effect: "deny" as const,
  })),
  { action: "*", resource: "*", effect: "deny" as const },
];

export type AgentModel = {
  readonly providerID: string;
  readonly id: string;
  readonly variant?: string;
};

export type AgentPermission = {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny" | "ask";
};

export type AgentDefinition = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly system: string;
  readonly mode: "subagent";
  readonly model: AgentModel;
  readonly permissions?: readonly AgentPermission[];
};

// The fields this module writes on a host agent. Narrowing the parameter keeps the product from
// touching anything it does not own, such as request headers or the agent's own steps.
type HostAgent = Parameters<AgentEditorPort["update"]>[1] extends (
  agent: infer Value,
) => void
  ? Value
  : never;
type WritableAgent = Pick<
  HostAgent,
  | "name"
  | "description"
  | "system"
  | "mode"
  | "hidden"
  | "model"
  | "permissions"
>;

export type AgentEditorPort = Parameters<
  Parameters<Plugin.Context["agent"]["transform"]>[0]
>[0];

export type RegisterAgentResult = {
  readonly registered: readonly string[];
  readonly removed: readonly string[];
};

// Permission rules and description do not teach behaviour: the system prompt carries the only
// instruction the child sees, and phase 3.3 composes the full policy on top of it.
const ROLE_SYSTEM =
  "Work only on the delegated task within its stated scope. Report results and limitations; do not take on work outside it.";
const ADVISOR_SYSTEM =
  "Provide advice only within the delegated question. Do not execute actions, use tools or claim to have performed them. Name missing evidence and material risks, and answer briefly.";

export function agentDefinitions(input: {
  readonly roles: readonly RoleSelection[];
  readonly advisors: readonly AdvisorSelection[];
}): readonly AgentDefinition[] {
  const definitions: AgentDefinition[] = [];
  for (const selection of input.roles) {
    const key = selection.role as keyof typeof ROLE_AGENT_IDS;
    const id = ROLE_AGENT_IDS[key];
    if (id === undefined) continue;
    const name = ROLE_AGENT_NAMES[key];
    definitions.push({
      id,
      name,
      description: `OpenCode delegation role: ${name}.`,
      system: ROLE_SYSTEM,
      mode: "subagent",
      model: selectionModel(selection),
    });
  }
  for (const selection of input.advisors) {
    definitions.push({
      id: advisorAgentID(selection.advisor),
      name: `Advisor ${selection.advisor}`,
      description: `OpenCode delegation advisor ${selection.advisor}: bounded advice, no actions.`,
      system: ADVISOR_SYSTEM,
      mode: "subagent",
      model: selection.launchModel,
      permissions: DENY_EVERYTHING,
    });
  }
  return definitions;
}

// The registered agent carries a variant only when the configuration leaves one unambiguous choice.
// A rule with several proven options is a per-launch decision, so the agent keeps the base model and
// the policy tells the main agent which variant to pass.
function selectionModel(selection: RoleSelection): AgentModel {
  const { model, thinking } = selection;
  const chosen =
    thinking.kind === "inline"
      ? thinking.variant
      : thinking.kind === "options" && thinking.options.length === 1
        ? thinking.options[0]?.variant
        : undefined;
  return chosen === undefined
    ? { providerID: model.providerID, id: model.id }
    : { providerID: model.providerID, id: model.id, variant: chosen };
}

// Advisors are numbered in configuration order, so two entries with the same model still get their
// own stable id instead of colliding.
export function advisorAgentID(advisor: number): string {
  return `${AGENT_PREFIX}advisor-${advisor}`;
}

// Every field the plugin owns is set explicitly, so re-registering is idempotent and an agent left
// by an earlier configuration cannot keep an old model. Permissions are the exception: an ordinary
// role leaves the host's base rules alone, because writing an empty list would replace them and
// every action would fall back to "ask". A definition without permissions therefore skips the
// field, and only the advisor, which must deny everything, declares a list.
export function applyDefinition(
  agent: WritableAgent,
  definition: AgentDefinition,
): void {
  agent.name = definition.name as unknown as WritableAgent["name"];
  agent.description = definition.description;
  agent.system = definition.system;
  agent.mode = definition.mode;
  agent.hidden = false;
  agent.model = definition.model as unknown as WritableAgent["model"];
  if (definition.permissions !== undefined) {
    agent.permissions = [
      ...definition.permissions,
    ] as unknown as WritableAgent["permissions"];
  }
}

// The ids above are a reserved namespace, so registration upserts them without inspecting what is
// there: the editor has no owner field, and every inspectable field can be rewritten by the host
// config that runs after this transform, which would make our own agents look foreign on the next
// reload. A user agent that takes one of these exact ids is overwritten; that is the documented
// contract, and it is why no other `ocv2-` id is claimed.
// `created` holds the ids this process registered. Only those can be removed when a definition
// disappears, because creation here is the one ownership fact the plugin actually observed; ids
// seen only after a reload are never deleted on inference.
export function registerAgentDefinitions(input: {
  readonly editor: AgentEditorPort;
  readonly definitions: readonly AgentDefinition[];
  readonly created: Set<string>;
}): RegisterAgentResult {
  const registered: string[] = [];
  const removed: string[] = [];
  for (const definition of input.definitions) {
    input.editor.update(definition.id, (agent) =>
      applyDefinition(agent, definition),
    );
    input.created.add(definition.id);
    registered.push(definition.id);
  }

  // An agent this process registered and the current configuration no longer defines would stay
  // launchable until a reload, so it is removed here. Nothing else is ever removed.
  const wanted = new Set(registered);
  for (const id of [...input.created]) {
    if (wanted.has(id)) continue;
    input.editor.remove(id);
    input.created.delete(id);
    removed.push(id);
  }

  return { registered, removed };
}

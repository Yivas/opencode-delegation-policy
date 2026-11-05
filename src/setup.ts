import type { Plugin } from "@opencode/plugin";

import {
  agentDefinitions,
  type AgentDefinition,
  registerAgentDefinitions,
} from "./agents/register.js";
import type { AgentPermission } from "./agents/ids.js";
import {
  type AdvisorSafetyIssue,
  type EffectiveAgent,
  advisorSafetyIssues,
  orphanAgentIDs,
} from "./agents/safety.js";
import { PreferenceStateError, PreferenceStore } from "./state/store.js";
import {
  type AdvisorSelection,
  type DelegationValidation,
  type ModelCatalog,
  type RoleSelection,
  validatePreferenceAxes,
} from "./validation/models.js";

// Wires the parts that only make sense against a live host: the preference store, the agent
// registration and the check that reads the agents the host actually ended up with. Everything
// below is a port, so the wiring can be exercised with doubles and no host.
export type HostPorts = {
  readonly storage: Plugin.Context["storage"];
  readonly catalog: ModelCatalog;
  readonly agentTransform: Plugin.Context["agent"]["transform"];
  readonly agentList: Plugin.Context["agent"]["list"];
};

export type Wiring = {
  readonly store: PreferenceStore;
  // Registers the agents described by the global defaults and keeps the transform handle. An axis
  // in error keeps its previous agents instead of taking them away.
  register(): Promise<void>;
  // Reads the effective agents after the host applied its own configuration. Reports an advisor that
  // stopped being advice-only and any agent under the plugin's prefix that the current configuration
  // no longer defines. The caller decides what to do with each result.
  inspect(): Promise<AgentInspection>;
  // The plugin's agents as the host actually has them: defined by this plugin, present in the host's
  // effective list, and still on the model they were created with. The policy may only name these: a
  // session can turn delegation on, but it cannot create an agent, and the host's own configuration
  // can remove one or change its model after registration.
  agents(): Promise<readonly AgentDefinition[]>;
  dispose(): Promise<void>;
};

export type AgentInspection = {
  readonly registration: RegistrationState;
  readonly advisors: readonly AdvisorSafetyIssue[];
  readonly orphans: readonly string[];
};

// Why the agents may be missing. `unreadable` is the one that used to be invisible: the plugin starts,
// registers nothing and, without this value, looks exactly like a plugin that does nothing.
export type RegistrationState = "pending" | "registered" | "unreadable";

export function createWiring(ports: HostPorts): Wiring {
  const store = new PreferenceStore(ports.storage);
  const created = new Set<string>();
  // The selections the last successful pass saw, per axis. An axis that cannot be validated keeps
  // them instead of taking its agents away, and the other axis still registers normally.
  let roleSelections: readonly RoleSelection[] = [];
  let advisorSelections: readonly AdvisorSelection[] = [];
  let registration: { dispose(): Promise<void> } | undefined;
  let registered = false;
  let state: RegistrationState = "pending";

  const definitions = (): readonly AgentDefinition[] =>
    agentDefinitions({
      roles: roleSelections,
      advisors: advisorSelections,
    });

  return {
    store,

    async register() {
      // Agent registration happens once per host, so it reflects the global defaults. A session
      // override changes the model a launch passes, not the registered agent.
      let validation: DelegationValidation;
      try {
        const { preferences } = await store.readGlobal();
        validation = await validatePreferenceAxes({
          preferences,
          catalog: ports.catalog,
        });
      } catch (error) {
        // A preference document that cannot be read must not stop the plugin from loading; the
        // agents it already has stay as they are until the next pass. The reason is kept so the
        // status can say so instead of looking like a plugin that does nothing. Anything else is a
        // programming error, and swallowing it would hide the defect.
        if (!(error instanceof PreferenceStateError)) throw error;
        state = "unreadable";
        return;
      }
      if (validation.delegation.status !== "error") {
        roleSelections =
          validation.delegation.status === "active"
            ? validation.delegation.roles
            : [];
      }
      if (validation.advisor.status !== "error") {
        advisorSelections =
          validation.advisor.status === "off"
            ? []
            : validation.advisor.advisors;
      }
      // The callback reads the current definitions on every pass. Closing over a snapshot here would
      // keep the host rebuilding agents from the first configuration it ever saw.
      registration ??= await ports.agentTransform((editor) => {
        registerAgentDefinitions({
          editor,
          definitions: definitions(),
          created,
        });
      });
      registered = true;
      state = "registered";
    },

    async agents() {
      if (!registered) return [];
      const effective = new Map(
        effectiveModels(await ports.agentList()).map((agent) => [
          agent.id,
          agent.model,
        ]),
      );
      return definitions().filter((definition) => {
        const model = effective.get(definition.id);
        return (
          model !== undefined &&
          model.providerID === definition.model.providerID &&
          model.id === definition.model.id
        );
      });
    },

    async inspect() {
      // Before the plugin registered anything there is nothing to compare against: the host cannot
      // have our agents yet, and reporting every slot as missing would be noise.
      if (!registered)
        return { registration: state, advisors: [], orphans: [] };
      const current = definitions();
      const listed = await ports.agentList();
      const effective = effectiveAgents(listed);
      return {
        registration: state,
        advisors: advisorSafetyIssues({ definitions: current, effective }),
        orphans: orphanAgentIDs({ definitions: current, effective }),
      };
    },

    async dispose() {
      await registration?.dispose();
      registration = undefined;
      registered = false;
      state = "pending";
    },
  };
}

// The id and model of each agent the host lists. An entry without a readable model has none of its
// own (it would run on its caller's model), so it is left out rather than matched.
function effectiveModels(listed: unknown): readonly {
  readonly id: string;
  readonly model: { readonly providerID: string; readonly id: string };
}[] {
  const data = isRecord(listed) ? listed.data : undefined;
  if (!Array.isArray(data)) return [];
  const agents: {
    id: string;
    model: { providerID: string; id: string };
  }[] = [];
  for (const entry of data) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const model = entry.model;
    if (
      !isRecord(model) ||
      typeof model.providerID !== "string" ||
      typeof model.id !== "string"
    ) {
      continue;
    }
    agents.push({
      id: entry.id,
      model: { providerID: model.providerID, id: model.id },
    });
  }
  return agents;
}

// The host returns its own records; only the fields the check reads are taken, and an entry without
// a readable id or rule list is not treated as a safe advisor.
function effectiveAgents(listed: unknown): readonly EffectiveAgent[] {
  const data = isRecord(listed) ? listed.data : undefined;
  if (!Array.isArray(data)) return [];
  const agents: EffectiveAgent[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const id = entry.id;
    const permissions = entry.permissions;
    if (typeof id !== "string" || !Array.isArray(permissions)) continue;
    const rules: AgentPermission[] = [];
    for (const rule of permissions) {
      if (!isRecord(rule)) continue;
      const { action, resource, effect } = rule;
      if (
        typeof action !== "string" ||
        typeof resource !== "string" ||
        (effect !== "allow" && effect !== "deny" && effect !== "ask")
      ) {
        continue;
      }
      rules.push({ action, resource, effect });
    }
    agents.push({ id, permissions: rules });
  }
  return agents;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

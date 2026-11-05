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
import { PreferenceStore } from "./state/store.js";
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
      } catch {
        // A preference document that cannot be read must not stop the plugin from loading; the
        // agents it already has stay as they are until the next pass. The reason is kept so the
        // status can say so instead of looking like a plugin that does nothing.
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

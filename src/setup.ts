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
} from "./agents/safety.js";
import { PreferenceStore } from "./state/store.js";
import {
  type DelegationValidation,
  type ModelCatalog,
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
  // in error registers nothing at all: deleting the agents because a preference is temporarily
  // unreadable would take away what the user configured.
  register(): Promise<void>;
  // Reads the effective agents after the host applied its own configuration and reports an advisor
  // that stopped being advice-only. The caller decides what to do with the result.
  advisorSafety(): Promise<readonly AdvisorSafetyIssue[]>;
  dispose(): Promise<void>;
};

export function createWiring(ports: HostPorts): Wiring {
  const store = new PreferenceStore(ports.storage);
  const created = new Set<string>();
  let definitions: readonly AgentDefinition[] = [];
  let registration: { dispose(): Promise<void> } | undefined;

  return {
    store,

    async register() {
      // Agent registration happens once per host, so it reflects the global defaults. A session
      // override changes the model a launch passes, not the registered agent.
      const { preferences } = await store.readGlobal();
      const validation = await validatePreferenceAxes({
        preferences,
        catalog: ports.catalog,
      });
      const next = definitionsFor(validation);
      if (next === undefined) {
        // One axis cannot be validated, so nothing is registered or removed this pass.
        return;
      }
      definitions = next;
      registration ??= await ports.agentTransform((editor) => {
        registerAgentDefinitions({ editor, definitions, created });
      });
    },

    async advisorSafety() {
      if (definitions.length === 0) return [];
      const listed = await ports.agentList();
      return advisorSafetyIssues({
        definitions,
        effective: effectiveAgents(listed),
      });
    },

    async dispose() {
      await registration?.dispose();
      registration = undefined;
    },
  };
}

// An axis in error contributes no definitions, and the whole pass is skipped so nothing is removed.
function definitionsFor(
  validation: DelegationValidation,
): readonly AgentDefinition[] | undefined {
  if (
    validation.delegation.status === "error" ||
    validation.advisor.status === "error"
  ) {
    return undefined;
  }
  const roles =
    validation.delegation.status === "active"
      ? validation.delegation.roles
      : [];
  const advisors =
    validation.advisor.status === "off" ? [] : validation.advisor.advisors;
  return agentDefinitions({ roles, advisors });
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

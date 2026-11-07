import type { PermissionEvaluation } from "@opencode/plugin/promise/permission";

import {
  ADVISOR_ENVIRONMENT_RULES,
  advisorAgentID,
  isAdvisorAgentID,
  isAdvisorReadAction,
  ROLE_AGENTS,
  reservedAgentIDs,
} from "../agents/ids.js";
import type { AgentDefinition } from "../agents/register.js";
import type { PreferenceStore } from "../state/store.js";
import {
  type ModelCatalog,
  validatePreferenceAxes,
} from "../validation/models.js";
import { restrictToRegistered } from "./registered.js";

// The runtime half of the policy. The block in the main agent's request says what a session may do;
// this hook is where a launch the session does not offer is stopped, and where an Advisor is kept to
// reading even after the host applied its own configuration over the agent's rules.
//
// It only narrows. The host runs the configured rules first and returns before any hook when they
// deny, so the hook only ever sees "allow" or "ask", and the effect it leaves behind is what the host
// acts on. It never throws either: a rejection from a permission hook ends the tool call, and a guard
// that can break a call the host already decided is worse than no guard.
//
// Both decisions come from state the plugin already keeps, so the guard cannot disagree with the
// policy text about what a session offers.

// The one hook event the guard uses, narrowed from the host's permission domain so a test can drive it
// with a plain function.
type PermissionHook = (
  callback: (input: PermissionEvaluation) => void | Promise<void>,
) => Promise<{ dispose(): Promise<void> }>;

export type GuardDenial = {
  readonly action: string;
  readonly agent: string;
};

export type GuardState = "active" | "unavailable";

export type PermissionGuardPorts = {
  readonly store: Pick<PreferenceStore, "readSession">;
  readonly catalog: ModelCatalog;
  // The plugin's agents as the host has them, already filtered by the post-activation check: an
  // Advisor that stopped being read-only is not among them, and neither is one the host does not have
  // on the model it was created with.
  readonly agents: () => Promise<readonly AgentDefinition[]>;
  // Only `parentID` and `agent` are read. A child never changes parents, and a session's agent is the
  // one the host runs when a request does not name it.
  readonly session: (sessionID: string) => Promise<{
    readonly parentID?: string | undefined;
    readonly agent?: string | undefined;
  }>;
  // Told about every denial, for the local log. It must not throw.
  readonly denied: (denial: GuardDenial) => void;
  // The host's permission hook. A host that does not offer it leaves the guard unavailable, and the
  // status says so instead of the guard looking active.
  readonly hook?: PermissionHook | undefined;
};

export type PermissionGuard = {
  register(): Promise<void>;
  evaluate(input: PermissionEvaluation): Promise<void>;
  state(): GuardState;
  dispose(): Promise<void>;
};

const RESERVED_IDS = new Set(reservedAgentIDs());

// The host's own subagent depth limit is 1, so a chain this long is not one it produces; the walk
// stops rather than following a broken one.
const MAX_ANCESTORS = 16;

export function createPermissionGuard(
  ports: PermissionGuardPorts,
): PermissionGuard {
  let registration: { dispose(): Promise<void> } | undefined;
  let current: GuardState = "unavailable";

  function deny(
    input: PermissionEvaluation,
    agents: readonly string[],
    message: string,
  ): void {
    input.effect = "deny";
    input.message = message;
    for (const agent of agents) {
      try {
        ports.denied({ action: input.action, agent });
      } catch {
        // Recording is an observation. A log that refuses must not change the decision.
      }
    }
  }

  // Who is asking. The host sets `agent` on a tool call; when it does not, the session's own agent is
  // the only other source, and a lookup that fails leaves the answer unknown.
  async function askingAgent(
    input: PermissionEvaluation,
  ): Promise<string | undefined> {
    const agent = input.agent;
    if (agent !== undefined && agent !== "") return agent;
    const { agent: sessionAgent } = await ports.session(input.sessionID);
    return sessionAgent === undefined || sessionAgent === ""
      ? undefined
      : sessionAgent;
  }

  // An Advisor may only read. Once the asking agent is known to be one, the decision uses no host
  // state, so nothing can fail between knowing it and denying: that is what makes this path
  // fail-closed. When the agent cannot be resolved, the request is not known to be an Advisor's, and
  // it is left exactly as the host decided it.
  async function advisorDenial(input: PermissionEvaluation): Promise<boolean> {
    const agent = await askingAgent(input);
    if (agent === undefined || !isAdvisorAgentID(agent)) return false;
    if (!isAdvisorReadAction(input.action)) {
      deny(
        input,
        [agent],
        `An Advisor may only read files in this project: ${input.action} is not allowed for it.`,
      );
      return true;
    }
    if (
      input.action === "read" &&
      input.resources.some(environmentFileDenied)
    ) {
      deny(input, [agent], "An Advisor may not read environment files.");
      return true;
    }
    return false;
  }

  async function launchDenial(input: PermissionEvaluation): Promise<void> {
    if (input.action !== "subagent") return;
    const targets = input.resources.filter((resource) =>
      RESERVED_IDS.has(resource),
    );
    if (targets.length === 0) return;

    // A delegated agent never delegates: the policy says so, and a child session carries no policy
    // text that could remind it.
    if (input.agent !== undefined && RESERVED_IDS.has(input.agent)) {
      deny(
        input,
        targets,
        `A delegated agent cannot launch ${targets.join(", ")}: only the main agent delegates.`,
      );
      return;
    }

    let offered: ReadonlySet<string>;
    try {
      offered = await offeredAgentIDs(input.sessionID);
    } catch {
      // The session's policy cannot be established, and a reserved id is offered only when the policy
      // says so: unknown is not offered. Only the plugin's own ids are affected, and the log records it.
      deny(
        input,
        targets,
        `The delegation policy of this session cannot be read, so it does not offer ${targets.join(", ")}.`,
      );
      return;
    }
    const missing = targets.filter((target) => !offered.has(target));
    if (missing.length === 0) return;
    deny(
      input,
      missing,
      `The delegation policy of this session does not offer ${missing.join(", ")}.`,
    );
  }

  // The reserved agents the session's policy offers, from the same effective state and the same
  // registration check the policy text is built from: a role or Advisor the validator rejects, that
  // the host does not have on its configured model, or that no longer passes the read-only check is
  // not offered, exactly as the block would not name it.
  async function offeredAgentIDs(
    sessionID: string,
  ): Promise<ReadonlySet<string>> {
    const { preferences } = await ports.store.readSession(
      await policyRoot(sessionID),
    );
    const validation = restrictToRegistered(
      await validatePreferenceAxes({
        preferences,
        catalog: ports.catalog,
      }),
      await ports.agents(),
    );
    const offered = new Set<string>();
    if (validation.delegation.status === "active") {
      for (const selection of validation.delegation.roles) {
        offered.add(ROLE_AGENTS[selection.role].id);
      }
    }
    if (
      validation.advisor.status === "active" ||
      validation.advisor.status === "partial"
    ) {
      for (const selection of validation.advisor.advisors) {
        offered.add(advisorAgentID(selection.advisor));
      }
    }
    return offered;
  }

  // The session whose policy a launch follows. A child was launched under its parent's policy and the
  // store keeps no document of its own for it, so the walk ends at the root.
  async function policyRoot(sessionID: string): Promise<string> {
    let currentID = sessionID;
    const seen = new Set<string>([currentID]);
    for (let step = 0; step < MAX_ANCESTORS; step += 1) {
      const { parentID } = await ports.session(currentID);
      if (parentID === undefined || parentID === "" || seen.has(parentID)) {
        return currentID;
      }
      seen.add(parentID);
      currentID = parentID;
    }
    return currentID;
  }

  async function evaluate(input: PermissionEvaluation): Promise<void> {
    // A deny the configured rules produced never reaches this hook; one another plugin produced is
    // already the strictest answer and is left exactly as it is.
    if (input.effect === "deny") return;
    try {
      if (await advisorDenial(input)) return;
      await launchDenial(input);
    } catch {
      // Only a defect in this module reaches here: every host call the guard needs is caught where it
      // is made. A defect must not become a rejection that ends the tool call.
    }
  }

  return {
    async register() {
      const hook = ports.hook;
      if (hook === undefined) return;
      registration = await hook((input) => evaluate(input));
      current = "active";
    },
    evaluate,
    state: () => current,
    async dispose() {
      const handle = registration;
      if (handle === undefined) return;
      await handle.dispose();
      registration = undefined;
      current = "unavailable";
    },
  };
}

// The Advisor's own environment rules, evaluated the way the host evaluates a rule list: the last rule
// whose action and resource match decides. Using the rules themselves keeps the guard and the agent
// profile from disagreeing about which file is readable.
function environmentFileDenied(resource: string): boolean {
  let denied = false;
  for (const rule of ADVISOR_ENVIRONMENT_RULES) {
    if (rule.action !== "read" || !matchesWildcard(resource, rule.resource)) {
      continue;
    }
    denied = rule.effect === "deny";
  }
  return denied;
}

// The host's resource matcher (packages/core/src/util/wildcard.ts at dc2ffcf8, blob 65608026):
// backslashes become slashes on both sides, `*` matches any run of characters and `?` a single one,
// and the whole string must match. The host also relaxes a pattern ending in " .*" to an optional
// suffix; no pattern here contains a space, so that branch cannot apply.
function matchesWildcard(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/");
  const escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(
    `^${escaped}$`,
    process.platform === "win32" ? "si" : "s",
  ).test(normalized);
}

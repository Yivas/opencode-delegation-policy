import type { Plugin } from "@opencode/plugin";

import { delegateArguments, runDelegate } from "./command/delegate.js";
import { createPreferenceEditor } from "./editor/server.js";
import { footerState } from "./footer-state.js";
import { createLocalLog } from "./log/local-log.js";
import { createPolicyInjector } from "./policy/inject.js";
import { createPermissionGuard } from "./policy/permission-guard.js";
import { watchTurns } from "./policy/turns.js";
import { delegateRpc } from "./rpc.js";
import { createWiring } from "./setup.js";
import {
  adaptHostRead,
  adaptHostTransform,
  createOwnedBudgetVariantProvisioner,
} from "./thinking/provisioning.js";

const delegationPolicy: Plugin.Plugin = {
  id: "opencode-delegation-policy",
  async setup(context) {
    const provisioner = createOwnedBudgetVariantProvisioner({
      transform: adaptHostTransform(
        context.model.transform.bind(context.model),
      ),
      read: adaptHostRead(context.model.list.bind(context.model)),
    });
    const wiring = createWiring({
      storage: context.storage,
      catalog: context.model,
      agentTransform: context.agent.transform.bind(context.agent),
      agentList: context.agent.list.bind(context.agent),
    });

    // `/delegate` lives in the TUI entry, which shows the answer in a dialog; the server only answers
    // its RPC call. A server-side slash command would answer through a session message whose
    // visibility nothing verified, and two commands with one name have no known precedence.
    // Content-free, local, in the plugin's own storage; see src/log/local-log.ts for what it keeps.
    const log = createLocalLog({
      storage: context.storage,
      hostVersion: context.app.version,
    });
    // The runtime half of the policy: a launch the session does not offer, and an Advisor kept to
    // reading, are refused here instead of only being described in the block. A host that does not
    // offer the permission hook still runs the plugin, and the status says the guard is not active.
    const permission = context.permission as
      | Plugin.Context["permission"]
      | undefined;
    const permissionHook = permission?.hook.bind(permission);
    const guard = createPermissionGuard({
      store: wiring.store,
      catalog: context.model,
      agents: () => wiring.agents(),
      session: (sessionID) => context.session.get({ sessionID }),
      denied: (denial) => log.denial(denial),
      hook:
        permissionHook === undefined
          ? undefined
          : (callback) => permissionHook("evaluate", callback),
    });
    // The session's creation time, in the host's epoch milliseconds. Read only when a setting is
    // waiting for the next session.
    const createdAt = (sessionID: string) =>
      context.session.get({ sessionID }).then((info) => info.time.created);
    const injector = createPolicyInjector({
      store: wiring.store,
      catalog: context.model,
      session: (sessionID) => context.session.get({ sessionID }),
      createdAt,
      agents: () => wiring.agents(),
      injected: (block, preferences) => log.policy(block, preferences),
    });
    const delegatePorts = {
      store: wiring.store,
      catalog: context.model,
      inspect: () => wiring.inspect(),
      agents: () => wiring.agents(),
      injection: () => injector.last(),
      guard: () => guard.state(),
      turns: () => turns?.state() ?? "stopped",
      log: (limit: number) => log.recent(limit),
      // A lookup that fails is read as "gone": nothing is written for a session the host cannot find.
      sessionExists: (sessionID: string) =>
        context.session.get({ sessionID }).then(
          () => true,
          () => false,
        ),
    };
    let rpcRegistration:
      | Awaited<ReturnType<typeof context.rpc.register<typeof delegateRpc>>>
      | undefined;
    // Tells footers to read again. The event carries no state and may be missed; the footer also
    // reads on its own period, so a failed emit is not an error worth surfacing.
    const announceChange = () => {
      try {
        rpcRegistration?.events.emit("changed", {}).catch(() => {});
      } catch {
        // A host without RPC events still answers the call; the footer reads on its own period.
      }
    };
    let hookRegistration: { dispose: () => Promise<void> } | undefined;
    // Listens for turns that finished successfully, which consume a configuration notice. It only
    // reads the host's public event stream and stops with the plugin.
    const events = new AbortController();
    let turns: ReturnType<typeof watchTurns> | undefined;

    // Each registration is retired on its own: one that refuses must not leave the others alive. A
    // handle that was retired is forgotten, so a retry does not dispose it twice. The first failure
    // is the one reported, after everything had its turn.
    const retireAll = async (): Promise<void> => {
      const failures: unknown[] = [];
      const attempt = async (retire: () => Promise<void>) => {
        try {
          await retire();
        } catch (error) {
          failures.push(error);
        }
      };
      events.abort();
      const hook = hookRegistration;
      if (hook !== undefined) {
        await attempt(async () => {
          await hook.dispose();
          hookRegistration = undefined;
        });
      }
      await attempt(() => guard.dispose());
      const handle = rpcRegistration;
      if (handle !== undefined) {
        await attempt(async () => {
          await handle.dispose();
          rpcRegistration = undefined;
        });
      }
      await attempt(() => wiring.dispose());
      await attempt(() => provisioner.dispose());
      if (failures.length > 0) throw failures[0];
    };

    try {
      await provisioner.register();
      await wiring.register();
      const editor = createPreferenceEditor(delegatePorts);
      rpcRegistration = await context.rpc.register(delegateRpc, {
        editorRead: (input) => editor.read(input),
        editorPreview: (input) => editor.preview(input),
        editorApply: async (input) => {
          try {
            return await editor.apply(input);
          } finally {
            announceChange();
          }
        },
        footer: async (input) => {
          const { sessionID } = (input ?? {}) as { sessionID?: unknown };
          return footerState(
            {
              store: wiring.store,
              catalog: context.model,
              agents: () => wiring.agents(),
              parentOf: async (id) =>
                (await context.session.get({ sessionID: id })).parentID,
            },
            typeof sessionID === "string" && sessionID !== ""
              ? sessionID
              : undefined,
          );
        },
        run: async (input) => {
          // The host checks the input against the contract before this runs, so anything else is a
          // defect and fails loudly instead of being read as an empty command.
          const { line, sessionID } = (input ?? {}) as {
            line?: unknown;
            sessionID?: unknown;
          };
          if (typeof line !== "string") {
            throw new TypeError("the delegate request carries no line");
          }
          try {
            return {
              text: await runDelegate(delegateArguments(line), delegatePorts, {
                ...(typeof sessionID === "string" && sessionID !== ""
                  ? { sessionID }
                  : {}),
              }),
            };
          } finally {
            announceChange();
          }
        },
      });
      hookRegistration = await context.session.hook("context", (request) =>
        injector.apply(request),
      );
      await guard.register();
      turns = watchTurns({
        subscribe: (options) => context.event.subscribe(options),
        ended: (sessionID, succeeded) =>
          injector.turnEnded(sessionID, succeeded),
        // A root session claims the setting saved for the next one as soon as it exists, which is
        // earlier than its first request. A child never claims: its values come from its parent's
        // launch, and the policy never reaches it.
        created: (sessionID, parentID) => {
          if (parentID !== undefined && parentID !== "") return;
          void injector.claim(sessionID);
        },
        observe: (event) => log.observe(event),
        signal: events.signal,
      });
    } catch (error) {
      // Registration may retain a handle after another setup step fails; retire all before failing.
      // A retirement that fails is the error reported, as it was before the RPC existed: it means
      // something may still be registered, which matters more than why setup stopped.
      await retireAll();
      throw error;
    }

    return retireAll;
  },
};

export default delegationPolicy;

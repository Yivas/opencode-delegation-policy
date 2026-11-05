import type { Plugin } from "@opencode/plugin";

import { delegateArguments, runDelegate } from "./command/delegate.js";
import { createPolicyInjector } from "./policy/inject.js";
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
    const injector = createPolicyInjector({
      store: wiring.store,
      catalog: context.model,
      session: (sessionID) => context.session.get({ sessionID }),
      agents: () => wiring.agents(),
    });
    const delegatePorts = {
      store: wiring.store,
      catalog: context.model,
      inspect: () => wiring.inspect(),
      agents: () => wiring.agents(),
      injection: () => injector.last(),
      // A lookup that fails is read as "gone": nothing is written for a session the host cannot find.
      sessionExists: (sessionID: string) =>
        context.session.get({ sessionID }).then(
          () => true,
          () => false,
        ),
    };
    let rpcRegistration: { dispose: () => Promise<void> } | undefined;
    let hookRegistration: { dispose: () => Promise<void> } | undefined;
    // Listens for turns that finished successfully, which consume a configuration notice. It only
    // reads the host's public event stream and stops with the plugin.
    const events = new AbortController();

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
      rpcRegistration = await context.rpc.register(delegateRpc, {
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
          return {
            text: await runDelegate(delegateArguments(line), delegatePorts, {
              ...(typeof sessionID === "string" && sessionID !== ""
                ? { sessionID }
                : {}),
            }),
          };
        },
      });
      hookRegistration = await context.session.hook("context", (request) =>
        injector.apply(request),
      );
      void (async () => {
        for await (const event of context.event.subscribe({
          signal: events.signal,
        })) {
          if (event.type === "session.execution.succeeded") {
            injector.turnSucceeded(event.data.sessionID);
          }
        }
      })().catch(() => {
        // A stream that ends or fails only means notices stay until the next successful turn is
        // seen; it must never take the plugin down.
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

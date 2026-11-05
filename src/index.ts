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
    });
    const delegatePorts = {
      store: wiring.store,
      catalog: context.model,
      inspect: () => wiring.inspect(),
      injection: () => injector.last(),
    };
    let rpcRegistration: { dispose: () => Promise<void> } | undefined;
    let hookRegistration: { dispose: () => Promise<void> } | undefined;

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
          const line = (input as { line?: unknown } | null)?.line;
          if (typeof line !== "string") {
            throw new TypeError("the delegate request carries no line");
          }
          return {
            text: await runDelegate(delegateArguments(line), delegatePorts),
          };
        },
      });
      hookRegistration = await context.session.hook("context", (request) =>
        injector.apply(request),
      );
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

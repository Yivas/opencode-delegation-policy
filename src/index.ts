import type { Plugin } from "@opencode/plugin";

import { createDelegateCommand } from "./command/delegate.js";
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

    const command = createDelegateCommand({
      store: wiring.store,
      catalog: context.model,
      inspect: () => wiring.inspect(),
      // Unverified against a real host: whether a synthetic message is shown to the user, and
      // whether it starts a model turn. `resume: false` asks for neither a turn nor a side effect.
      reply: async (sessionID, text) => {
        await context.session.synthetic({ sessionID, text, resume: false });
      },
    });
    let commandRegistration: { dispose: () => Promise<void> } | undefined;

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
      const handle = commandRegistration;
      if (handle !== undefined) {
        await attempt(async () => {
          await handle.dispose();
          commandRegistration = undefined;
        });
      }
      await attempt(() => wiring.dispose());
      await attempt(() => provisioner.dispose());
      if (failures.length > 0) throw failures[0];
    };

    try {
      await provisioner.register();
      await wiring.register();
      commandRegistration = await context.command.transform((editor) => {
        editor.add(command);
      });
    } catch (error) {
      // Registration may retain a handle after another setup step fails; retire all before failing.
      // A retirement that fails is the error reported, as it was before the command existed: it means
      // something may still be registered, which matters more than why setup stopped.
      await retireAll();
      throw error;
    }

    return retireAll;
  },
};

export default delegationPolicy;

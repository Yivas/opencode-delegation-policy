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
      // Unverified against a real host: whether a synthetic message is shown to the user, and
      // whether it starts a model turn. `resume: false` asks for neither a turn nor a side effect.
      reply: async (sessionID, text) => {
        await context.session.synthetic({
          sessionID: sessionID as Parameters<
            typeof context.session.synthetic
          >[0]["sessionID"],
          text,
          resume: false,
        });
      },
    });
    let commandRegistration: { dispose: () => Promise<void> } | undefined;

    try {
      await provisioner.register();
      await wiring.register();
      commandRegistration = await context.command.transform((editor) => {
        editor.add(command);
      });
    } catch (error) {
      // Registration may retain a handle after another setup step fails; retire all before failing.
      await commandRegistration?.dispose();
      await wiring.dispose();
      await provisioner.dispose();
      throw error;
    }

    return async () => {
      await commandRegistration?.dispose();
      await wiring.dispose();
      await provisioner.dispose();
    };
  },
};

export default delegationPolicy;

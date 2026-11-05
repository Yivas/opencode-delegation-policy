import type { Plugin } from "@opencode/plugin";

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

    try {
      await provisioner.register();
      await wiring.register();
    } catch (error) {
      // Registration may retain a handle after another setup step fails; retire both before failing.
      await wiring.dispose();
      await provisioner.dispose();
      throw error;
    }

    return async () => {
      await wiring.dispose();
      await provisioner.dispose();
    };
  },
};

export default delegationPolicy;

import type { Plugin } from "@opencode/plugin";

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

    try {
      await provisioner.register();
    } catch (error) {
      // Registration may retain a handle after another setup step fails; retire it before failing.
      await provisioner.dispose();
      throw error;
    }

    return () => provisioner.dispose();
  },
};

export default delegationPolicy;

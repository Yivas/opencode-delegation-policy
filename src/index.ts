import type { Plugin } from "@opencode/plugin";

// Setup deliberately has no host effects until state and policy hooks are connected.
// The entry can be imported and checked without loading the SDK at runtime.
const delegationPolicy: Plugin.Plugin = {
  id: "opencode-delegation-policy",
  setup() {},
};

export default delegationPolicy;

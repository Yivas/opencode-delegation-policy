import type { Rpc } from "@opencode/plugin/rpc";

// The contract the TUI entry and the server share, published as the `./rpc` subpath. It carries no
// server code: both sides load it, and the TUI must not pull the server in with it. It is a plain
// literal checked against the host type, so the emitted module imports nothing at runtime;
// `Rpc.define` would only add a check of reserved error names this contract does not use.
//
// Temporary on purpose: one method that forwards the raw `/delegate` line and returns the text to
// show. The full selector replaces it with real methods; this only keeps the minimal command
// visible to the person who ran it.
export const delegateRpc = {
  id: "opencode-delegation-policy-delegate",
  methods: {
    run: {
      input: {
        type: "object",
        properties: { line: { type: "string" } },
        required: ["line"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  events: {},
} as const satisfies Rpc.PortableDefinition;

export default delegateRpc;

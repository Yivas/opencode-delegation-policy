import { Rpc } from "@opencode/plugin/rpc";

// The contract the TUI entry and the server share, published as the `./rpc` subpath. It carries no
// server code: both sides load it, and the TUI must not pull the server in with it.
//
// Temporary on purpose: one method that forwards the raw `/delegate` line and returns the text to
// show. The full selector replaces it with real methods; this only keeps the minimal command
// visible to the person who ran it.
export const delegateRpc = Rpc.define({
  id: "opencode-delegation-policy.delegate",
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
});

export default delegateRpc;

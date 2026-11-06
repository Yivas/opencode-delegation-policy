import type { Rpc } from "@opencode/plugin/rpc";

import {
  editorChangeInput,
  editorChangeOutput,
  editorReadInput,
  editorReadOutput,
} from "./editor/contract.js";

// The contract the TUI entry and the server share, published as the `./rpc` subpath. It carries no
// server code: both sides load it, and the TUI must not pull the server in with it. It is a plain
// literal checked against the host type, so the emitted module imports nothing at runtime;
// `Rpc.define` would only add a check of reserved error names this contract does not use.
//
// Typed commands keep their raw-line method. The editor reads a server snapshot, previews without
// writing and applies a draft only against its source revision; no host metadata crosses this port.
export const delegateRpc = {
  id: "opencode-delegation-policy-delegate",
  methods: {
    editorRead: { input: editorReadInput, output: editorReadOutput },
    editorPreview: { input: editorChangeInput, output: editorChangeOutput },
    editorApply: { input: editorChangeInput, output: editorChangeOutput },
    run: {
      input: {
        type: "object",
        properties: {
          line: { type: "string" },
          sessionID: { type: "string" },
        },
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

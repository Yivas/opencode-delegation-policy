import type { Rpc } from "@opencode/plugin/rpc";

import {
  editorChangeInput,
  editorChangeOutput,
  editorReadInput,
  editorReadOutput,
} from "./editor/contract.js";
import { ADVISOR_TOKENS, DELEGATION_TOKENS } from "./footer.js";

// The contract the TUI entry and the server share, published as the `./rpc` subpath. It carries no
// server code: both sides load it, and the TUI must not pull the server in with it. It is a plain
// literal checked against the host type, so the emitted module imports no host module at runtime;
// `Rpc.define` would only add a check of reserved error names this contract does not use.
//
// Typed commands keep their raw-line method. The editor reads a server snapshot, previews without
// writing and applies a draft only against its source revision; no host metadata crosses this port.
// The footer reads one token per axis; `changed` only tells it to read again, it carries no state.
export const delegateRpc = {
  id: "opencode-delegation-policy-delegate",
  methods: {
    editorRead: { input: editorReadInput, output: editorReadOutput },
    editorPreview: { input: editorChangeInput, output: editorChangeOutput },
    editorApply: { input: editorChangeInput, output: editorChangeOutput },
    footer: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          delegation: { type: "string", enum: [...DELEGATION_TOKENS] },
          advisor: { type: "string", enum: [...ADVISOR_TOKENS] },
        },
        required: ["delegation", "advisor"],
        additionalProperties: false,
      },
    },
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
  events: {
    changed: {
      schema: { type: "object", properties: {}, additionalProperties: false },
    },
  },
} as const satisfies Rpc.PortableDefinition;

export default delegateRpc;

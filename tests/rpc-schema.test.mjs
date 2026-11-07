import assert from "node:assert/strict";
import { test } from "node:test";

// `effect` is the host SDK's own dependency, pinned through the lockfile. The conversion below is the
// one OpenCode 2.2.5 applies to plugin RPC schemas (packages/core/src/rpc.ts, `parse`).
import { JsonSchema, Schema, SchemaRepresentation } from "effect";

import { delegateRpc } from "../dist/rpc.js";

function hostCodec(schema) {
  return Schema.make(
    SchemaRepresentation.fromJsonSchemaDocument(
      JsonSchema.fromSchemaDraft2020_12(schema),
    ).ast,
  );
}

// A schema the host cannot convert fails every call at runtime, with rpc.invalid_input or
// rpc.invalid_output, while type checks and the in-process tests still pass. That happened with a
// `pattern`, which the host refuses.
test("every RPC schema converts the way the host converts it", () => {
  for (const [name, method] of Object.entries(delegateRpc.methods)) {
    for (const side of ["input", "output"]) {
      assert.doesNotThrow(
        () => hostCodec(method[side]),
        `${name}.${side} must convert`,
      );
    }
  }
  for (const [name, event] of Object.entries(delegateRpc.events ?? {})) {
    assert.doesNotThrow(() => hostCodec(event.schema), `event ${name}`);
  }
});

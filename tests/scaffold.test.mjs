import assert from "node:assert/strict";
import { test } from "node:test";

import delegationPolicy from "../dist/index.js";

// Stands in for the host context. Any trap (get, has, ownKeys, ...) throws, so setup
// fails the test if it reads host services before they are implemented.
function hostBoundaryDouble() {
  const failingTrap = (trapName) => () => {
    throw new Error(`unexpected host context access: ${trapName}`);
  };
  const trapsByName = {
    get: (_handler, trapName) => failingTrap(String(trapName)),
  };
  return new Proxy({}, new Proxy({}, trapsByName));
}

test("exports the plugin identifier and a setup function", () => {
  assert.equal(delegationPolicy.id, "opencode-delegation-policy");
  assert.equal(typeof delegationPolicy.setup, "function");
});

test("setup completes without touching the host context", async () => {
  const cleanup = await delegationPolicy.setup(hostBoundaryDouble());

  assert.equal(cleanup, undefined);
});

test("setup can run repeatedly with the same empty result", async () => {
  const context = hostBoundaryDouble();

  assert.equal(await delegationPolicy.setup(context), undefined);
  assert.equal(await delegationPolicy.setup(context), undefined);
});

test("module evaluation repeats with the same identifier", async () => {
  const firstLoad = await import("../dist/index.js?load=first");
  const secondLoad = await import("../dist/index.js?load=second");

  assert.equal(firstLoad.default.id, "opencode-delegation-policy");
  assert.equal(secondLoad.default.id, "opencode-delegation-policy");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import delegateRpc from "../dist/rpc.js";
import tuiPlugin, {
  describeRpcFailure,
  runDelegateInTui,
} from "../dist/tui.js";

function ports(run) {
  const alerts = [];
  const requested = [];
  return {
    alerts,
    requested,
    ports: {
      rpc: (definition) => {
        requested.push(definition);
        return { run };
      },
      alert: async (options) => {
        alerts.push(options);
      },
    },
  };
}

test("the answer from the server is what the person sees", async () => {
  const seen = [];
  const {
    alerts,
    requested,
    ports: doubles,
  } = ports(async (input) => {
    seen.push(input);
    return { text: "Saved.\nIntensity: normal" };
  });

  await runDelegateInTui("intensity normal", doubles);

  assert.deepEqual(seen, [{ line: "intensity normal" }]);
  assert.equal(requested[0], delegateRpc);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].message, "Saved.\nIntensity: normal");
});

test("a command typed without arguments still reaches the server", async () => {
  const seen = [];
  const { ports: doubles } = ports(async (input) => {
    seen.push(input);
    return { text: "status" };
  });

  await runDelegateInTui(undefined, doubles);

  assert.deepEqual(seen, [{ line: "" }]);
});

test("a server that did not answer says nothing was changed, and never claims a save", async () => {
  for (const type of [
    "rpc.unavailable",
    "rpc.method_not_found",
    "rpc.invalid_input",
  ]) {
    const { alerts, ports: doubles } = ports(async () => {
      throw { type, message: "host detail" };
    });

    await runDelegateInTui("intensity normal", doubles);

    assert.match(alerts[0].message, /nothing was changed/, type);
    assert.doesNotMatch(alerts[0].message, /host detail|Saved/, type);
  }
});

test("a failure that may have run the handler is reported as unconfirmed", async () => {
  for (const failure of [
    { type: "rpc.internal", message: "boom" },
    { type: "rpc.invalid_output", message: "bad" },
    new Error("connection lost"),
    "a string",
  ]) {
    const { alerts, ports: doubles } = ports(async () => {
      throw failure;
    });

    await runDelegateInTui("intensity normal", doubles);

    assert.match(alerts[0].message, /could not be confirmed/);
    // "Not saved" would contradict a write that may have landed.
    assert.doesNotMatch(alerts[0].message, /nothing was changed|not saved/i);
    assert.doesNotMatch(alerts[0].message, /boom|connection lost/);
  }
});

test("a reply without text is not shown as an empty success", async () => {
  const { alerts, ports: doubles } = ports(async () => ({ unexpected: true }));

  await runDelegateInTui("", doubles);

  assert.match(alerts[0].message, /could not be confirmed/);
});

test("a request that never ran and one that may have run are told apart", () => {
  assert.notEqual(
    describeRpcFailure({ type: "rpc.unavailable" }),
    describeRpcFailure({ type: "rpc.internal" }),
  );
});

test("the entry registers /delegate with the raw line and forwards it", async () => {
  const layers = [];
  const alerts = [];
  const calls = [];
  const context = {
    keymap: { layer: (input) => layers.push(input) },
    client: {
      rpc: (definition) => ({
        run: async (input) => {
          calls.push({ definition, input });
          return { text: "ok" };
        },
      }),
    },
    ui: {
      dialog: {
        alert: async (options) => {
          alerts.push(options);
        },
      },
    },
  };

  assert.equal(tuiPlugin.id, "opencode-delegation-policy");
  tuiPlugin.setup(context);

  const [command] = layers[0]().commands;
  assert.deepEqual(command.slash, { name: "delegate", arguments: true });
  await command.run("role small acme/small-model");

  assert.deepEqual(calls[0].input, { line: "role small acme/small-model" });
  assert.equal(calls[0].definition, delegateRpc);
  assert.equal(alerts[0].message, "ok");
});

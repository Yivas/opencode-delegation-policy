import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDelegateCommand,
  delegateArguments,
  runDelegate,
} from "../dist/command/delegate.js";
import { PreferenceStore } from "../dist/state/store.js";

function storageDouble() {
  const records = new Map();
  return {
    records,
    async get(key) {
      const text = records.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    async set(key, value) {
      records.set(key, JSON.stringify(value));
    },
    async remove(key) {
      records.delete(key);
    },
  };
}

function model(providerID, id) {
  return {
    id,
    modelID: id,
    providerID,
    name: id,
    package: "@opencode/ai/providers/groq",
    enabled: true,
    limit: { context: 200000, output: 32000 },
    variants: [],
  };
}

function setup() {
  const storage = storageDouble();
  const store = new PreferenceStore(storage);
  const catalog = {
    async list() {
      return {
        location: { directory: "/synthetic" },
        data: [model("acme", "small-model"), model("acme", "advisor-model")],
      };
    },
  };
  return { storage, store, ports: { store, catalog } };
}

test("the defaults set from the command are what registration later reads", async () => {
  const { store, ports } = setup();

  await runDelegate("intensity normal", ports);
  await runDelegate("role small acme/small-model", ports);
  const text = await runDelegate("advisors acme/advisor-model", ports);

  const { preferences } = await store.readGlobal();
  assert.equal(preferences.intensity, "normal");
  assert.deepEqual(preferences.roles.small, {
    kind: "configured",
    model: "acme/small-model",
  });
  assert.deepEqual(preferences.advisors, {
    kind: "configured",
    models: ["acme/advisor-model"],
  });
  // The reply says what the saved defaults do, not just that they were saved.
  assert.match(text, /Delegation: active, roles small/);
  assert.match(text, /Advisors: active, usable 1/);
  assert.match(text, /restart/i);
});

test("input the command cannot understand writes nothing", async () => {
  const { storage, ports } = setup();

  for (const line of [
    "intensity loud",
    "role huge acme/small-model",
    "role small",
    "advisors a b c d",
    "mystery",
  ]) {
    const text = await runDelegate(line, ports);
    assert.match(text, /Usage:/, line);
  }

  assert.equal(storage.records.size, 0);
});

test("a model the catalogue does not offer is saved and reported, not hidden", async () => {
  const { ports } = setup();

  // Intensity is off by default, so nothing is validated until delegation is on.
  await runDelegate("intensity normal", ports);
  const text = await runDelegate("role small acme/nope", ports);

  assert.match(text, /Saved\./);
  assert.match(text, /role small: model-not-found/);
});

test("the command accepts the whole line or only the arguments", async () => {
  assert.equal(
    delegateArguments("/delegate intensity normal"),
    "intensity normal",
  );
  assert.equal(delegateArguments("intensity normal"), "intensity normal");
  assert.equal(delegateArguments("/delegate"), "");
});

test("the command answers in the session it was invoked from", async () => {
  const { ports } = setup();
  const replies = [];
  const command = createDelegateCommand({
    ...ports,
    reply: async (sessionID, text) => {
      replies.push({ sessionID, text });
    },
  });

  await command.execute({
    sessionID: "ses_one",
    prompt: { text: "/delegate intensity aggressive" },
  });

  assert.equal(command.name, "delegate");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].sessionID, "ses_one");
  assert.match(replies[0].text, /Intensity: aggressive/);
});

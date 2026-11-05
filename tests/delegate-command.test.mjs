import assert from "node:assert/strict";
import { test } from "node:test";

import { delegateArguments, runDelegate } from "../dist/command/delegate.js";
import { createWiring } from "../dist/setup.js";
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
  const { storage, store, ports } = setup();

  await runDelegate("intensity normal", ports);
  const partial = await runDelegate("role small acme/small-model", ports);
  // Until every ordinary role is decided, the report names the ones still missing.
  assert.match(
    partial,
    /role medium: not-configured; role large: not-configured/,
  );
  await runDelegate("role medium off", ports);
  await runDelegate("role large off", ports);
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
  assert.match(text, /Delegation check: active, roles small/);
  assert.match(text, /Advisor check: active, usable 1/);
  assert.match(text, /restart/i);

  // And a later start of the plugin, over the same storage, registers exactly those agents.
  const registered = new Map();
  const wiring = createWiring({
    storage,
    catalog: ports.catalog,
    agentTransform: async (callback) => {
      callback({
        get: (id) => registered.get(id),
        list: () => [...registered.values()],
        default() {},
        update(id, mutate) {
          const agent = registered.get(id) ?? { id, name: id, permissions: [] };
          mutate(agent);
          registered.set(id, agent);
        },
        remove: (id) => registered.delete(id),
      });
      return { dispose: async () => {} };
    },
    agentList: async () => ({ data: [] }),
  });
  await wiring.register();
  assert.deepEqual([...registered.keys()].sort(), [
    "ocv2-advisor-1",
    "ocv2-small",
  ]);
});

test("input the command cannot understand writes nothing", async () => {
  const { storage, ports } = setup();

  for (const line of [
    "intensity loud",
    "role huge acme/small-model",
    "role small",
    "advisors a b c d",
    // A keyword mixed with models would be saved as a model reference called "off".
    "advisors off acme/small-model",
    "advisors acme/small-model unset",
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

test("role names map to their stored keys and variants pass through", async () => {
  const { store, ports } = setup();

  await runDelegate("role visual-design acme/small-model#high", ports);
  await runDelegate("advisors off", ports);

  const { preferences } = await store.readGlobal();
  assert.deepEqual(preferences.roles.visualDesign, {
    kind: "configured",
    model: "acme/small-model#high",
  });
  assert.deepEqual(preferences.roles.small, { kind: "unset" });
  assert.deepEqual(preferences.advisors, { kind: "disabled" });
});

test("the arguments are found after any whitespace separator", () => {
  assert.equal(
    delegateArguments("/delegate\tintensity normal"),
    "intensity normal",
  );
  // A different command that merely starts with the same letters is not this one.
  assert.equal(delegateArguments("/delegatefoo bar"), "/delegatefoo bar");
});

test("an unreadable saved document is explained on read as well as on save", async () => {
  const { storage, ports } = setup();
  storage.records.set("preferences.v1.global", "{not json");

  const status = await runDelegate("", ports);
  const save = await runDelegate("intensity normal", ports);

  assert.match(status, /saved defaults cannot be read/);
  assert.match(save, /^Not saved:/);
});

test("a write that may have landed is not reported as not saved", async () => {
  const { storage, ports } = setup();
  storage.set = async () => {
    throw new Error("host write failed");
  };

  const text = await runDelegate("intensity normal", ports);

  assert.match(text, /^Could not confirm the save:/);
  assert.doesNotMatch(text, /host write failed/);
});

test("the status says what the agent check found, and never stays silent", async () => {
  const { ports } = setup();
  const inspected = (inspection) => ({
    ...ports,
    inspect: async () => inspection,
  });
  const clean = { registration: "registered", advisors: [], orphans: [] };

  assert.match(await runDelegate("", ports), /Agent check: not available/);
  assert.match(
    await runDelegate("", inspected({ ...clean, registration: "pending" })),
    /Agent check: not run yet/,
  );
  assert.match(
    await runDelegate("", inspected({ ...clean, registration: "unreadable" })),
    /could not be read when OpenCode started/,
  );
  assert.match(
    await runDelegate("", inspected(clean)),
    /Agent check: nothing to report/,
  );

  const trouble = await runDelegate(
    "",
    inspected({
      registration: "registered",
      advisors: [
        { kind: "unregistered", id: "ocv2-advisor-2" },
        {
          kind: "actions-not-denied",
          id: "ocv2-advisor-1",
          actions: ["read", "edit"],
        },
      ],
      orphans: ["ocv2-medium"],
    }),
  );
  assert.match(
    trouble,
    /ocv2-advisor-2 is configured but the host does not have it/,
  );
  assert.match(trouble, /ocv2-advisor-1 can still do read, edit/);
  assert.match(trouble, /ocv2-medium is left over/);
  assert.doesNotMatch(trouble, /nothing to report/);

  // The host's own failure text is not echoed.
  const failing = await runDelegate("", {
    ...ports,
    inspect: async () => {
      throw new Error("host secret detail");
    },
  });
  assert.match(failing, /agent list could not be read/);
  assert.doesNotMatch(failing, /secret/);
});

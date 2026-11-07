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

  await runDelegate("defaults intensity normal", ports);
  const partial = await runDelegate(
    "defaults role small acme/small-model",
    ports,
  );
  // Until every ordinary role is decided, the report names the ones still missing.
  assert.match(
    partial,
    /role medium: not-configured; role large: not-configured/,
  );
  await runDelegate("defaults role medium off", ports);
  await runDelegate("defaults role large off", ports);
  const text = await runDelegate("defaults advisors acme/advisor-model", ports);

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
    "loud",
    "normal now",
    "advisor maybe",
    "preference cheap",
    "defaults",
    "defaults intensity loud",
    "defaults role huge acme/small-model",
    "defaults role small",
    "defaults thinking small",
    "defaults advisors a b c d",
    // A keyword mixed with models would be saved as a model reference called "off".
    "defaults advisors off acme/small-model",
    "defaults advisors acme/small-model unset",
    // Session model setters do not exist: agents are created from the defaults.
    "role small acme/small-model",
    "mystery",
  ]) {
    const text = await runDelegate(line, ports, { sessionID: "ses" });
    assert.match(text, /Usage/, line);
  }

  assert.equal(storage.records.size, 0);
});

test("a model the catalogue does not offer is saved and reported, not hidden", async () => {
  const { ports } = setup();

  // Intensity is off by default, so nothing is validated until delegation is on.
  await runDelegate("defaults intensity normal", ports);
  const text = await runDelegate("defaults role small acme/nope", ports);

  assert.match(text, /Defaults saved\./);
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

  await runDelegate("defaults role visual-design acme/small-model#high", ports);
  await runDelegate("defaults advisors off", ports);
  await runDelegate("defaults thinking small high", ports);
  await runDelegate("defaults thinking large low..high", ports);

  const { preferences } = await store.readGlobal();
  assert.deepEqual(preferences.roles.visualDesign, {
    kind: "configured",
    model: "acme/small-model#high",
  });
  assert.deepEqual(preferences.roles.small, { kind: "unset" });
  assert.deepEqual(preferences.advisors, { kind: "disabled" });
  assert.deepEqual(preferences.thinking.small, {
    kind: "fixed",
    level: "high",
  });
  assert.deepEqual(preferences.thinking.large, {
    kind: "range",
    from: "low",
    to: "high",
  });
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
  const save = await runDelegate("defaults intensity normal", ports);

  assert.match(status, /saved settings cannot be read/);
  assert.match(save, /^Not saved:/);
});

test("a write that may have landed is not reported as not saved", async () => {
  const { storage, ports } = setup();
  storage.set = async () => {
    throw new Error("host write failed");
  };

  const text = await runDelegate("defaults intensity normal", ports);

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

test("bare commands change the open session and never the defaults", async () => {
  const { store, ports } = setup();
  await runDelegate("defaults intensity normal", ports);

  const text = await runDelegate("orchestrator", ports, { sessionID: "ses" });
  await runDelegate("advisor on", ports, { sessionID: "ses" });
  await runDelegate("preference efficient", ports, { sessionID: "ses" });

  const session = await store.readSession("ses");
  assert.equal(session.preferences.intensity, "orchestrator");
  assert.equal(session.preferences.advisorMode, "on");
  assert.equal(session.preferences.preference, "efficient");
  assert.equal(session.provenance.intensity, "session");
  const defaults = await store.readGlobal();
  assert.equal(defaults.preferences.intensity, "normal");
  assert.equal(defaults.preferences.advisorMode, "with-delegation");
  // The report says where each value comes from.
  assert.match(text, /Intensity: orchestrator \(session\)/);
  // Saving one default writes the whole defaults document, so the rest reads as "defaults".
  assert.match(text, /Preference: standard \(defaults\)/);
});

test("reset turns the session off and clear brings back the defaults", async () => {
  const { store, ports } = setup();
  await runDelegate("defaults intensity aggressive", ports);
  await runDelegate("defaults advisor-mode on", ports);

  await runDelegate("reset", ports, { sessionID: "ses" });
  const reset = await store.readSession("ses");
  assert.equal(reset.preferences.intensity, "off");
  assert.equal(reset.preferences.advisorMode, "off");

  await runDelegate("clear", ports, { sessionID: "ses" });
  const cleared = await store.readSession("ses");
  assert.equal(cleared.preferences.intensity, "aggressive");
  assert.equal(cleared.provenance.intensity, "global");
});

test("a session command without a session, or for one the host cannot confirm, writes nothing", async () => {
  const { storage, ports } = setup();

  const home = await runDelegate("normal", ports);
  assert.match(home, /Open a session first/);

  const gone = await runDelegate(
    "normal",
    { ...ports, sessionExists: async () => false },
    { sessionID: "old" },
  );
  // A failed lookup is not proof the session was deleted, so the reply does not claim it.
  assert.match(
    gone,
    /could not confirm that session exists; nothing was changed/,
  );
  assert.equal(storage.records.size, 0);
});

test("command words are case-insensitive, model references are kept as typed", async () => {
  const { store, ports } = setup();

  await runDelegate("NORMAL", ports, { sessionID: "ses" });
  await runDelegate("Advisor ON", ports, { sessionID: "ses" });
  await runDelegate("Defaults Role Small Acme/Small-Model#High", ports);
  await runDelegate("DEFAULTS ROLE MEDIUM OFF", ports);

  const session = await store.readSession("ses");
  assert.equal(session.preferences.intensity, "normal");
  assert.equal(session.preferences.advisorMode, "on");
  const defaults = await store.readGlobal();
  assert.deepEqual(defaults.preferences.roles.small, {
    kind: "configured",
    model: "Acme/Small-Model#High",
  });
  assert.deepEqual(defaults.preferences.roles.medium, { kind: "disabled" });
});

test("a malformed thinking range is refused and the previous policy stays", async () => {
  const { store, ports } = setup();
  await runDelegate("defaults thinking small low..high", ports);

  for (const value of [
    "low..",
    "..high",
    "low..mid..high",
    "..",
    "low...high",
    "low.high",
  ]) {
    const text = await runDelegate(`defaults thinking small ${value}`, ports);
    assert.match(text, /Usage/, value);
  }

  assert.deepEqual((await store.readGlobal()).preferences.thinking.small, {
    kind: "range",
    from: "low",
    to: "high",
  });
});

test("the next command saves and clears the setting for the next session", async () => {
  const { store, ports } = setup();

  const saved = await runDelegate("next aggressive", ports);
  assert.match(
    saved,
    /Next session, saved:\nIntensity: aggressive \(next session\)/,
  );
  assert.equal((await store.readNext()).status, "pending");

  // The defaults are still the defaults; the pending setting is reported on its own.
  const status = await runDelegate("status", ports);
  assert.match(
    status,
    /No session is open; these are the defaults\.\nIntensity: off/,
  );
  assert.match(status, /Next session \(saved .*\): intensity aggressive/);

  await runDelegate("next clear", ports);
  assert.equal((await store.readNext()).status, "none");
  assert.doesNotMatch(await runDelegate("status", ports), /Next session/);
});

test("the status without a session shows the defaults, and with one the session", async () => {
  const { ports } = setup();
  await runDelegate("aggressive", ports, { sessionID: "ses" });

  assert.match(
    await runDelegate("", ports),
    /No session is open; these are the defaults\.\nIntensity: off/,
  );
  assert.match(
    await runDelegate("status", ports, { sessionID: "ses" }),
    /This session:\nIntensity: aggressive \(session\)/,
  );
});

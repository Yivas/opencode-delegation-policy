import assert from "node:assert/strict";
import { test } from "node:test";

import { createWiring } from "../dist/setup.js";

// Storage double with the ctx.storage surface: the store reads and writes JSON documents.
function storageDouble(records = new Map()) {
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

function catalogDouble(models) {
  return {
    async list() {
      return { location: { directory: "/synthetic" }, data: models };
    },
  };
}

function model(providerID, id, overrides = {}) {
  return {
    id,
    modelID: id,
    providerID,
    name: id,
    package: "@opencode/ai/providers/groq",
    enabled: true,
    limit: { context: 200000, output: 32000 },
    variants: [],
    ...overrides,
  };
}

// Transform double: keeps the callback and runs it against an editor when asked, as the host does
// when it rebuilds the agent catalog.
function transformDouble() {
  const callbacks = [];
  const agents = new Map();
  const editor = {
    get: (id) => agents.get(id),
    list: () => [...agents.values()],
    default() {},
    update(id, mutate) {
      const existing = agents.get(id) ?? {
        id,
        name: id,
        mode: "primary",
        hidden: false,
        permissions: [],
      };
      mutate(existing);
      agents.set(id, existing);
    },
    remove(id) {
      agents.delete(id);
    },
  };
  return {
    agents,
    callbacks,
    transform: async (callback) => {
      callbacks.push(callback);
      return {
        async dispose() {
          callbacks.length = 0;
        },
      };
    },
    rebuild() {
      for (const callback of callbacks) callback(editor);
    },
  };
}

function storagedefaults(records, defaults) {
  records.set("preferences.v1.global", JSON.stringify(defaults));
}

// Every reserved agent id, which registration now always fills.
const SLOT_IDS = [
  "ocv2-advisor-1",
  "ocv2-advisor-2",
  "ocv2-advisor-3",
  "ocv2-large",
  "ocv2-medium",
  "ocv2-small",
  "ocv2-visual-design",
];

// The advisor slots as the host reports them when nothing re-enabled an action.
function deniedAdvisorSlots(numbers) {
  const deny = [{ action: "*", resource: "*", effect: "deny" }];
  return numbers.map((number) => ({
    id: `ocv2-advisor-${number}`,
    permissions: deny,
  }));
}

function defaults(overrides = {}) {
  const unset = { kind: "unset" };
  return {
    schemaVersion: 1,
    intensity: "normal",
    preference: "standard",
    advisorMode: "on",
    roles: {
      small: { kind: "configured", model: "acme/small-model" },
      medium: unset,
      large: unset,
      visualDesign: unset,
    },
    thinking: {
      small: unset,
      medium: unset,
      large: unset,
      visualDesign: unset,
    },
    advisors: { kind: "configured", models: ["acme/advisor-model"] },
    ...overrides,
  };
}

test("setup registers the roles and advisors of the global defaults", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const agent = transformDouble();
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: agent.transform,
    agentList: async () => ({ data: [] }),
  });

  await wiring.register();
  agent.rebuild();

  // Every reserved slot is registered, so a role or advisor enabled only for a session still has an
  // agent to launch; the unused ones carry no model and the advisors keep their deny list.
  assert.deepEqual(SLOT_IDS, [...agent.agents.keys()].sort());
  assert.equal(agent.agents.get("ocv2-small")?.model.id, "small-model");
  assert.equal(agent.agents.get("ocv2-advisor-1")?.mode, "subagent");
  assert.equal(agent.agents.get("ocv2-medium")?.model, undefined);
  assert.deepEqual(agent.agents.get("ocv2-advisor-3")?.permissions.at(-1), {
    action: "*",
    resource: "*",
    effect: "deny",
  });
});

test("a broken advisor model does not stop the roles from registering", async () => {
  const records = new Map();
  // The advisor model does not exist in the catalogue, so only the advisor axis fails.
  storagedefaults(records, defaults());
  const agent = transformDouble();
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([model("acme", "small-model")]),
    agentTransform: agent.transform,
    agentList: async () => ({ data: [] }),
  });

  await wiring.register();
  agent.rebuild();

  // The valid axis still registers, and the broken one leaves its slots without a model instead of
  // taking the rest away.
  assert.deepEqual(SLOT_IDS, [...agent.agents.keys()].sort());
  assert.equal(agent.agents.get("ocv2-small")?.model.id, "small-model");
  assert.equal(agent.agents.get("ocv2-advisor-1")?.model, undefined);
});

test("an axis that stops validating keeps its agents instead of removing them", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const agent = transformDouble();
  let models = [model("acme", "small-model"), model("acme", "advisor-model")];
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: { list: async () => ({ data: models }) },
    agentTransform: agent.transform,
    agentList: async () => ({ data: [] }),
  });

  await wiring.register();
  agent.rebuild();
  assert.deepEqual(SLOT_IDS, [...agent.agents.keys()].sort());

  // The advisor leaves the catalogue: its agent must survive, because a transient failure is not a
  // reason to take away what the user configured.
  models = [model("acme", "small-model")];
  await wiring.register();
  agent.rebuild();

  assert.deepEqual(SLOT_IDS, [...agent.agents.keys()].sort());
});

test("advisor safety reports an allow the host config appended", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const agent = transformDouble();
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: agent.transform,
    agentList: async () => ({
      data: [
        {
          id: "ocv2-advisor-1",
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "shell", resource: "*", effect: "allow" },
          ],
        },
        ...deniedAdvisorSlots([2, 3]),
        {
          id: "ocv2-small",
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        },
      ],
    }),
  });

  await wiring.register();

  assert.deepEqual((await wiring.inspect()).advisors, [
    { kind: "actions-not-denied", id: "ocv2-advisor-1", actions: ["shell"] },
  ]);
});

test("advisor safety is empty before registering and after a clean registration", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const agent = transformDouble();
  let listed = { data: [] };
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: agent.transform,
    agentList: async () => listed,
  });

  assert.deepEqual((await wiring.inspect()).advisors, []);

  await wiring.register();
  listed = { data: deniedAdvisorSlots([1, 2, 3]) };

  assert.deepEqual((await wiring.inspect()).advisors, []);
});

test("an advisor missing from the effective catalog is reported", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: async () => ({ dispose: async () => {} }),
    agentList: async () => ({ data: [] }),
  });

  await wiring.register();

  assert.deepEqual((await wiring.inspect()).advisors, [
    { kind: "unregistered", id: "ocv2-advisor-1" },
    { kind: "unregistered", id: "ocv2-advisor-2" },
    { kind: "unregistered", id: "ocv2-advisor-3" },
  ]);
});

test("a malformed catalogue listing leaves advisor safety without effective agents", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: async () => ({ dispose: async () => {} }),
    agentList: async () => ({ data: [{ id: 7 }, null, "text"] }),
  });

  await wiring.register();

  assert.deepEqual((await wiring.inspect()).advisors, [
    { kind: "unregistered", id: "ocv2-advisor-1" },
    { kind: "unregistered", id: "ocv2-advisor-2" },
    { kind: "unregistered", id: "ocv2-advisor-3" },
  ]);
});

test("an agent under the plugin's prefix that the configuration no longer defines is reported as an orphan", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: async () => ({ dispose: async () => {} }),
    agentList: async () => ({
      data: [
        { id: "ocv2-small", permissions: [] },
        ...deniedAdvisorSlots([1, 2, 3]),
        // Left over from an earlier run, beyond the reserved slots.
        { id: "ocv2-advisor-9", permissions: [] },
        // Not ours: the plugin claims only its exact ids.
        { id: "my-own-agent", permissions: [] },
      ],
    }),
  });

  await wiring.register();

  assert.deepEqual((await wiring.inspect()).orphans, ["ocv2-advisor-9"]);
});

test("registering again after a configuration change updates the registered agents", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const agent = transformDouble();
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "other-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: agent.transform,
    agentList: async () => ({ data: [] }),
  });

  await wiring.register();
  agent.rebuild();
  assert.equal(agent.agents.get("ocv2-small")?.model.id, "small-model");

  // A later configuration reaches the same registration: the host rebuilds from whatever the
  // callback reads at that moment, not from the list it saw the first time.
  storagedefaults(
    records,
    defaults({
      roles: {
        small: { kind: "configured", model: "acme/other-model" },
        medium: { kind: "unset" },
        large: { kind: "unset" },
        visualDesign: { kind: "unset" },
      },
    }),
  );
  await wiring.register();
  agent.rebuild();

  assert.equal(agent.agents.get("ocv2-small")?.model.id, "other-model");
});

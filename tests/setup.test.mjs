import assert from "node:assert/strict";
import { test } from "node:test";

import { createPolicyInjector } from "../dist/policy/inject.js";
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

// The advisor slots as the host reports them when nothing re-enabled an action.
function readOnlyAdvisorSlots(numbers) {
  const rules = [
    { action: "*", resource: "*", effect: "deny" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
  ];
  return numbers.map((number) => ({
    id: `ocv2-advisor-${number}`,
    permissions: rules,
  }));
}

function defaults(overrides = {}) {
  const unset = { kind: "unset" };
  // Every ordinary role must be configured or explicitly off; Visual Design may stay unset.
  const off = { kind: "disabled" };
  return {
    schemaVersion: 1,
    intensity: "normal",
    preference: "standard",
    advisorMode: "on",
    roles: {
      small: { kind: "configured", model: "acme/small-model" },
      medium: off,
      large: off,
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

  // Only what the global configuration defines is registered: no launchable agent exists for a role
  // or advisor the user never configured.
  assert.deepEqual([...agent.agents.keys()].sort(), [
    "ocv2-advisor-1",
    "ocv2-small",
  ]);
  assert.equal(agent.agents.get("ocv2-small")?.model.id, "small-model");
  assert.equal(agent.agents.get("ocv2-advisor-1")?.mode, "subagent");
  assert.deepEqual(agent.agents.get("ocv2-advisor-1")?.permissions.at(-1), {
    action: "grep",
    resource: "*",
    effect: "allow",
  });
});

// What the policy may name is what the host ended up with, not what the plugin handed it: the host's
// own configuration runs after the plugin and can drop an agent or move it to another model.
test("the agents the policy may name are the ones the host lists, on their registered model", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const agent = transformDouble();
  let listed = [];
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: agent.transform,
    agentList: async () => ({ data: listed }),
  });

  assert.deepEqual(await wiring.agents(), []);
  await wiring.register();
  agent.rebuild();

  listed = [...agent.agents.values()];
  assert.deepEqual((await wiring.agents()).map((entry) => entry.id).sort(), [
    "ocv2-advisor-1",
    "ocv2-small",
  ]);

  // The host dropped the advisor and moved the role to another model.
  listed = [
    {
      ...agent.agents.get("ocv2-small"),
      model: { providerID: "acme", id: "other" },
    },
  ];
  assert.deepEqual(await wiring.agents(), []);
});

test("the policy excludes an advisor whose effective permissions are no longer read-only", async () => {
  const records = new Map();
  storagedefaults(
    records,
    defaults({
      advisors: {
        kind: "configured",
        models: ["acme/advisor-model", "acme/advisor-model"],
      },
    }),
  );
  const agent = transformDouble();
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: agent.transform,
    agentList: async () => ({ data: [...agent.agents.values()] }),
  });
  await wiring.register();
  agent.rebuild();
  const injector = createPolicyInjector({
    store: wiring.store,
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agents: () => wiring.agents(),
    session: async () => ({}),
  });
  const advisor = agent.agents.get("ocv2-advisor-1");
  const readOnly = advisor.permissions;
  for (const permissions of [
    [...readOnly, { action: "shell", resource: "*", effect: "allow" }],
    [...readOnly, { action: "subagent", resource: "*", effect: "ask" }],
    [...readOnly, { action: "*", resource: "*", effect: "allow" }],
    undefined,
    [...readOnly, { action: "shell", resource: "*", effect: "unknown" }],
  ]) {
    advisor.permissions = permissions;
    assert.deepEqual((await wiring.agents()).map((entry) => entry.id).sort(), [
      "ocv2-advisor-2",
      "ocv2-small",
    ]);
    const system = [];
    await injector.apply({ sessionID: "root", agent: "build", system });
    assert.match(system[0].text, /agent "ocv2-advisor-2"/);
    assert.doesNotMatch(system[0].text, /ocv2-advisor-1/);
    // This is a policy eligibility check, never an edit of the host's effective rules.
    assert.equal(advisor.permissions, permissions);
  }
  advisor.permissions = readOnly;
  assert.equal((await wiring.agents()).length, 3);
  // Narrowing the read set is not a reason to drop the advisor: it cannot grant anything else.
  advisor.permissions = [
    ...readOnly,
    { action: "read", resource: "*.env", effect: "deny" },
  ];
  assert.equal((await wiring.agents()).length, 3);
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

  // The valid axis registers; the broken one contributes nothing rather than taking the rest away.
  assert.deepEqual([...agent.agents.keys()], ["ocv2-small"]);
  assert.equal(agent.agents.get("ocv2-small")?.model.id, "small-model");
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
  assert.deepEqual([...agent.agents.keys()].sort(), [
    "ocv2-advisor-1",
    "ocv2-small",
  ]);

  // The advisor leaves the catalogue, so its axis cannot be validated; its agent stays as the last
  // pass registered it, because a transient failure is not a reason to take it away.
  models = [model("acme", "small-model")];
  await wiring.register();
  agent.rebuild();

  assert.deepEqual([...agent.agents.keys()].sort(), [
    "ocv2-advisor-1",
    "ocv2-small",
  ]);
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
        ...readOnlyAdvisorSlots([2, 3]),
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
  listed = { data: readOnlyAdvisorSlots([1, 2, 3]) };

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
  ]);
});

test("an unreadable rule fails the advisor closed instead of being skipped", async () => {
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
        {
          id: "ocv2-advisor-1",
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "shell", resource: "*", effect: "sometimes" },
          ],
        },
      ],
    }),
  });

  await wiring.register();

  // One unreadable rule could be the allow that reopens an action, so no partial list proves the
  // advisor read-only, and the whole list is treated as empty: every action is then reported open.
  const [issue] = (await wiring.inspect()).advisors;
  assert.equal(issue.kind, "actions-not-denied");
  assert.ok(issue.actions.includes("edit"));
  assert.ok(issue.actions.includes("*"));
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
        { id: "ocv2-advisor-1", permissions: [] },
        // Left over from an earlier run, or an advisor the configuration dropped.
        { id: "ocv2-advisor-2", permissions: [] },
        // Not ours: the plugin claims only its exact ids, so the shared prefix alone is not evidence.
        { id: "my-own-agent", permissions: [] },
        { id: "ocv2-mine", permissions: [] },
      ],
    }),
  });

  await wiring.register();

  assert.deepEqual((await wiring.inspect()).orphans, ["ocv2-advisor-2"]);
});

test("an unreadable preference document leaves the plugin running and says why", async () => {
  const records = new Map();
  // Not even valid JSON: the store cannot read it and setup must survive it.
  records.set("preferences.v1.global", "{not json");
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

  // Nothing registered, nothing thrown, and the state says why so a status surface can report it.
  assert.deepEqual(agent.callbacks.length, 0);
  assert.deepEqual(await wiring.inspect(), {
    registration: "unreadable",
    advisors: [],
    orphans: [],
  });
});

// The unreadable-document path tolerates one failure and no more: validation reports its own
// outcomes instead of throwing, so the only rejection it expects to absorb is the store's. The
// narrowing is what keeps a future defect inside setup from being reported as an unreadable
// document, which would look like a plugin with nothing to do.
test("a storage failure is reported as an unreadable document, not as an idle plugin", async () => {
  const wiring = createWiring({
    storage: {
      async get() {
        throw new Error("host storage is unavailable");
      },
      async set() {},
      async delete() {},
    },
    catalog: catalogDouble([model("acme", "small-model")]),
    agentTransform: async () => ({ dispose: async () => {} }),
    agentList: async () => ({ data: [] }),
  });

  await wiring.register();

  assert.equal((await wiring.inspect()).registration, "unreadable");
});

test("a successful registration is reported as such", async () => {
  const records = new Map();
  storagedefaults(records, defaults());
  const wiring = createWiring({
    storage: storageDouble(records),
    catalog: catalogDouble([
      model("acme", "small-model"),
      model("acme", "advisor-model"),
    ]),
    agentTransform: async () => ({ dispose: async () => {} }),
    agentList: async () => ({ data: readOnlyAdvisorSlots([1, 2, 3]) }),
  });

  assert.equal((await wiring.inspect()).registration, "pending");
  await wiring.register();

  assert.equal((await wiring.inspect()).registration, "registered");
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
        medium: { kind: "disabled" },
        large: { kind: "disabled" },
        visualDesign: { kind: "unset" },
      },
    }),
  );
  await wiring.register();
  agent.rebuild();

  assert.equal(agent.agents.get("ocv2-small")?.model.id, "other-model");
});

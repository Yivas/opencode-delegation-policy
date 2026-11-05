import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPolicyInjector,
  replacePolicyBlock,
} from "../dist/policy/inject.js";
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

const catalog = {
  async list() {
    return {
      location: { directory: "/synthetic" },
      data: [
        {
          id: "small-model",
          modelID: "small-model",
          providerID: "acme",
          name: "small-model",
          package: "@opencode/ai/providers/groq",
          enabled: true,
          limit: { context: 200000, output: 32000 },
          variants: [],
        },
      ],
    };
  },
};

async function activeStore() {
  const storage = storageDouble();
  const store = new PreferenceStore(storage);
  await store.saveDefaults({
    intensity: "normal",
    roles: {
      small: { kind: "configured", model: "acme/small-model" },
      medium: { kind: "disabled" },
      large: { kind: "disabled" },
    },
  });
  return { storage, store };
}

// The agents a start with the defaults below would register. The block may only name these.
const REGISTERED = [
  {
    id: "ocv2-small",
    model: { providerID: "acme", id: "small-model" },
  },
  {
    id: "ocv2-advisor-1",
    model: { providerID: "acme", id: "small-model" },
  },
];

function sessions(parents = {}, agents = REGISTERED) {
  const lookups = [];
  return {
    lookups,
    agents: () => agents,
    session: async (sessionID) => {
      lookups.push(sessionID);
      if (parents[sessionID] === "fail") throw new Error("host detail");
      return { parentID: parents[sessionID] };
    },
  };
}

const OTHER = { type: "text", text: "the user's own instructions" };

test("the main agent's request gets exactly one policy block after what was already there", async () => {
  const { store } = await activeStore();
  const injector = createPolicyInjector({ store, catalog, ...sessions() });
  const system = [{ ...OTHER }];

  await injector.apply({ sessionID: "root", agent: "build", system });
  // A callback that runs again on the same request must not stack a second block.
  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.equal(system.length, 2);
  assert.deepEqual(system[0], OTHER);
  assert.match(system[1].text, /<delegation_policy>/);
  assert.deepEqual(injector.last(), { outcome: "injected" });
});

test("a delegated child and the plugin's own agents never get the policy", async () => {
  const { store } = await activeStore();
  const injector = createPolicyInjector({
    store,
    catalog,
    ...sessions({ child: "root" }),
  });

  const child = [{ ...OTHER }];
  await injector.apply({ sessionID: "child", agent: "build", system: child });
  assert.deepEqual(child, [OTHER]);
  assert.deepEqual(injector.last(), {
    outcome: "skipped",
    reason: "child-session",
  });

  const ownAgent = [];
  await injector.apply({
    sessionID: "root",
    agent: "ocv2-advisor-1",
    system: ownAgent,
  });
  assert.deepEqual(ownAgent, []);
  assert.deepEqual(injector.last(), {
    outcome: "skipped",
    reason: "plugin-agent",
  });
});

test("turning delegation off removes the block on the next request and touches nothing else", async () => {
  const { store } = await activeStore();
  const injector = createPolicyInjector({ store, catalog, ...sessions() });
  const system = [{ ...OTHER }];
  await injector.apply({ sessionID: "root", agent: "build", system });

  await store.applySession("root", { intensity: "off" });
  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.deepEqual(system, [OTHER]);
  assert.deepEqual(injector.last(), {
    outcome: "skipped",
    reason: "nothing-active",
  });
});

test("a failure leaves no block, never a stale one, and says which failure it was", async () => {
  const { storage, store } = await activeStore();
  const lookups = sessions({ broken: "fail" });
  const injector = createPolicyInjector({ store, catalog, ...lookups });

  const system = [{ ...OTHER }];
  await injector.apply({ sessionID: "root", agent: "build", system });
  assert.equal(system.length, 2);

  storage.records.set("preferences.v1.global", "{not json");
  await injector.apply({ sessionID: "root", agent: "build", system });
  assert.deepEqual(system, [OTHER]);
  assert.deepEqual(injector.last(), {
    outcome: "failed",
    reason: "preferences-unreadable",
  });

  await injector.apply({ sessionID: "broken", agent: "build", system });
  assert.deepEqual(injector.last(), {
    outcome: "failed",
    reason: "session-lookup",
  });
});

test("a session's parent is looked up once, since it never changes", async () => {
  const { store } = await activeStore();
  const lookups = sessions();
  const injector = createPolicyInjector({ store, catalog, ...lookups });

  for (let turn = 0; turn < 3; turn += 1) {
    await injector.apply({ sessionID: "root", agent: "build", system: [] });
  }

  assert.deepEqual(lookups.lookups, ["root"]);
});

test("a foreign instruction that quotes the marker is someone else's text and stays", () => {
  const quoting = {
    type: "text",
    text: "Docs: the plugin marks its block with <!-- opencode-delegation-policy:owned --> inside.",
  };
  const system = [quoting];

  replacePolicyBlock(system, undefined);

  assert.deepEqual(system, [quoting]);
});

test("an Advisor alone still reaches the main agent's request", async () => {
  const storage = storageDouble();
  const store = new PreferenceStore(storage);
  await store.saveDefaults({
    advisorMode: "on",
    advisors: { kind: "configured", models: ["acme/small-model"] },
  });
  const injector = createPolicyInjector({ store, catalog, ...sessions() });
  const system = [];

  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.match(system[0].text, /Only consultation guidance is active/);
});

test("each session gets its own policy, even when requests overlap", async () => {
  const { store } = await activeStore();
  await store.applySession("busy", { intensity: "orchestrator" });
  const injector = createPolicyInjector({ store, catalog, ...sessions() });
  const normal = [];
  const busy = [];

  await Promise.all([
    injector.apply({ sessionID: "busy", agent: "build", system: busy }),
    injector.apply({ sessionID: "calm", agent: "build", system: normal }),
  ]);

  assert.match(busy[0].text, /Intensity: orchestrator\./);
  assert.match(normal[0].text, /Intensity: normal\./);
});

test("an unexpected error leaves no block and names only its kind", async () => {
  const injector = createPolicyInjector({
    store: {
      async readSession() {
        throw new RangeError("secret host detail");
      },
    },
    catalog,
    ...sessions(),
  });
  const system = [];
  replacePolicyBlock(system, "<delegation_policy>\nold\n</delegation_policy>");

  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.deepEqual(system, []);
  assert.deepEqual(injector.last(), {
    outcome: "failed",
    reason: "unexpected-error",
    kind: "RangeError",
  });
});

test("a session cannot make the policy name an agent the host was never given", async () => {
  const { store } = await activeStore();
  // Defaults were off when OpenCode started, so nothing was registered; the session turned it on.
  const injector = createPolicyInjector({
    store,
    catalog,
    ...sessions({}, []),
  });
  const system = [];

  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.deepEqual(system, []);
  assert.deepEqual(injector.last(), {
    outcome: "skipped",
    reason: "nothing-active",
  });
});

test("an agent created with another model is not named either", async () => {
  const { store } = await activeStore();
  const stale = [
    { id: "ocv2-small", model: { providerID: "acme", id: "old" } },
  ];
  const injector = createPolicyInjector({
    store,
    catalog,
    ...sessions({}, stale),
  });
  const system = [];

  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.deepEqual(system, []);
});

test("a block left by an earlier version is recognised by its marker and replaced", () => {
  const system = [
    { ...OTHER },
    {
      type: "text",
      text: "<delegation_policy>\n<!-- opencode-delegation-policy:owned -->\nold\n</delegation_policy>",
    },
  ];

  replacePolicyBlock(system, "<delegation_policy>new</delegation_policy>");

  assert.equal(system.length, 2);
  assert.equal(system[1].text, "<delegation_policy>new</delegation_policy>");
});

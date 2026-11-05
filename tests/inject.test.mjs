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

  // The policy is gone; the only addition left is the one-turn notice that it was turned off.
  assert.deepEqual(system[0], OTHER);
  assert.equal(system.length, 2);
  assert.match(system[1].text, /Delegation and Advisor disabled/);
  assert.deepEqual(injector.last(), {
    outcome: "skipped",
    reason: "nothing-active",
  });

  // After that turn succeeds, nothing of the plugin's is left at all.
  injector.turnEnded("root", true);
  await injector.apply({ sessionID: "root", agent: "build", system });
  assert.deepEqual(system, [OTHER]);
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

test("an Advisor without an agent is left out while the registered one is still consulted", async () => {
  const storage = storageDouble();
  const store = new PreferenceStore(storage);
  await store.saveDefaults({
    advisorMode: "on",
    advisors: {
      kind: "configured",
      models: ["acme/small-model", "acme/small-model"],
    },
  });
  // Only the first Advisor reached the host.
  const injector = createPolicyInjector({ store, catalog, ...sessions() });
  const system = [];

  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.match(system[0].text, /agent "ocv2-advisor-1"/);
  assert.doesNotMatch(system[0].text, /ocv2-advisor-2/);
});

test("a host agent list that cannot be read leaves no block and says so", async () => {
  const { store } = await activeStore();
  const injector = createPolicyInjector({
    store,
    catalog,
    ...sessions(),
    agents: async () => {
      throw new Error("host detail");
    },
  });
  const system = [];

  await injector.apply({ sessionID: "root", agent: "build", system });

  assert.deepEqual(system, []);
  assert.deepEqual(injector.last(), {
    outcome: "failed",
    reason: "agent-lookup",
  });
});

test("a notice the model never received is not consumed by a later success", async () => {
  const { store } = await activeStore();
  let agentsFail = false;
  const injector = createPolicyInjector({
    store,
    catalog,
    ...sessions(),
    agents: async () => {
      if (agentsFail) throw new Error("host detail");
      return REGISTERED;
    },
  });
  const turn = async () => {
    const system = [];
    await injector.apply({ sessionID: "root", agent: "build", system });
    return system;
  };
  await turn();
  injector.turnEnded("root", true);

  await store.applySession("root", { intensity: "aggressive" });
  assert.equal((await turn()).length, 2);
  injector.turnEnded("root", false);

  // The next turn cannot even read the agents, so it carries nothing; its success consumes nothing.
  agentsFail = true;
  assert.equal((await turn()).length, 0);
  injector.turnEnded("root", true);

  agentsFail = false;
  const recovered = await turn();
  assert.match(recovered[1].text, /normal -> aggressive/);
});

test("a change made while a turn runs waits for the next turn", async () => {
  const { store } = await activeStore();
  const injector = createPolicyInjector({ store, catalog, ...sessions() });
  const request = async () => {
    const system = [];
    await injector.apply({ sessionID: "root", agent: "build", system });
    return system;
  };
  await request();
  injector.turnEnded("root", true);

  // First request of a turn, then the setting changes during a tool, then the continuation.
  assert.equal((await request()).length, 1);
  await store.applySession("root", { intensity: "aggressive" });
  const continuation = await request();
  assert.equal(continuation.length, 1);
  assert.match(continuation[0].text, /Intensity: aggressive\./);
  injector.turnEnded("root", true);

  // The next turn says it, since the notice reads "changed before this turn".
  const next = await request();
  assert.match(next[1].text, /normal -> aggressive/);
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

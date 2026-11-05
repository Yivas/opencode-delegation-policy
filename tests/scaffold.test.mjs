import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import delegationPolicy from "../dist/index.js";

const SECRET = "sk-test-setup-secret";
const OWNED_PREFIX = "ocv2-budget-";
const ANTHROPIC_PACKAGE = "@opencode/ai/providers/anthropic";
const OPAQUE_HEADERS = Object.freeze({ sentinel: true });
const OPAQUE_BODY = Object.freeze({ sentinel: true });

function eligible(overrides = {}) {
  return {
    providerID: "anthropic",
    id: "claude-sonnet-4-5",
    modelID: "claude-sonnet-4-5",
    package: ANTHROPIC_PACKAGE,
    limit: { output: 64000 },
    variants: [{ id: "user-choice", settings: { temperature: 0.25 } }],
    selected: "user-choice",
    request: { headers: OPAQUE_HEADERS, body: OPAQUE_BODY },
    ...overrides,
  };
}

function setupContext(models, { listFailure, disposeFailures = 0 } = {}) {
  const cloneModels = (items) =>
    items.map((model) => ({
      ...model,
      limit: { ...model.limit },
      variants: model.variants.map((variant) => ({ ...variant })),
    }));
  const state = {
    base: cloneModels(models),
    transforms: [],
    listCalls: 0,
    transformCalls: 0,
    disposed: 0,
    disposeFailures,
    visible: cloneModels(models),
    records: new Map(),
    agentCallbacks: [],
    agentTransformCalls: 0,
    agents: new Map(),
    effectiveAgents: [],
    rpcs: [],
    hooks: [],
  };

  const model = {
    async transform(callback) {
      if (this !== model) throw new Error("model.transform lost its receiver");
      state.transformCalls += 1;
      const entry = { callback };
      state.transforms.push(entry);
      return {
        dispose: async () => {
          if (state.disposeFailures > 0) {
            state.disposeFailures -= 1;
            throw new Error(`host cleanup rejected ${SECRET}`);
          }
          state.disposed += 1;
          state.transforms = state.transforms.filter(
            (candidate) => candidate !== entry,
          );
        },
      };
    },
    async list() {
      if (this !== model) throw new Error("model.list lost its receiver");
      state.listCalls += 1;
      state.visible = cloneModels(state.base);
      for (const { callback } of state.transforms) {
        callback({
          list(providerID) {
            return state.visible.filter(
              (candidate) => candidate.providerID === providerID,
            );
          },
          update(providerID, modelID, update) {
            const target = state.visible.find(
              (candidate) =>
                candidate.providerID === providerID && candidate.id === modelID,
            );
            assert.ok(target);
            update(target);
          },
        });
      }
      if (listFailure) throw new Error(listFailure);
      return { data: state.visible };
    },
  };
  const storage = {
    async get(key) {
      const text = state.records.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    async set(key, value) {
      state.records.set(key, JSON.stringify(value));
    },
    async remove(key) {
      state.records.delete(key);
    },
  };
  const agentEditor = {
    get: (id) => state.agents.get(id),
    list: () => [...state.agents.values()],
    default() {},
    update(id, mutate) {
      const existing = state.agents.get(id) ?? {
        id,
        name: id,
        mode: "primary",
        hidden: false,
        permissions: [],
      };
      mutate(existing);
      state.agents.set(id, existing);
    },
    remove(id) {
      state.agents.delete(id);
    },
  };
  const agent = {
    async transform(callback) {
      if (this !== agent) throw new Error("agent.transform lost its receiver");
      state.agentTransformCalls += 1;
      state.agentCallbacks.push(callback);
      return {
        dispose: async () => {
          state.agentCallbacks.length = 0;
        },
      };
    },
    async list() {
      if (this !== agent) throw new Error("agent.list lost its receiver");
      return {
        location: { directory: "/synthetic" },
        data: state.effectiveAgents,
      };
    },
  };
  const session = {
    async hook(name, callback) {
      if (this !== session) throw new Error("session.hook lost its receiver");
      const entry = { name, callback };
      state.hooks.push(entry);
      return {
        dispose: async () => {
          state.hooks = state.hooks.filter((candidate) => candidate !== entry);
        },
      };
    },
    async get({ sessionID }) {
      return { id: sessionID };
    },
  };
  const rpc = {
    async register(definition, handlers) {
      if (this !== rpc) throw new Error("rpc.register lost its receiver");
      const entry = { definition, handlers };
      state.rpcs.push(entry);
      return {
        dispose: async () => {
          state.rpcs = state.rpcs.filter((candidate) => candidate !== entry);
        },
      };
    },
  };
  const context = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "model") return model;
        if (key === "storage") return storage;
        if (key === "agent") return agent;
        if (key === "rpc") return rpc;
        if (key === "session") return session;
        throw new Error(`unexpected host domain access: ${String(key)}`);
      },
    },
  );

  return {
    context,
    state,
    rebuildAgents: () => {
      for (const callback of state.agentCallbacks) callback(agentEditor);
    },
  };
}

function ids(model) {
  return model.variants.map(({ id }) => id);
}

test("exports the plugin identifier and a setup function", () => {
  assert.equal(delegationPolicy.id, "opencode-delegation-policy");
  assert.equal(typeof delegationPolicy.setup, "function");
});

test("module import has no SDK runtime import or host registration side effect", async () => {
  const source = await readFile(
    new URL("../dist/index.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from ["']@opencode\/plugin["']/);

  const firstLoad = await import("../dist/index.js?load=first");
  const secondLoad = await import("../dist/index.js?load=second");
  assert.equal(firstLoad.default.id, "opencode-delegation-policy");
  assert.equal(secondLoad.default.id, "opencode-delegation-policy");
});

test("setup registers owned Anthropic budget metadata through model methods only", async () => {
  const collision = eligible({
    id: "claude-haiku-4-5",
    modelID: "claude-haiku-4-5",
    variants: [{ id: `${OWNED_PREFIX}2048`, settings: { userOwned: true } }],
  });
  const otherProvider = eligible({
    providerID: "other",
    id: "unrelated",
    modelID: "unrelated",
    package: "@opencode/ai/providers/openai",
  });
  const userModel = eligible();
  const { context, state } = setupContext([
    userModel,
    collision,
    otherProvider,
  ]);
  const cleanup = await delegationPolicy.setup(context);

  assert.deepEqual(
    state.rpcs.map((entry) => entry.definition.id),
    ["opencode-delegation-policy-delegate"],
  );
  assert.equal(state.transformCalls, 1);
  assert.equal(
    state.listCalls,
    1,
    "the read barrier ran before setup resolved",
  );
  assert.equal(state.transforms.length, 1);
  const provisioned = state.visible.find(
    (model) => model.id === "claude-sonnet-4-5",
  );
  assert.deepEqual(ids(provisioned), [
    "user-choice",
    `${OWNED_PREFIX}1024`,
    `${OWNED_PREFIX}2048`,
    `${OWNED_PREFIX}8192`,
    `${OWNED_PREFIX}16384`,
  ]);
  assert.equal(provisioned.selected, userModel.selected);
  assert.equal(provisioned.request.headers, userModel.request.headers);
  assert.equal(provisioned.request.body, userModel.request.body);
  assert.deepEqual(
    ids(state.visible.find((model) => model.id === "claude-haiku-4-5")),
    [`${OWNED_PREFIX}2048`],
  );
  assert.deepEqual(
    ids(state.visible.find((model) => model.id === "unrelated")),
    ["user-choice"],
  );

  await cleanup();
  assert.equal(state.transforms.length, 0);
  assert.equal(state.rpcs.length, 0);
});

test("setup failure retires its registration and keeps host errors opaque", async () => {
  const { context, state } = setupContext([eligible()], {
    listFailure: `host read failed ${SECRET}`,
  });

  await assert.rejects(delegationPolicy.setup(context), (error) => {
    assert.equal(error.message, "owned variant read failed");
    assert.ok(!error.message.includes(SECRET));
    return true;
  });
  assert.equal(state.disposed, 1);
  assert.equal(state.transforms.length, 0);
});

test("setup retries one failed retirement and reports cleanup failure without orphaning", async () => {
  const { context, state } = setupContext([eligible()], {
    listFailure: `host read failed ${SECRET}`,
    disposeFailures: 1,
  });

  await assert.rejects(delegationPolicy.setup(context), (error) => {
    assert.equal(error.message, "owned variant cleanup failed");
    assert.ok(!error.message.includes(SECRET));
    return true;
  });
  assert.equal(state.disposed, 1);
  assert.equal(state.transforms.length, 0);
});

test("returned cleanup preserves retryable disposal behavior", async () => {
  const { context, state } = setupContext([eligible()], { disposeFailures: 1 });
  const cleanup = await delegationPolicy.setup(context);

  await assert.rejects(cleanup(), (error) => {
    assert.equal(error.message, "owned variant cleanup failed");
    return true;
  });
  assert.equal(state.transforms.length, 1);

  await cleanup();
  await cleanup();
  assert.equal(state.disposed, 1);
  assert.equal(state.transforms.length, 0);
});

test("a retirement that fails does not leave the other registrations alive", async () => {
  const { context, state } = setupContext([eligible()], { disposeFailures: 1 });
  const cleanup = await delegationPolicy.setup(context);
  assert.equal(state.rpcs.length, 1);
  assert.equal(state.agentCallbacks.length, 1);

  await assert.rejects(cleanup());

  // The model registration refused, yet the RPC and the agents were still retired, in one pass.
  assert.equal(state.rpcs.length, 0);
  assert.equal(state.agentCallbacks.length, 0);
});

test("the server answers the TUI's request with the command's report", async () => {
  const { context, state } = setupContext([eligible()]);
  await delegationPolicy.setup(context);
  const { handlers } = state.rpcs[0];

  const saved = await handlers.run({ line: "defaults intensity normal" });
  const status = await handlers.run({ line: "" });

  assert.match(saved.text, /Defaults saved\./);
  assert.match(saved.text, /Intensity: normal/);
  // Registration already ran before the request, so the status reports a real agent check.
  assert.match(status.text, /Agent check: nothing to report/);
  // The host checks the input against the contract; a request that slipped past is a defect.
  await assert.rejects(handlers.run({}), TypeError);
});

test("the server registers no slash command of its own", async () => {
  const { context } = setupContext([eligible()]);
  // The double throws on any domain it does not model, `command` included.
  await delegationPolicy.setup(context);
});

test("setup hooks the main agent's requests only, and retires the hook", async () => {
  const { context, state } = setupContext([eligible()]);
  const cleanup = await delegationPolicy.setup(context);

  // No compaction, title or generate: see src/policy/inject.ts for why.
  assert.deepEqual(
    state.hooks.map((hook) => hook.name),
    ["context"],
  );

  await cleanup();
  assert.equal(state.hooks.length, 0);
});

test("defaults saved through /delegate reach the next request of the main agent", async () => {
  const { context, state } = setupContext([eligible({ enabled: true })]);
  await delegationPolicy.setup(context);
  const [{ handlers }] = state.rpcs;
  const [{ callback }] = state.hooks;
  const request = () => ({
    sessionID: "root",
    agent: "build",
    system: [{ type: "text", text: "host instructions" }],
  });

  // Defaults are off: the request is left as it came.
  const before = request();
  await callback(before);
  assert.equal(before.system.length, 1);

  for (const line of [
    "defaults intensity normal",
    "defaults role small anthropic/claude-sonnet-4-5",
    "defaults role medium off",
    "defaults role large off",
  ]) {
    await handlers.run({ line });
  }
  const after = request();
  await callback(after);

  assert.equal(after.system[0].text, "host instructions");
  assert.match(after.system[1].text, /agent "ocv2-small"/);
  assert.match(
    (await handlers.run({ line: "" })).text,
    /latest request carried the delegation policy/,
  );

  // A session command from the TUI changes that session only; the next request there follows it.
  await handlers.run({ line: "orchestrator", sessionID: "root" });
  const session = request();
  await callback(session);
  assert.match(session.system[1].text, /Intensity: orchestrator\./);
});

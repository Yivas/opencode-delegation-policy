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
    emitted: [],
    parents: new Map(),
    hooks: [],
    permissionHooks: [],
    events: [],
    subscriptions: 0,
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
    async scan({ prefix }) {
      return {
        entries: [...state.records.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort()
          .map((key) => ({ key, value: JSON.parse(state.records.get(key)) })),
      };
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
  // Event stream double: events pushed by the test are delivered until the plugin aborts.
  const event = {
    subscribe({ signal }) {
      state.subscriptions += 1;
      return {
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            const next = state.events.shift();
            if (next !== undefined) {
              yield next;
              continue;
            }
            // Unref'd, so a test that never cleans up does not keep the process alive.
            await new Promise((resolve) => setTimeout(resolve, 1).unref());
          }
        },
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
      return { id: sessionID, parentID: state.parents.get(sessionID) };
    },
  };
  const permission = {
    async hook(name, callback) {
      if (this !== permission)
        throw new Error("permission.hook lost its receiver");
      const entry = { name, callback };
      state.permissionHooks.push(entry);
      return {
        dispose: async () => {
          state.permissionHooks = state.permissionHooks.filter(
            (candidate) => candidate !== entry,
          );
        },
      };
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
        events: {
          emit: async (name, data) => {
            state.emitted.push([name, data]);
          },
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
        if (key === "permission") return permission;
        if (key === "event") return event;
        if (key === "app") return { version: "2.0.21" };
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

test("the footer RPC reports the effective axes and changes tell footers to read again", async () => {
  const { context, state } = setupContext([eligible()]);
  const cleanup = await delegationPolicy.setup(context);
  try {
    const { handlers } = state.rpcs[0];
    assert.deepEqual(await handlers.footer({}), {
      delegation: "OFF",
      advisor: "OFF",
    });

    await handlers.run({ line: "defaults advisor-mode on" });
    assert.deepEqual(state.emitted.at(-1), ["changed", {}]);
    // On, with no Advisor configured: the axis is in error, and the footer says so.
    assert.deepEqual(await handlers.footer({}), {
      delegation: "OFF",
      advisor: "ERR",
    });

    // A delegated child never receives the policy, whatever the settings.
    state.parents.set("child", "root");
    assert.deepEqual(await handlers.footer({ sessionID: "child" }), {
      delegation: "OFF",
      advisor: "OFF",
    });

    const emittedBefore = state.emitted.length;
    const snapshot = await handlers.editorRead({ scope: "defaults" });
    await handlers.editorApply({
      scope: "defaults",
      revision: snapshot.revision,
      change: { advisorMode: "off" },
    });
    assert.equal(state.emitted.length, emittedBefore + 1);

    state.records.set("preferences.v1.global", "{not json");
    assert.deepEqual(await handlers.footer({}), {
      delegation: "ERR",
      advisor: "ERR",
    });
  } finally {
    await cleanup();
  }
});

test("the registered editor RPC previews without writing and rejects an outdated draft", async () => {
  const { context, state } = setupContext([eligible({ enabled: true })]);
  const cleanup = await delegationPolicy.setup(context);
  try {
    const { handlers } = state.rpcs[0];
    const snapshot = await handlers.editorRead({ scope: "defaults" });
    assert.equal(snapshot.ok, true);
    const input = {
      scope: "defaults",
      revision: snapshot.revision,
      change: { intensity: "normal" },
    };
    assert.equal((await handlers.editorPreview(input)).ok, true);
    assert.equal(state.records.has("preferences.v1.global"), false);
    assert.equal((await handlers.editorApply(input)).ok, true);
    assert.equal(
      JSON.parse(state.records.get("preferences.v1.global")).intensity,
      "normal",
    );
    assert.equal(
      (await handlers.editorApply({ ...input, change: { intensity: "off" } }))
        .ok,
      false,
    );
    assert.equal(
      JSON.parse(state.records.get("preferences.v1.global")).intensity,
      "normal",
    );
  } finally {
    await cleanup();
  }
});

test("/delegate log shows what was injected, from the plugin's own storage", async () => {
  const { context, state, rebuildAgents } = setupContext([
    eligible({ enabled: true }),
  ]);
  const cleanup = await delegationPolicy.setup(context);
  let [{ handlers }] = state.rpcs;

  assert.match(
    (await handlers.run({ line: "log" })).text,
    /local log is empty/,
  );

  for (const line of [
    "defaults intensity normal",
    "defaults role small anthropic/claude-sonnet-4-5",
    "defaults role medium off",
    "defaults role large off",
  ]) {
    await handlers.run({ line });
  }
  await cleanup();
  await delegationPolicy.setup(context);
  rebuildAgents();
  state.effectiveAgents = [...state.agents.values()];
  [{ handlers }] = state.rpcs;
  const [{ callback }] = state.hooks;
  await callback({ sessionID: "root", agent: "build", system: [] });

  const shown = (await handlers.run({ line: "log" })).text;
  assert.match(shown, /policy [0-9a-f]{16}: intensity normal/);
  assert.doesNotMatch(shown, /root/);
});

test("/delegate log shows what the guard refused, with no resource or prompt", async () => {
  const { context, state } = setupContext([eligible({ enabled: true })]);
  const cleanup = await delegationPolicy.setup(context);
  try {
    const [{ handlers }] = state.rpcs;
    const [{ callback }] = state.permissionHooks;

    // Nothing is active, so the plugin's own role is not offered by this session's policy.
    const event = {
      sessionID: "root",
      agent: "build",
      action: "subagent",
      resources: ["ocv2-small"],
      metadata: { prompt: SECRET },
      effect: "ask",
    };
    await callback(event);
    assert.equal(event.effect, "deny");
    assert.match(event.message, /does not offer ocv2-small/);

    const shown = (await handlers.run({ line: "log" })).text;
    assert.match(shown, /refused subagent for ocv2-small/);
    assert.doesNotMatch(shown, /root|sk-test/);
  } finally {
    await cleanup();
  }
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

test("setup registers the permission guard and retires it with everything else", async () => {
  const { context, state } = setupContext([eligible()]);
  const cleanup = await delegationPolicy.setup(context);

  assert.deepEqual(
    state.permissionHooks.map((hook) => hook.name),
    ["evaluate"],
  );
  const [{ handlers }] = state.rpcs;
  assert.match((await handlers.run({ line: "" })).text, /Guard check: active/);

  await cleanup();
  assert.equal(state.permissionHooks.length, 0);
});

test("a host without the permission hook still runs, and the status says the guard is inactive", async () => {
  const { context, state } = setupContext([eligible()]);
  const withoutHook = new Proxy(context, {
    get(target, key) {
      if (key === "permission") return undefined;
      return target[key];
    },
  });
  const cleanup = await delegationPolicy.setup(withoutHook);

  assert.equal(state.permissionHooks.length, 0);
  const [{ handlers }] = state.rpcs;
  assert.match(
    (await handlers.run({ line: "" })).text,
    /Guard check: the host does not offer the permission hook/,
  );

  await cleanup();
});

test("defaults saved through /delegate reach the main agent after a restart, not before", async () => {
  const { context, state, rebuildAgents } = setupContext([
    eligible({ enabled: true }),
  ]);
  const cleanup = await delegationPolicy.setup(context);
  let [{ handlers }] = state.rpcs;
  let [{ callback }] = state.hooks;
  const request = () => ({
    sessionID: "root",
    agent: "build",
    system: [{ type: "text", text: "host instructions" }],
  });

  // Defaults are off: the request is left as it came.
  const before = request();
  await callback(before);
  assert.equal(before.system.length, 1);
  state.events.push({
    type: "session.execution.succeeded",
    data: { sessionID: "root" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  for (const line of [
    "defaults intensity normal",
    "defaults role small anthropic/claude-sonnet-4-5",
    "defaults role medium off",
    "defaults role large off",
  ]) {
    await handlers.run({ line });
  }

  // The agents were created at start, with delegation off, so there is still nothing to name. The
  // change itself is announced, but no policy names an agent that does not exist.
  const unregistered = request();
  await callback(unregistered);
  assert.equal(unregistered.system.length, 2);
  assert.match(unregistered.system[1].text, /<delegation_config_notice>/);
  assert.doesNotMatch(unregistered.system[1].text, /<delegation_policy>/);
  assert.match(
    (await handlers.run({ line: "" })).text,
    /role small: agent-not-registered[\s\S]*restart OpenCode/,
  );

  // A restart over the same storage registers them, and the next request names them.
  await cleanup();
  await delegationPolicy.setup(context);
  [{ handlers }] = state.rpcs;
  [{ callback }] = state.hooks;
  // The host builds its agent list from the registration, as it does when it starts.
  rebuildAgents();
  state.effectiveAgents = [...state.agents.values()];
  const after = request();
  await callback(after);

  assert.equal(after.system[0].text, "host instructions");
  assert.match(after.system[1].text, /agent "ocv2-small"/);
  assert.match(
    (await handlers.run({ line: "" })).text,
    /latest request carried the delegation policy/,
  );

  state.events.push({
    type: "session.execution.succeeded",
    data: { sessionID: "root" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // A session command between turns changes that session only; the next turn announces it.
  await handlers.run({ line: "orchestrator", sessionID: "root" });
  const session = request();
  await callback(session);
  assert.match(session.system[1].text, /Intensity: orchestrator\./);
  assert.match(
    session.system[2].text,
    /Delegation intensity: normal -> orchestrator/,
  );

  // Once the host reports the turn succeeded, the notice has been read and is not repeated.
  state.events.push({
    type: "session.execution.succeeded",
    data: { sessionID: "root" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const next = request();
  await callback(next);
  assert.equal(next.system.length, 2);
});

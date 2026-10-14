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
  const context = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "model") return model;
        throw new Error(`unexpected host domain access: ${String(key)}`);
      },
    },
  );

  return { context, state };
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

import assert from "node:assert/strict";
import { test } from "node:test";

import { knownThinkingLevels } from "../dist/thinking/policies.js";
import {
  createOwnedBudgetVariantProvisioner,
  planOwnedBudgetVariants,
} from "../dist/thinking/provisioning.js";

const ANTHROPIC_PACKAGE = "@opencode/ai/providers/anthropic";
const SECRET = "sk-test-secret-value";

const REGISTRATION_FAILED = "owned variant registration failed";
const READ_FAILED = "owned variant read failed";
const TRANSFORM_NOT_RUN = "owned variant transform did not run";
const TRANSFORM_FAILED = "owned variant transform failed";
const CLEANUP_FAILED = "owned variant cleanup failed";

function eligible(overrides = {}) {
  return {
    providerID: "anthropic",
    id: "claude-sonnet-4-5",
    modelID: "claude-sonnet-4-5",
    package: ANTHROPIC_PACKAGE,
    limit: { output: 64000 },
    variants: [],
    ...overrides,
  };
}

function assertOpaque(error, message) {
  assert.equal(error.message, message);
  assert.ok(!error.message.includes(SECRET));
}

// Pure planning: no host, no lifecycle.

test("a verified nonadaptive Anthropic model gets one owned variant per Pi budget", () => {
  const plan = planOwnedBudgetVariants(eligible());

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.variants.map((variant) => [
      variant.id,
      variant.settings.thinking.budgetTokens,
    ]),
    [
      ["ocv2-budget-1024", 1024],
      ["ocv2-budget-2048", 2048],
      ["ocv2-budget-8192", 8192],
      ["ocv2-budget-16384", 16384],
    ],
  );
});

test("each owned variant is recognized as the levels its budget proves", () => {
  const plan = planOwnedBudgetVariants(eligible({ limit: { output: 4000 } }));
  assert.equal(plan.ok, true);
  const model = {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-5",
    package: ANTHROPIC_PACKAGE,
    limit: { output: 4000 },
    variants: [],
  };

  const expected = {
    "ocv2-budget-1024": ["minimal"],
    "ocv2-budget-2048": ["low"],
    "ocv2-budget-2976": ["medium", "high"],
  };
  for (const variant of plan.variants) {
    assert.deepEqual(
      knownThinkingLevels(model, variant),
      expected[variant.id],
      variant.id,
    );
  }
});

test("a lowered limit collapses high and medium into one owned budget that covers both", () => {
  const plan = planOwnedBudgetVariants(eligible({ limit: { output: 4000 } }));

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.variants.map((variant) => variant.settings.thinking.budgetTokens),
    [1024, 2048, 2976],
  );
});

test("a limit at the answer reserve plus the minimum collapses every level into one budget", () => {
  const plan = planOwnedBudgetVariants(eligible({ limit: { output: 2048 } }));

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.variants.map((variant) => variant.settings.thinking.budgetTokens),
    [1024],
  );
});

test("a limit below the answer reserve plus the minimum is refused without a variant", () => {
  assert.deepEqual(
    planOwnedBudgetVariants(eligible({ limit: { output: 1500 } })),
    {
      ok: false,
      code: "limit-too-small",
    },
  );
});

test("a non-integer or non-positive limit is refused as invalid", () => {
  for (const output of [0, -4, 1.5, Number.NaN, "64000"]) {
    assert.deepEqual(
      planOwnedBudgetVariants(eligible({ limit: { output } })),
      { ok: false, code: "limit-invalid" },
      String(output),
    );
  }
});

test("models outside the verified nonadaptive Anthropic set are not eligible", () => {
  const cases = [
    eligible({ modelID: "claude-opus-4-8", id: "claude-opus-4-8" }),
    eligible({ providerID: "acme" }),
    eligible({ package: "@opencode/ai/providers/openai" }),
    eligible({ modelID: "claude-sonnet-4-5-99999999" }),
  ];
  for (const model of cases) {
    assert.deepEqual(planOwnedBudgetVariants(model), {
      ok: false,
      code: "model-not-eligible",
    });
  }
});

test("a reserved id already present blocks the model even with an identical overlay", () => {
  const identical = {
    id: "ocv2-budget-2048",
    settings: { thinking: { type: "enabled", budgetTokens: 2048 } },
  };
  assert.deepEqual(
    planOwnedBudgetVariants(eligible({ variants: [identical] })),
    {
      ok: false,
      code: "variant-id-collision",
    },
  );
  assert.deepEqual(
    planOwnedBudgetVariants(
      eligible({ variants: [{ id: "ocv2-budget-1024" }] }),
    ),
    { ok: false, code: "variant-id-collision" },
  );
});

test("non-string host identities are not eligible instead of being coerced", () => {
  assert.deepEqual(
    planOwnedBudgetVariants(eligible({ providerID: new String("anthropic") })),
    { ok: false, code: "model-not-eligible" },
  );
  assert.deepEqual(
    planOwnedBudgetVariants(eligible({ modelID: ["claude-sonnet-4-5"] })),
    { ok: false, code: "model-not-eligible" },
  );
});

test("any existing id with the owned prefix blocks the model, even one that no computed preset names", () => {
  // A lowered limit computes 1024, 2048 and 2976; ocv2-budget-16384 is not among them but is still reserved.
  assert.deepEqual(
    planOwnedBudgetVariants(
      eligible({
        limit: { output: 4000 },
        variants: [
          {
            id: "ocv2-budget-16384",
            settings: { thinking: { type: "enabled", budgetTokens: 16384 } },
          },
        ],
      }),
    ),
    { ok: false, code: "variant-id-collision" },
  );
  assert.deepEqual(
    planOwnedBudgetVariants(
      eligible({ variants: [{ id: "ocv2-budget-999" }] }),
    ),
    { ok: false, code: "variant-id-collision" },
  );
});

test("an unrelated user variant id does not block provisioning", () => {
  const plan = planOwnedBudgetVariants(
    eligible({
      limit: { output: 4000 },
      variants: [{ id: "user-deep" }, { id: "budget-custom" }],
    }),
  );
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.variants.map((variant) => variant.id),
    ["ocv2-budget-1024", "ocv2-budget-2048", "ocv2-budget-2976"],
  );
});

test("a prefixed collision outside the presets skips that model and mutates nothing", async () => {
  const userPrefixed = {
    id: "ocv2-budget-16384",
    settings: { thinking: { type: "enabled", budgetTokens: 16384 } },
  };
  const host = batchingHost([
    eligible({ limit: { output: 4000 }, variants: [userPrefixed] }),
    eligible({ id: "claude-haiku-4-5", modelID: "claude-haiku-4-5" }),
  ]);
  const provisioner = provisionerFor(host);

  const result = await host.batch(() => provisioner.register());

  assert.deepEqual(result.skipped, [
    { modelID: "claude-sonnet-4-5", code: "variant-id-collision" },
  ]);
  assert.deepEqual(ownedIDs(host.visible()), ["ocv2-budget-16384"]);
  assert.deepEqual(
    host.base().find((model) => model.id === "claude-sonnet-4-5").variants,
    [userPrefixed],
  );
  assert.equal(ownedIDs(host.visible(), "claude-haiku-4-5").length, 4);
});

// Host double for the lifecycle. It follows the batching and rebuild model of core/state.ts and has
// three modes for a callback error:
// - "ungrouped" (default): the error propagates out of the rebuild. The candidate is discarded and the
//   last committed snapshot stays; reads throw while the fault persists.
// - "grouped": the plugin's entries form one group. A callback error disables that group, detaches its
//   entries and rebuilds from the surviving transforms.
// - "swallow": the error is dropped and the partial candidate is committed. The host reports nothing,
//   so the provisioner must detect the failure itself.
// Callbacks never edit the base: every rebuild starts from a fresh clone of it.
function batchingHost(models, options = {}) {
  const config = {
    host: "ungrouped",
    listRuns: true,
    readFails: false,
    readFailsAfterRun: false,
    readDelayMs: 0,
    transformDelayMs: 0,
    transformReturnsNothing: false,
    rejectAfterRun: false,
    // Persistent fault: every edit of this model id throws until the field is cleared.
    updateFaultFor: undefined,
    disposeFailures: 0,
    ...options,
  };
  const counters = {
    transforms: 0,
    reads: 0,
    callbackRuns: 0,
    flushes: 0,
    disposed: 0,
    updates: 0,
    inFlight: 0,
    maxInFlight: 0,
  };
  const base = structuredClone(models);
  let committed = structuredClone(models);
  let entries = [];
  const callbacks = [];
  let batchDepth = 0;

  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function guarded(operation) {
    counters.inFlight += 1;
    counters.maxInFlight = Math.max(counters.maxInFlight, counters.inFlight);
    try {
      await tick();
      return await operation();
    } finally {
      counters.inFlight -= 1;
    }
  }

  function editorOver(view) {
    return {
      list(providerID) {
        return view
          .filter(
            (model) =>
              providerID === undefined || model.providerID === providerID,
          )
          .map((model) => structuredClone(model));
      },
      update(providerID, id, update) {
        counters.updates += 1;
        if (
          config.updateFaultFor !== undefined &&
          String(id) === config.updateFaultFor
        ) {
          throw new Error(`unexpected editor fault ${SECRET}`);
        }
        const model = view.find(
          (candidate) =>
            candidate.providerID === providerID && candidate.id === id,
        );
        if (model === undefined) {
          throw new Error("unknown model");
        }
        const draft = { variants: structuredClone(model.variants) };
        update(draft);
        model.variants = draft.variants;
      },
    };
  }

  function rebuild() {
    for (;;) {
      const candidate = structuredClone(base);
      let disabled = false;
      for (const entry of [...entries]) {
        counters.callbackRuns += 1;
        try {
          entry.callback(editorOver(candidate));
        } catch (error) {
          if (config.host === "swallow") {
            continue;
          }
          if (config.host === "grouped" && entry.owned) {
            entries = entries.filter((other) => !other.owned);
            disabled = true;
            break;
          }
          throw error;
        }
      }
      if (disabled) {
        continue;
      }
      committed = candidate;
      return candidate;
    }
  }

  function disposeEntry(entry) {
    if (config.disposeFailures > 0) {
      config.disposeFailures -= 1;
      throw new Error(`cleanup rejected ${SECRET}`);
    }
    const index = entries.indexOf(entry);
    if (index < 0) {
      return;
    }
    entries.splice(index, 1);
    counters.disposed += 1;
    if (batchDepth === 0) {
      rebuild();
    }
  }

  return {
    counters,
    config,
    base: () => structuredClone(base),
    committed: () => structuredClone(committed),
    setBase(next) {
      // Only used by reload tests, which replace the host's source of models.
      base.splice(0, base.length, ...structuredClone(next));
    },
    activeEntries: () => entries.filter((entry) => entry.owned).length,
    visible: () => structuredClone(rebuild()),
    reload() {
      rebuild();
    },
    // A transform outside the plugin's group, which a grouped host must keep.
    addSurvivor(callback) {
      entries.push({ callback, owned: false });
      if (batchDepth === 0) {
        rebuild();
      }
    },
    // Runs a callback that may outlive its registration, as a late host rebuild could.
    runLate(index) {
      const view = structuredClone(base);
      callbacks[index](editorOver(view));
      return view;
    },
    async batch(operation) {
      batchDepth += 1;
      try {
        return await operation();
      } finally {
        batchDepth -= 1;
        if (batchDepth === 0) {
          counters.flushes += 1;
          rebuild();
        }
      }
    },
    transform: async (callback) => {
      counters.transforms += 1;
      return guarded(async () => {
        if (config.transformDelayMs > 0) {
          await delay(config.transformDelayMs);
        }
        if (config.transformReturnsNothing) {
          return undefined;
        }
        const entry = { callback, owned: true };
        callbacks.push(callback);
        entries.push(entry);
        // A rebuild that throws leaves the entry registered: the host's scope owns it, and no handle
        // is returned for the provisioner to dispose.
        if (batchDepth === 0) {
          rebuild();
        }
        if (config.rejectAfterRun) {
          throw new Error(`transform rejected ${SECRET}`);
        }
        return { dispose: () => guarded(async () => disposeEntry(entry)) };
      });
    },
    read: async () => {
      counters.reads += 1;
      if (config.readDelayMs > 0) {
        await delay(config.readDelayMs);
      }
      if (config.readFails) {
        throw new Error(`read rejected ${SECRET}`);
      }
      if (config.listRuns) {
        rebuild();
      }
      if (config.readFailsAfterRun) {
        throw new Error(`read rejected after activation ${SECRET}`);
      }
      return null;
    },
  };
}

function provisionerFor(host) {
  return createOwnedBudgetVariantProvisioner({
    transform: host.transform,
    read: host.read,
  });
}

function ownedIDs(view, modelID = "claude-sonnet-4-5") {
  return view
    .find((model) => model.id === modelID)
    .variants.map((variant) => variant.id);
}

const USER_VARIANTS = [
  { id: "user-deep", settings: { reasoningEffort: "high" } },
];
const OWNED = [
  "ocv2-budget-1024",
  "ocv2-budget-2048",
  "ocv2-budget-8192",
  "ocv2-budget-16384",
];
const HAIKU = eligible({ id: "claude-haiku-4-5", modelID: "claude-haiku-4-5" });
const OTHER = {
  providerID: "acme",
  id: "other",
  modelID: "other",
  package: "@opencode/ai/providers/openai",
  limit: { output: 64000 },
  variants: [],
};

test("registration provisions eligible models, keeps user arrays and other models untouched", async () => {
  const host = batchingHost([
    eligible({ variants: USER_VARIANTS }),
    HAIKU,
    OTHER,
    eligible({ id: "claude-opus-4-8", modelID: "claude-opus-4-8" }),
  ]);
  const provisioner = provisionerFor(host);

  const result = await provisioner.register();

  assert.equal(result.status, "registered");
  assert.deepEqual(
    result.provisioned.map((entry) => entry.modelID),
    ["claude-sonnet-4-5", "claude-haiku-4-5"],
  );
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(ownedIDs(host.visible()), ["user-deep", ...OWNED]);
  assert.deepEqual(
    host.base().find((model) => model.id === "claude-sonnet-4-5").variants,
    USER_VARIANTS,
  );
  assert.deepEqual(ownedIDs(host.visible(), "other"), []);
  assert.deepEqual(ownedIDs(host.visible(), "claude-opus-4-8"), []);
});

test("a collision skips only that model and mutates neither its variants nor other models", async () => {
  const userIdentical = {
    id: "ocv2-budget-2048",
    settings: { thinking: { type: "enabled", budgetTokens: 2048 } },
  };
  const host = batchingHost([eligible({ variants: [userIdentical] }), HAIKU]);
  const provisioner = provisionerFor(host);

  const result = await provisioner.register();

  assert.deepEqual(result.skipped, [
    { modelID: "claude-sonnet-4-5", code: "variant-id-collision" },
  ]);
  assert.deepEqual(ownedIDs(host.visible()), ["ocv2-budget-2048"]);
  assert.equal(ownedIDs(host.visible(), "claude-haiku-4-5").length, 4);
});

test("repeated registration holds one transform and does not stack variants", async () => {
  const host = batchingHost([eligible()]);
  const provisioner = provisionerFor(host);

  await provisioner.register();
  const second = await provisioner.register();

  assert.deepEqual(second, { status: "already-registered" });
  assert.equal(host.counters.transforms, 1);
  assert.deepEqual(ownedIDs(host.visible()), OWNED);
});

test("a callback that runs at once outside a batch skips the read barrier", async () => {
  const host = batchingHost([eligible()]);
  const provisioner = provisionerFor(host);

  const result = await provisioner.register();

  assert.equal(result.status, "registered");
  assert.equal(host.counters.reads, 0);
});

test("a deferred callback is activated by the read before the batch flush, and the flush reruns it", async () => {
  const host = batchingHost([eligible({ variants: USER_VARIANTS })]);
  const provisioner = provisionerFor(host);

  const result = await host.batch(async () => {
    const registered = await provisioner.register();
    assert.ok(
      host.counters.callbackRuns > 0,
      "the read activated the deferred callback",
    );
    assert.equal(host.counters.flushes, 0, "the batch has not flushed yet");
    return registered;
  });

  assert.equal(result.status, "registered");
  assert.ok(host.counters.flushes >= 1);
  assert.deepEqual(provisioner.latestResult(), result);
  assert.deepEqual(ownedIDs(host.visible()), ["user-deep", ...OWNED]);
});

test("a read that fails after the callback ran never reports success and disposes the exact handle", async () => {
  const host = batchingHost([eligible()], { readFailsAfterRun: true });
  const provisioner = provisionerFor(host);

  await host.batch(async () => {
    await assert.rejects(provisioner.register(), (error) => {
      assertOpaque(error, READ_FAILED);
      return true;
    });
  });

  assert.equal(host.counters.disposed, 1);
  assert.equal(host.activeEntries(), 0);
  assert.equal(provisioner.latestResult(), undefined);
  assert.deepEqual(ownedIDs(host.visible()), []);

  host.config.readFailsAfterRun = false;
  const retried = await provisioner.register();
  assert.equal(retried.status, "registered");
  assert.deepEqual(ownedIDs(host.visible()), OWNED);
});

test("a read that fails before anything runs is an error with cleanup, never a success", async () => {
  const host = batchingHost([eligible()], { readFails: true });
  const provisioner = provisionerFor(host);

  await host.batch(async () => {
    await assert.rejects(provisioner.register(), (error) => {
      assertOpaque(error, READ_FAILED);
      return true;
    });
  });

  assert.equal(host.counters.disposed, 1);
  assert.equal(provisioner.latestResult(), undefined);
});

test("a read that resolves without the callback running is an error, and the handle is disposed", async () => {
  const host = batchingHost([eligible()], { listRuns: false });
  const provisioner = provisionerFor(host);

  await host.batch(async () => {
    await assert.rejects(provisioner.register(), (error) => {
      assertOpaque(error, TRANSFORM_NOT_RUN);
      return true;
    });
  });

  assert.equal(host.counters.disposed, 1);
  assert.equal(host.activeEntries(), 0);
  assert.equal(provisioner.latestResult(), undefined);
});

test("an editor fault in the second edit rejects the whole candidate; nothing partial is committed", async () => {
  const models = [eligible({ variants: USER_VARIANTS }), HAIKU];
  const host = batchingHost(models, { updateFaultFor: "claude-haiku-4-5" });
  const provisioner = provisionerFor(host);

  await assert.rejects(provisioner.register(), (error) => {
    assertOpaque(error, REGISTRATION_FAILED);
    return true;
  });

  assert.deepEqual(host.committed(), structuredClone(models));
  assert.equal(provisioner.latestResult(), undefined);
  assert.equal(
    host.counters.disposed,
    0,
    "no handle was returned, so none is disposed",
  );
});

test("a reload that faults in the second edit throws opaquely and keeps the last committed snapshot", async () => {
  const host = batchingHost([eligible({ variants: USER_VARIANTS }), HAIKU]);
  const provisioner = provisionerFor(host);
  await provisioner.register();
  const before = host.committed();

  host.config.updateFaultFor = "claude-haiku-4-5";
  assert.throws(
    () => host.reload(),
    (error) => {
      assertOpaque(error, TRANSFORM_FAILED);
      return true;
    },
  );

  assert.deepEqual(
    host.committed(),
    before,
    "the partial candidate was never committed",
  );
  assert.equal(provisioner.latestResult(), undefined);

  host.config.updateFaultFor = undefined;
  const recovered = await provisioner.register();
  assert.equal(recovered.status, "registered");
  assert.deepEqual(ownedIDs(host.visible()), ["user-deep", ...OWNED]);
  assert.deepEqual(ownedIDs(host.visible(), "claude-haiku-4-5"), OWNED);
});

test("a planning fault in the second model throws before any edit, so no model is changed", async () => {
  const host = batchingHost([
    eligible(),
    eligible({
      id: "claude-haiku-4-5",
      modelID: "claude-haiku-4-5",
      variants: [null],
    }),
  ]);
  const provisioner = provisionerFor(host);

  await assert.rejects(provisioner.register(), (error) => {
    assertOpaque(error, REGISTRATION_FAILED);
    return true;
  });

  assert.equal(host.counters.updates, 0, "planning faulted before any edit");
  assert.deepEqual(host.committed(), host.base());
  assert.equal(provisioner.latestResult(), undefined);
});

test("a grouped host disables only the plugin's group: the survivor stays and no owned variant is published", async () => {
  const host = batchingHost([eligible(), HAIKU, OTHER], { host: "grouped" });
  host.addSurvivor((editor) =>
    editor.update("acme", "other", (draft) => {
      draft.variants = [...draft.variants, { id: "survivor-variant" }];
    }),
  );
  host.config.updateFaultFor = "claude-haiku-4-5";
  const provisioner = provisionerFor(host);

  await assert.rejects(provisioner.register(), (error) => {
    assertOpaque(error, TRANSFORM_FAILED);
    return true;
  });

  assert.deepEqual(ownedIDs(host.committed(), "other"), ["survivor-variant"]);
  assert.deepEqual(ownedIDs(host.committed()), []);
  assert.deepEqual(ownedIDs(host.committed(), "claude-haiku-4-5"), []);
  assert.equal(provisioner.latestResult(), undefined);
  assert.equal(host.activeEntries(), 0);
});

test("a host that swallows a callback error cannot make a partial reload look registered", async () => {
  const host = batchingHost([eligible(), HAIKU], { host: "swallow" });
  const provisioner = provisionerFor(host);
  await provisioner.register();

  host.config.updateFaultFor = "claude-haiku-4-5";
  assert.doesNotThrow(() => host.reload());

  assert.equal(provisioner.latestResult(), undefined);
  assert.deepEqual(
    ownedIDs(host.committed()),
    OWNED,
    "the swallowed partial edit is committed by the host",
  );
  assert.deepEqual(ownedIDs(host.committed(), "claude-haiku-4-5"), []);

  host.config.updateFaultFor = undefined;
  const recovered = await provisioner.register();
  assert.equal(recovered.status, "registered");
  assert.deepEqual(ownedIDs(host.visible()), OWNED);
  assert.deepEqual(ownedIDs(host.visible(), "claude-haiku-4-5"), OWNED);
  assert.equal(host.activeEntries(), 1);
});

test("a host that swallows a callback error rejects a registration whose recorded callback failed", async () => {
  const host = batchingHost([eligible(), HAIKU], {
    host: "swallow",
    updateFaultFor: "claude-haiku-4-5",
  });
  const provisioner = provisionerFor(host);

  await assert.rejects(provisioner.register(), (error) => {
    assertOpaque(error, TRANSFORM_FAILED);
    return true;
  });

  assert.equal(
    host.counters.disposed,
    1,
    "the handle the host returned is disposed",
  );
  assert.deepEqual(
    host.committed(),
    host.base(),
    "the rebuild after disposal is from the base",
  );
  assert.equal(provisioner.latestResult(), undefined);
});

test("a cleanup failure is retried by the next register, which never reports already-registered", async () => {
  const host = batchingHost([eligible()], {
    listRuns: false,
    disposeFailures: 1,
  });
  const provisioner = provisionerFor(host);

  await host.batch(async () => {
    await assert.rejects(provisioner.register(), (error) => {
      assertOpaque(error, CLEANUP_FAILED);
      return true;
    });
  });
  assert.equal(
    host.activeEntries(),
    1,
    "the failed disposal left the entry registered",
  );
  assert.equal(provisioner.latestResult(), undefined);

  host.config.listRuns = true;
  const retried = await host.batch(() => provisioner.register());

  assert.equal(retried.status, "registered");
  assert.equal(
    host.counters.disposed,
    1,
    "the retry disposed the stale handle once",
  );
  assert.deepEqual(
    ownedIDs(host.visible()),
    OWNED,
    "no duplication after the retry",
  );
});

test("a failed dispose of a held registration is not reported as success and keeps the handle", async () => {
  const host = batchingHost([eligible()], { disposeFailures: 1 });
  const provisioner = provisionerFor(host);
  await provisioner.register();

  await assert.rejects(provisioner.dispose(), (error) => {
    assertOpaque(error, CLEANUP_FAILED);
    return true;
  });
  assert.equal(provisioner.latestResult(), undefined);

  await provisioner.dispose();
  assert.equal(host.counters.disposed, 1);
  assert.equal(host.activeEntries(), 0);
});

test("a late callback from a disposed registration cannot republish latest or write into the editor", async () => {
  const host = batchingHost([eligible()]);
  const provisioner = provisionerFor(host);
  await provisioner.register();
  await provisioner.dispose();
  const before = host.base();

  const lateView = host.runLate(0);

  assert.equal(provisioner.latestResult(), undefined);
  assert.deepEqual(
    ownedIDs(lateView),
    [],
    "a retired callback writes nothing into the editor",
  );
  assert.deepEqual(host.base(), before);
});

test("concurrent register, register and dispose run one at a time and at most one transform is in flight", async () => {
  const host = batchingHost([eligible()], {
    readDelayMs: 5,
    transformDelayMs: 3,
  });
  const provisioner = provisionerFor(host);

  const [first, second, disposed] = await Promise.all([
    provisioner.register(),
    provisioner.register(),
    provisioner.dispose(),
  ]);

  assert.equal(first.status, "registered");
  assert.deepEqual(second, { status: "already-registered" });
  assert.equal(disposed, undefined);
  assert.equal(host.counters.maxInFlight, 1);
  assert.equal(host.counters.disposed, 1);
  assert.equal(provisioner.latestResult(), undefined);
});

test("a reload of the same current registration replaces latest with its new result", async () => {
  const host = batchingHost([eligible()]);
  const provisioner = provisionerFor(host);
  await provisioner.register();

  host.setBase([
    eligible({
      variants: [
        {
          id: "ocv2-budget-2048",
          settings: { thinking: { type: "enabled", budgetTokens: 2048 } },
        },
      ],
    }),
  ]);
  host.reload();

  assert.deepEqual(provisioner.latestResult().skipped, [
    { modelID: "claude-sonnet-4-5", code: "variant-id-collision" },
  ]);
});

test("a failed reload clears latest before it throws, and the next register recovers from the failed registration", async () => {
  const host = batchingHost([eligible()]);
  const provisioner = provisionerFor(host);
  await provisioner.register();

  host.config.updateFaultFor = "claude-sonnet-4-5";
  assert.throws(
    () => host.reload(),
    (error) => {
      assertOpaque(error, TRANSFORM_FAILED);
      return true;
    },
  );
  assert.equal(provisioner.latestResult(), undefined);

  host.config.updateFaultFor = undefined;
  const recovered = await provisioner.register();
  assert.equal(recovered.status, "registered");
  assert.deepEqual(ownedIDs(host.visible()), OWNED);
  assert.equal(host.activeEntries(), 1);
});

test("a failed dispose never leaves a valid success published, and the next register retries cleanup", async () => {
  const host = batchingHost([eligible()]);
  const provisioner = provisionerFor(host);
  await provisioner.register();

  host.config.disposeFailures = 1;
  await assert.rejects(provisioner.dispose(), (error) => {
    assertOpaque(error, CLEANUP_FAILED);
    return true;
  });
  assert.equal(provisioner.latestResult(), undefined);

  const next = await provisioner.register();
  assert.equal(next.status, "registered");
  assert.equal(host.activeEntries(), 1);
});

test("a transform that rejects after running its callback publishes nothing and disposes nothing", async () => {
  const host = batchingHost([eligible()], { rejectAfterRun: true });
  const provisioner = provisionerFor(host);

  await assert.rejects(provisioner.register(), (error) => {
    assertOpaque(error, REGISTRATION_FAILED);
    return true;
  });
  assert.equal(provisioner.latestResult(), undefined);
  assert.equal(host.counters.disposed, 0);
});

test("a transform that returns no handle is a failed registration, not a success", async () => {
  const host = batchingHost([eligible()], { transformReturnsNothing: true });
  const provisioner = provisionerFor(host);

  await assert.rejects(provisioner.register(), (error) => {
    assertOpaque(error, REGISTRATION_FAILED);
    return true;
  });
  assert.equal(provisioner.latestResult(), undefined);
});

test("disposing before any registration does nothing", async () => {
  const host = batchingHost([eligible()]);
  const provisioner = provisionerFor(host);

  await provisioner.dispose();

  assert.equal(host.counters.transforms, 0);
  assert.equal(host.counters.disposed, 0);
});

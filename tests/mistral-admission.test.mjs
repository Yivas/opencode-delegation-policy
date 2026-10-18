import assert from "node:assert/strict";
import { test } from "node:test";

import { selectThinkingVariant } from "../dist/thinking/policies.js";

const PACKAGE = "@opencode/ai/providers/mistral";
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const POSITIVE = ["minimal", "low", "medium", "high"];
const EXPECTED_ROWS = [
  ["mistral-small-latest", "reasoning_effort"],
  ["mistral-small-2603", "reasoning_effort"],
  ["mistral-medium-latest", "reasoning_effort"],
  ["mistral-medium-2604", "reasoning_effort"],
  ["mistral-medium-3.5", "reasoning_effort"],
  ["zai-glm-5-2", "reasoning_effort"],
  ["magistral-small", "prompt_mode"],
  ["magistral-medium-latest", "prompt_mode"],
  ["zai-glm-5-3", "prompt_mode"],
];

function model(id, overrides = {}) {
  return {
    providerID: "mistral",
    canonical: "mistral",
    package: PACKAGE,
    id,
    modelID: id,
    variants: [],
    ...overrides,
  };
}

function controlVariant(id, channel, control, overlays = {}) {
  return {
    id,
    ...overlays,
    settings: {
      ...(overlays.settings ?? {}),
      ...(control === undefined
        ? {}
        : channel === "reasoning_effort"
          ? { reasoningEffort: control }
          : { promptMode: control }),
    },
  };
}

function selectedFor(id, channel, requirements, overrides = {}) {
  const variants = [
    controlVariant("off-source", channel, undefined),
    controlVariant(
      "positive-source",
      channel,
      channel === "reasoning_effort" ? "high" : "reasoning",
    ),
  ];
  return selectThinkingVariant(
    model(id, { ...overrides, variants }),
    requirements,
    undefined,
  );
}

const fixed = (level) => ({ from: level, to: level });
const ranges = LEVELS.flatMap((from, start) =>
  LEVELS.slice(start).map((to) => ({ from, to })),
);

test("the nine exact Pi rows admit all four positive source levels and off omission", () => {
  for (const [id, channel] of EXPECTED_ROWS) {
    for (const level of ["off", ...POSITIVE]) {
      const variant = controlVariant(
        level,
        channel,
        level === "off"
          ? undefined
          : channel === "reasoning_effort"
            ? "high"
            : "reasoning",
      );
      const result = selectThinkingVariant(
        model(id, { variants: [variant] }),
        fixed(level),
        variant,
      );
      assert.equal(result.ok, true, `${id} ${level}`);
      assert.deepEqual(
        result.selection.compatibleLevels,
        level === "off" ? ["off"] : POSITIVE,
      );
      assert.deepEqual(result.selection.admittedLevels, [level]);
      assert.equal(result.selection.kind, "inline");
      assert.equal(result.selection.variant, level);
    }
  }
});

test("every fixed canonical level is independently checked for all nine raw rows", () => {
  for (const [id, channel] of EXPECTED_ROWS) {
    for (const level of LEVELS) {
      const result = selectedFor(id, channel, fixed(level));
      if (level === "xhigh" || level === "max") {
        assert.deepEqual(
          result,
          { ok: false, code: "thinking-pi-level-unsupported" },
          `${id} ${level}`,
        );
      } else {
        assert.equal(result.ok, true, `${id} ${level}`);
        const selected = result.selection.options.find((option) =>
          option.admittedLevels.includes(level),
        );
        assert.ok(selected, `${id} ${level} admitted`);
        assert.deepEqual(selected.admittedLevels, [level]);
        assert.deepEqual(
          selected.compatibleLevels,
          level === "off" ? ["off"] : POSITIVE,
        );
      }
    }
  }
});

test("all 28 inclusive ranges per source row preserve each compatible set without choosing", () => {
  for (const [id, channel] of EXPECTED_ROWS) {
    for (const range of ranges) {
      const result = selectedFor(id, channel, range);
      const admitted = [...["off", ...POSITIVE]].filter(
        (level) =>
          LEVELS.indexOf(level) >= LEVELS.indexOf(range.from) &&
          LEVELS.indexOf(level) <= LEVELS.indexOf(range.to),
      );
      if (admitted.length === 0) {
        assert.deepEqual(
          result,
          { ok: false, code: "thinking-pi-level-unsupported" },
          `${id} ${range.from}..${range.to}`,
        );
        continue;
      }
      assert.equal(result.ok, true, `${id} ${range.from}..${range.to}`);
      const expectedOptions = [];
      if (admitted.includes("off")) {
        expectedOptions.push({
          variant: "off-source",
          compatibleLevels: ["off"],
          admittedLevels: ["off"],
        });
      }
      const positiveLevels = admitted.filter((level) =>
        POSITIVE.includes(level),
      );
      if (positiveLevels.length > 0) {
        expectedOptions.push({
          variant: "positive-source",
          compatibleLevels: POSITIVE,
          admittedLevels: positiveLevels,
        });
      }
      assert.deepEqual(
        result.selection.options.map(
          ({ variant, compatibleLevels, admittedLevels }) => ({
            variant,
            compatibleLevels,
            admittedLevels,
          }),
        ),
        expectedOptions,
      );
      assert.equal(result.selection.kind, "options");
    }
  }
});

test("the source identity uses the effective protocol model ID and rejects aliases or conflicts", () => {
  const candidate = controlVariant("high", "reasoning_effort", "high");
  for (const overrides of [
    {
      id: "mistral-small-latest",
      modelID: "mistral-small-future",
    },
    { id: "mistral-medium-3.5", modelID: "mistral-medium-3-5" },
    {
      id: "mistral-medium-latest-2026",
      modelID: "mistral-medium-latest-2026",
    },
    { id: "mistral-small-latest", canonical: "alias" },
    { id: "mistral-small-latest", providerID: "other" },
    { id: "mistral-small-latest", package: "aisdk:@ai-sdk/mistral" },
  ]) {
    const result = selectThinkingVariant(
      model("mistral-small-latest", { ...overrides, variants: [candidate] }),
      fixed("high"),
      candidate,
    );
    assert.equal(result.ok, false);
    assert.notEqual(result.code, "thinking-unsupported");
  }

  const fallbackID = model("mistral-small-latest", { modelID: undefined });
  assert.equal(
    selectThinkingVariant(
      { ...fallbackID, variants: [candidate] },
      fixed("high"),
      candidate,
    ).ok,
    true,
  );

  const providerAlias = model("mistral-medium-3-5", {
    modelID: "mistral-medium-3.5",
    variants: [candidate],
  });
  assert.equal(
    selectThinkingVariant(providerAlias, fixed("high"), candidate).ok,
    true,
    "the effective native modelID is authoritative under the existing consumer convention",
  );
});

test("an exact package does not turn unknown model IDs or injected scope into proof", () => {
  const candidate = controlVariant("high", "reasoning_effort", "high", {
    sourceScope: "pi-model-recipe",
    proven: true,
  });
  for (const id of [
    "mistral-medium-3-5",
    "mistral-medium-2605",
    "magistral-small-2509",
  ]) {
    const result = selectThinkingVariant(
      model(id, { variants: [candidate] }),
      fixed("high"),
      candidate,
    );
    assert.deepEqual(result, { ok: false, code: "thinking-variant-unproven" });
  }
});

test("effective model settings and variant overlays preserve undefined controls", () => {
  const base = model("mistral-small-latest", {
    settings: { reasoningEffort: "high", compaction: { type: "native" } },
    body: { reasoning_effort: "high", seed: 17 },
  });
  const variant = {
    id: "inherited",
    settings: { reasoningEffort: undefined, promptMode: undefined },
    body: {
      reasoning_effort: undefined,
      prompt_mode: undefined,
      metadata: "kept",
    },
  };
  assert.equal(
    selectThinkingVariant(
      { ...base, variants: [variant] },
      fixed("high"),
      variant,
    ).ok,
    true,
  );
  assert.deepEqual(base.settings, {
    reasoningEffort: "high",
    compaction: { type: "native" },
  });
  assert.deepEqual(variant.body, {
    reasoning_effort: undefined,
    prompt_mode: undefined,
    metadata: "kept",
  });
});

test("known body overlays can establish the final source control but cannot mask native setting conflicts", () => {
  const corrected = {
    id: "body-final-high",
    settings: { reasoningEffort: "low" },
    body: { reasoning_effort: "high", requestTag: "opaque" },
  };
  assert.equal(
    selectThinkingVariant(
      model("mistral-small-latest", { variants: [corrected] }),
      fixed("high"),
      corrected,
    ).ok,
    true,
  );

  const settingsConflict = {
    id: "settings-conflict",
    settings: { reasoningEffort: "high", promptMode: "reasoning" },
    body: { reasoning_effort: undefined, prompt_mode: undefined },
  };
  assert.deepEqual(
    selectThinkingVariant(
      model("mistral-small-latest", { variants: [settingsConflict] }),
      fixed("high"),
      settingsConflict,
    ),
    { ok: false, code: "thinking-controls-unproven" },
  );
});

test("both native channels must agree jointly across settings and raw body overlays", () => {
  const cases = [
    { settings: { reasoningEffort: "high", promptMode: "reasoning" } },
    {
      settings: { reasoningEffort: "high" },
      body: { prompt_mode: "reasoning" },
    },
    {
      settings: { promptMode: "reasoning" },
      body: { reasoning_effort: "high" },
    },
    { settings: { reasoningEffort: "low" }, body: { reasoning_effort: null } },
    { settings: { promptMode: null } },
    { settings: { reasoningEffort: ["high"] } },
    { settings: { reasoningEffort: "mid" } },
    { settings: { reasoningEffort: "xhigh" } },
    { settings: { reasoningEffort: "max" } },
    { settings: { reasoningEffort: "minimal" } },
    { body: { reasoning_effort: "high", prompt_mode: "reasoning" } },
  ];
  for (const overlay of cases) {
    const variant = { id: "not-source", ...overlay };
    assert.deepEqual(
      selectThinkingVariant(
        model("mistral-small-latest", { variants: [variant] }),
        fixed("high"),
        variant,
      ),
      { ok: false, code: "thinking-controls-unproven" },
      JSON.stringify(overlay),
    );
  }
});

test("off is admitted only when merged settings and body omit both native controls", () => {
  for (const variant of [
    { id: "off" },
    {
      id: "off-inherited",
      settings: { reasoningEffort: undefined },
      body: { prompt_mode: undefined },
    },
  ]) {
    assert.equal(
      selectThinkingVariant(
        model("zai-glm-5-3", { variants: [variant] }),
        fixed("off"),
        variant,
      ).ok,
      true,
    );
  }
  for (const variant of [
    { id: "effort-none", settings: { reasoningEffort: "none" } },
    { id: "prompt-off", settings: { promptMode: "off" } },
    { id: "body-effort", body: { reasoning_effort: "high" } },
    { id: "body-prompt", body: { prompt_mode: "reasoning" } },
    { id: "null-control", body: { reasoning_effort: null } },
  ]) {
    const result = selectThinkingVariant(
      model("zai-glm-5-3", { variants: [variant] }),
      fixed("off"),
      variant,
    );
    assert.equal(result.ok, false, variant.id);
    assert.notEqual(result.code, "thinking-unsupported", variant.id);
    if (variant.id === "body-prompt") {
      assert.equal(result.code, "thinking-variant-mismatch");
    } else {
      assert.equal(result.code, "thinking-controls-unproven", variant.id);
    }
  }
});

test("a declared body model cannot override the matched Mistral wire model identity", () => {
  const candidate = controlVariant("high", "reasoning_effort", "high", {
    body: { model: "mistral-unlisted-future" },
  });
  const result = selectThinkingVariant(
    model("mistral-small-latest", { variants: [candidate] }),
    fixed("high"),
    candidate,
  );
  assert.deepEqual(result, {
    ok: false,
    code: "thinking-identity-unresolved",
  });
  const knownConflict = controlVariant(
    "known-conflict",
    "reasoning_effort",
    "high",
    {
      body: { model: "mistral-medium-latest" },
    },
  );
  assert.deepEqual(
    selectThinkingVariant(
      model("mistral-small-latest"),
      fixed("high"),
      knownConflict,
    ),
    { ok: false, code: "thinking-identity-unresolved" },
    "a different known Mistral row cannot replace the declared wire model",
  );

  const matching = controlVariant("matching", "reasoning_effort", "high");
  const variants = [
    matching,
    controlVariant("contradictory", "reasoning_effort", "high", {
      body: { model: "mistral-unlisted-future" },
    }),
  ];
  assert.deepEqual(
    selectThinkingVariant(
      model("mistral-small-latest", { variants }),
      fixed("high"),
      undefined,
    ),
    { ok: false, code: "thinking-identity-unresolved" },
    "a valid catalogue candidate cannot hide another candidate's identity conflict",
  );
});

test("Mistral body model comparison preserves undefined overlays and rejects unsafe identity data", () => {
  const base = model("mistral-small-latest", {
    body: { model: "mistral-unlisted-future" },
  });
  const inherited = controlVariant("high", "reasoning_effort", "high", {
    body: { model: undefined },
  });
  assert.deepEqual(
    selectThinkingVariant(
      { ...base, variants: [inherited] },
      fixed("high"),
      inherited,
    ),
    { ok: false, code: "thinking-identity-unresolved" },
  );

  const matching = controlVariant("high", "reasoning_effort", "high", {
    body: { model: "mistral-small-latest" },
  });
  assert.equal(
    selectThinkingVariant(
      model("mistral-small-latest"),
      fixed("high"),
      matching,
    ).ok,
    true,
  );

  for (const value of [null, 42, [], {}]) {
    const malformed = controlVariant("malformed", "reasoning_effort", "high", {
      body: { model: value },
    });
    assert.deepEqual(
      selectThinkingVariant(
        model("mistral-small-latest"),
        fixed("high"),
        malformed,
      ),
      { ok: false, code: "thinking-identity-unresolved" },
    );
  }

  let getterReads = 0;
  const body = {};
  Object.defineProperty(body, "model", {
    get() {
      getterReads += 1;
      return "mistral-small-latest";
    },
  });
  const unsafe = controlVariant("unsafe", "reasoning_effort", "high", { body });
  assert.deepEqual(
    selectThinkingVariant(model("mistral-small-latest"), fixed("high"), unsafe),
    { ok: false, code: "thinking-identity-unresolved" },
  );
  assert.equal(getterReads, 0);
});

test("unrelated headers, settings, body, cap and credential-like fields remain unread or unchanged", () => {
  let credentialReads = 0;
  let outputReads = 0;
  const headerValue = { opaque: true };
  const body = { requestTag: "kept", reasoning_effort: "high" };
  const variant = {
    id: "high",
    settings: { reasoningEffort: "high", vendorSetting: { nested: true } },
    body,
    headers: headerValue,
  };
  const input = model("mistral-small-latest", {
    variants: [variant],
    settings: { compaction: { type: "native" } },
    headers: Object.defineProperty({}, "Authorization", {
      enumerable: true,
      get() {
        credentialReads += 1;
        return "synthetic-secret";
      },
    }),
    limit: Object.defineProperty({}, "output", {
      get() {
        outputReads += 1;
        return 1;
      },
    }),
  });
  const before = structuredClone({
    settings: input.settings,
    body,
    headerValue,
  });
  const result = selectThinkingVariant(input, fixed("high"), variant);
  assert.equal(result.ok, true);
  assert.equal(credentialReads, 0);
  assert.equal(outputReads, 0);
  assert.deepEqual({ settings: input.settings, body, headerValue }, before);
});

test("accessors, inherited control data and throwing proxies fail closed without invoking getters", () => {
  let reads = 0;
  const settings = {};
  Object.defineProperty(settings, "reasoningEffort", {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error("secret accessor");
    },
  });
  const inherited = Object.create({
    get reasoningEffort() {
      reads += 1;
      return "high";
    },
  });
  const throwing = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error("secret proxy");
      },
      getPrototypeOf() {
        throw new Error("secret proxy");
      },
    },
  );
  for (const variant of [
    { id: "accessor", settings },
    { id: "inherited", settings: inherited },
    { id: "proxy", settings: throwing },
  ]) {
    const result = selectThinkingVariant(
      model("mistral-small-latest", { variants: [variant] }),
      fixed("high"),
      variant,
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "thinking-controls-unproven");
  }
  assert.equal(reads, 0);
});

test("model-level settings and body compose with variant overlays without mutating either", () => {
  const base = model("mistral-medium-latest", {
    settings: { reasoningEffort: "low", unrelated: "preserved" },
    body: { reasoning_effort: "low", other: true },
  });
  const variant = {
    id: "high-body",
    settings: { reasoningEffort: "high" },
    body: { reasoning_effort: "high" },
  };
  const before = structuredClone({
    settings: base.settings,
    body: base.body,
    variant,
  });
  const result = selectThinkingVariant(
    { ...base, variants: [variant] },
    fixed("high"),
    variant,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    { settings: base.settings, body: base.body, variant },
    before,
  );
});

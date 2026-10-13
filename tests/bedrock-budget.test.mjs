import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUDGET_DEFAULTS,
  BUDGET_LEVELS,
  calculateBudget,
  calculateOffCap,
  MANUAL_CATALOGUE,
  planBedrockManualLevel,
  planBedrockManualRange,
} from "../dist/thinking/bedrock-budget.js";

// Expected values come from the accepted source contract (Pi 0.87.1 simple-options.js and streamSimple, catalogue
// rows read as JSON). They are not computed by the module under test. No SDK, host, environment or network is used.

const PACKAGE = "@opencode/ai/providers/amazon-bedrock";
const API = "bedrock-converse-stream";
const SECRET = "synthetic-secret-marker-b7d2";
const SONNET_45_US = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const OPUS_41_US = "us.anthropic.claude-opus-4-1-20250805-v1:0";
const PROVEN_ABSENT = { kind: "proven-absent", provenance: "pi-display-env" };
const SUPPLIED_ZERO = { kind: "supplied", tokens: 0 };

const EXPECTED_IDS = [
  "anthropic.claude-haiku-4-5-20251001-v1:0",
  "anthropic.claude-opus-4-1-20250805-v1:0",
  "anthropic.claude-opus-4-5-20251101-v1:0",
  "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "apac.anthropic.claude-sonnet-4-20250514-v1:0",
  "au.anthropic.claude-haiku-4-5-20251001-v1:0",
  "au.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  "eu.anthropic.claude-opus-4-5-20251101-v1:0",
  "eu.anthropic.claude-sonnet-4-20250514-v1:0",
  "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "global.anthropic.claude-opus-4-5-20251101-v1:0",
  "global.anthropic.claude-sonnet-4-20250514-v1:0",
  "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
  "jp.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "us.anthropic.claude-opus-4-1-20250805-v1:0",
  "us.anthropic.claude-opus-4-5-20251101-v1:0",
  "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
];

function calc(overrides = {}) {
  return calculateBudget({
    level: "high",
    custom: undefined,
    modelMaxTokens: 64000,
    contextWindow: 200000,
    estimate: SUPPLIED_ZERO,
    callerCap: undefined,
    ...overrides,
  });
}

function calculated(result) {
  assert.equal(result.kind, "calculated", JSON.stringify(result));
  assert.equal(result.basis, "reference-calculation");
  return result.stages;
}

function candidate(id, overrides = {}) {
  return { packageName: PACKAGE, api: API, protocolModelID: id, ...overrides };
}

function request(overrides = {}) {
  return {
    custom: undefined,
    callerCap: undefined,
    estimate: SUPPLIED_ZERO,
    region: PROVEN_ABSENT,
    nativeCap: { kind: "unknown" },
    ...overrides,
  };
}

function planned(plan) {
  assert.equal(plan.kind, "planned", JSON.stringify(plan));
  return plan;
}

// ----- Arithmetic helper: source fixtures -----

test("the default high budget with no caller cap and no context pressure matches Pi's stages", () => {
  const stages = calculated(calc());
  assert.deepEqual(stages, {
    base: 64000,
    B0: 16384,
    m1: 64000,
    B: 16384,
    M: 64000,
    W: 16384,
    room: 195904,
  });
});

test("a caller cap of 8000 at high is raised by Pi to a virtual cap of 24384, with budget 16384", () => {
  const stages = calculated(
    calc({ callerCap: { kind: "known", value: 8000 } }),
  );
  assert.equal(stages.base, 8000);
  assert.equal(stages.m1, 24384);
  assert.equal(stages.M, 24384);
  assert.equal(stages.W, 16384);
});

test("a caller cap of 4000 at medium gives virtual cap 12192 and budget 8192", () => {
  const stages = calculated(
    calc({ level: "medium", callerCap: { kind: "known", value: 4000 } }),
  );
  assert.equal(stages.M, 12192);
  assert.equal(stages.W, 8192);
});

test("Opus 4.1 with its catalogue maximum of 32000 keeps the default high budget 16384", () => {
  const stages = calculated(calc({ modelMaxTokens: 32000 }));
  assert.equal(stages.M, 32000);
  assert.equal(stages.W, 16384);
});

test("context pressure with room 5904 at high gives virtual cap 5904 and budget 4880", () => {
  const stages = calculated(
    calc({ estimate: { kind: "supplied", tokens: 190000 } }),
  );
  assert.equal(stages.room, 5904);
  assert.equal(stages.m1, 22288);
  assert.equal(stages.B, 16384);
  assert.equal(stages.M, 5904);
  assert.equal(stages.W, 4880);
});

test("room 904 collapses every positive level to budget 0 and virtual cap 904, with m1 read per level", () => {
  const expected = { minimal: 1928, low: 2952, medium: 9096, high: 17288 };
  for (const [level, m1] of Object.entries(expected)) {
    const stages = calculated(
      calc({ level, estimate: { kind: "supplied", tokens: 195000 } }),
    );
    assert.equal(stages.room, 904, level);
    assert.equal(stages.m1, m1, level);
    assert.equal(stages.M, 904, level);
    assert.equal(stages.W, 0, level);
  }
});

test("a synthetic model maximum of 16000 at high reduces the budget to 14976 by the answer reserve", () => {
  const stages = calculated(calc({ modelMaxTokens: 16000 }));
  assert.equal(stages.m1, 16000);
  assert.equal(stages.B, 14976);
  assert.equal(stages.W, 14976);
});

test("a synthetic model maximum of 2000 at high gives budget 976 and a maximum of 1024 gives 0", () => {
  assert.equal(calculated(calc({ modelMaxTokens: 2000 })).W, 976);
  assert.equal(calculated(calc({ modelMaxTokens: 1024 })).W, 0);
});

test("a non-positive window with caller cap 0 takes the max-1 branch for the base", () => {
  const stages = calculated(
    calc({ contextWindow: 0, callerCap: { kind: "known", value: 0 } }),
  );
  assert.equal(stages.base, 1);
  assert.equal(stages.m1, 16385);
  assert.equal(stages.M, 16385);
  assert.equal(stages.W, 15361);
  assert.equal(stages.room, null);
});

test("a positive window with caller cap 0 keeps the base at 0 and budget 15360", () => {
  const stages = calculated(calc({ callerCap: { kind: "known", value: 0 } }));
  assert.equal(stages.base, 0);
  assert.equal(stages.m1, 16384);
  assert.equal(stages.B, 15360);
  assert.equal(stages.M, 16384);
  assert.equal(stages.W, 15360);
});

test("an estimate that exhausts the window floors the virtual cap to 1 and the budget to 0", () => {
  const stages = calculated(
    calc({
      estimate: { kind: "supplied", tokens: 200000 },
      callerCap: { kind: "known", value: 8000 },
    }),
  );
  assert.equal(stages.room, -4096);
  assert.equal(stages.base, 1);
  assert.equal(stages.m1, 16385);
  assert.equal(stages.M, 1);
  assert.equal(stages.W, 0);
});

test("fractional caller cap and estimate are not rounded", () => {
  const stages = calculated(
    calc({
      estimate: { kind: "supplied", tokens: 190000.5 },
      callerCap: { kind: "known", value: 8000.5 },
    }),
  );
  assert.equal(stages.room, 5903.5);
  assert.equal(stages.base, 5903.5);
  assert.equal(stages.m1, 22287.5);
  assert.equal(stages.W, 4879.5);
});

// ----- Arithmetic helper: custom budgets -----

test("a custom high budget replaces the default for that level only", () => {
  assert.equal(calculated(calc({ custom: { high: 8000 } })).W, 8000);
  assert.equal(calculated(calc({ custom: { high: 8000 } })).B0, 8000);
});

test("a missing custom key keeps the source default for its level", () => {
  assert.equal(calculated(calc({ custom: { low: 100 } })).B0, 16384);
});

test("a custom zero budget is a value, not the default", () => {
  const stages = calculated(calc({ custom: { high: 0 } }));
  assert.equal(stages.B0, 0);
  assert.equal(stages.W, 0);
});

test("own undefined, own null, accessor, __proto__, array, negative, string and unknown custom keys are invalid", () => {
  const accessor = {};
  Object.defineProperty(accessor, "high", {
    enumerable: true,
    get() {
      throw new Error(SECRET);
    },
  });
  const cases = [
    { high: undefined },
    { high: null },
    accessor,
    JSON.parse('{"__proto__":{"high":1}}'),
    [],
    { high: -1 },
    { high: "8000" },
    { xhigh: 1 },
    null,
  ];
  for (const [index, custom] of cases.entries()) {
    const result = calc({ custom });
    assert.deepEqual(
      result,
      { kind: "invalid-input", code: "custom" },
      `custom case ${index}`,
    );
  }
});

test("an invalid custom budget message never echoes the throwing getter's secret", () => {
  const accessor = {};
  Object.defineProperty(accessor, "high", {
    enumerable: true,
    get() {
      throw new Error(SECRET);
    },
  });
  const result = calc({ custom: accessor });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

// ----- Arithmetic helper: invalid and unknown inputs -----

test("off, xhigh, max and non-level strings never enter the budget calculator", () => {
  for (const level of ["off", "xhigh", "max", "none", "", undefined, 3]) {
    assert.deepEqual(
      calc({ level }),
      { kind: "invalid-input", code: "level" },
      String(level),
    );
  }
});

test("a model maximum that is not a finite positive number is invalid", () => {
  for (const modelMaxTokens of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "64000",
  ]) {
    assert.deepEqual(
      calc({ modelMaxTokens }),
      { kind: "invalid-input", code: "model-max" },
      String(modelMaxTokens),
    );
  }
});

test("a non-finite context window is invalid, while a non-positive finite one selects the max-1 branch", () => {
  assert.deepEqual(calc({ contextWindow: Number.NaN }), {
    kind: "invalid-input",
    code: "context-window",
  });
  assert.deepEqual(calc({ contextWindow: Number.POSITIVE_INFINITY }), {
    kind: "invalid-input",
    code: "context-window",
  });
  assert.equal(calc({ contextWindow: -5 }).kind, "calculated");
});

test("an unknown estimate with a positive window is insufficient, never a default zero", () => {
  assert.deepEqual(calc({ estimate: { kind: "unknown" } }), {
    kind: "insufficient",
    reason: "estimate-unknown",
  });
});

test("an unknown or invalid estimate is not read when the window is non-positive", () => {
  assert.equal(
    calc({ contextWindow: 0, estimate: { kind: "unknown" } }).kind,
    "calculated",
  );
  assert.equal(
    calc({ contextWindow: 0, estimate: { kind: "supplied", tokens: -9 } }).kind,
    "calculated",
  );
});

test("a negative, non-finite or malformed estimate with a positive window is invalid", () => {
  for (const estimate of [
    { kind: "supplied", tokens: -1 },
    { kind: "supplied", tokens: Number.NaN },
    { kind: "supplied", tokens: "1" },
    { kind: "guess" },
  ]) {
    assert.deepEqual(
      calc({ estimate }),
      { kind: "invalid-input", code: "estimate" },
      JSON.stringify(estimate),
    );
  }
});

test("an unknown caller cap is conditional with no computed numbers", () => {
  assert.deepEqual(calc({ callerCap: { kind: "unknown" } }), {
    kind: "conditional",
    unresolved: "caller-cap",
  });
});

test("a null caller cap is the same as an absent one, and invalid caller caps are refused", () => {
  assert.deepEqual(calculated(calc({ callerCap: null })), calculated(calc()));
  for (const callerCap of [
    { kind: "known", value: -1 },
    { kind: "known", value: Number.NaN },
    { kind: "known", value: "8" },
  ]) {
    assert.deepEqual(
      calc({ callerCap }),
      { kind: "invalid-input", code: "caller-cap" },
      JSON.stringify(callerCap),
    );
  }
});

test("every returned stage is finite when the result is calculated", () => {
  const stages = calculated(
    calc({ callerCap: { kind: "known", value: 0.25 } }),
  );
  for (const key of ["base", "B0", "m1", "B", "M", "W"]) {
    assert.equal(Number.isFinite(stages[key]), true, key);
  }
});

// ----- Off path -----

test("the canonical off cap is ctx(caller cap or model maximum), with no budget stages", () => {
  assert.deepEqual(
    calculateOffCap({
      modelMaxTokens: 64000,
      contextWindow: 200000,
      estimate: SUPPLIED_ZERO,
      callerCap: undefined,
    }),
    {
      kind: "calculated",
      basis: "reference-calculation",
      formula: "pi-ai@0.87.1 streamSimple !options.reasoning branch",
      stages: { M: 64000, room: 195904 },
    },
  );
  const withCap = calculateOffCap({
    modelMaxTokens: 64000,
    contextWindow: 200000,
    estimate: SUPPLIED_ZERO,
    callerCap: { kind: "known", value: 8000 },
  });
  assert.equal(withCap.stages.M, 8000);
});

test("off with context pressure takes the room cap, and an unknown estimate stays insufficient", () => {
  const pressed = calculateOffCap({
    modelMaxTokens: 64000,
    contextWindow: 200000,
    estimate: { kind: "supplied", tokens: 190000 },
    callerCap: undefined,
  });
  assert.equal(pressed.stages.M, 5904);
  assert.deepEqual(
    calculateOffCap({
      modelMaxTokens: 64000,
      contextWindow: 200000,
      estimate: { kind: "unknown" },
      callerCap: undefined,
    }),
    { kind: "insufficient", reason: "estimate-unknown" },
  );
});

// ----- Catalogue and scoped planner -----

test("the scoped catalogue is exactly the 22 manual Claude rows with their maxima", () => {
  assert.deepEqual(
    MANUAL_CATALOGUE.map((row) => row.protocolModelID),
    EXPECTED_IDS,
  );
  const maxima = MANUAL_CATALOGUE.map((row) => row.modelMaxTokens);
  assert.equal(maxima.filter((value) => value === 64000).length, 20);
  assert.equal(maxima.filter((value) => value === 32000).length, 2);
  assert.equal(
    MANUAL_CATALOGUE.find((row) => row.protocolModelID === OPUS_41_US)
      .modelMaxTokens,
    32000,
  );
});

test("every catalogue row plans high with the default budget and its own maximum as virtual cap", () => {
  for (const row of MANUAL_CATALOGUE) {
    const plan = planned(
      planBedrockManualLevel(candidate(row.protocolModelID), "high", request()),
    );
    assert.equal(plan.piCap, row.modelMaxTokens, row.protocolModelID);
    assert.equal(plan.target.kind, "enabled");
    assert.equal(
      plan.target.thinking.budget_tokens,
      16384,
      row.protocolModelID,
    );
    assert.deepEqual(plan.compatibleLevels, ["high"], row.protocolModelID);
  }
});

test("ids outside the scoped rows are insufficient for the model, never unmapped-permanent or adaptive", () => {
  const ids = [
    "anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-sonnet-4-6",
    "anthropic.claude-opus-4-7",
    "anthropic.claude-sonnet-5",
    "openai.gpt-5.5",
    "xai.grok-4.6",
    "us.anthropic.claude-sonnet-4-5",
    "anthropic.claude-sonnet-4-5",
    "chat:anthropic.claude-haiku-4-5-20251001-v1:0",
    "us-gov.anthropic.claude-haiku-4-5-20251001-v1:0",
    "anthropic.claude-haiku-4-5-20251001-v1:0-extra",
    "anthropic.claude-haiku-5-5",
  ];
  for (const id of ids) {
    assert.deepEqual(
      planBedrockManualLevel(candidate(id), "high", request()),
      { kind: "insufficient", reason: "model" },
      id,
    );
  }
});

test("a wrong package or API is insufficient for that axis, and a non-record candidate is invalid", () => {
  assert.deepEqual(
    planBedrockManualLevel(
      candidate(SONNET_45_US, { packageName: "x" }),
      "high",
      request(),
    ),
    {
      kind: "insufficient",
      reason: "package",
    },
  );
  assert.deepEqual(
    planBedrockManualLevel(
      candidate(SONNET_45_US, { api: "bedrock-converse" }),
      "high",
      request(),
    ),
    {
      kind: "insufficient",
      reason: "api",
    },
  );
  assert.deepEqual(planBedrockManualLevel(null, "high", request()), {
    kind: "invalid-input",
    code: "candidate",
  });
});

test("a fixed high plan carries the enabled target, required absences and the interleaved beta", () => {
  const plan = planned(
    planBedrockManualLevel(candidate(SONNET_45_US), "high", request()),
  );
  assert.equal(plan.level, "high");
  assert.equal(plan.piCap, 64000);
  assert.deepEqual(plan.target.thinking, {
    type: "enabled",
    budget_tokens: 16384,
  });
  assert.equal(plan.target.displayField, "summarized");
  assert.deepEqual(plan.target.anthropic_beta, [
    "interleaved-thinking-2025-05-14",
  ]);
  assert.deepEqual(plan.target.absent, [
    "output_config.effort",
    "thinking.block_binding",
  ]);
  assert.ok(plan.conditions.includes("default-thinking-display"));
  assert.ok(plan.conditions.includes("estimate-supplied"));
  assert.ok(plan.conditions.includes("client-resolution-unresolved"));
  assert.ok(plan.conditions.includes("native-thinking-unobserved"));
  assert.equal(plan.conditions.includes("provider-budget-unproven"), false);
});

test("the room-904 collapse groups minimal, low, medium and high as one set, since they share budget 0 and cap 904", () => {
  for (const level of ["minimal", "low", "medium", "high"]) {
    const plan = planned(
      planBedrockManualLevel(
        candidate(SONNET_45_US),
        level,
        request({ estimate: { kind: "supplied", tokens: 195000 } }),
      ),
    );
    assert.deepEqual(
      plan.compatibleLevels,
      ["minimal", "low", "medium", "high"],
      level,
    );
    assert.equal(plan.piCap, 904);
    assert.equal(plan.target.thinking.budget_tokens, 0);
    assert.ok(plan.conditions.includes("provider-budget-unproven"), level);
  }
});

test("off is never grouped with positive levels, even when its cap is the same", () => {
  const plan = planned(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "off",
      request({ estimate: { kind: "supplied", tokens: 195000 } }),
    ),
  );
  assert.equal(plan.target.kind, "omitted-reasoning");
  assert.deepEqual(plan.compatibleLevels, ["off"]);
  assert.equal(plan.piCap, 904);
  assert.deepEqual(plan.target.absent, [
    "thinking",
    "anthropic_beta",
    "output_config.effort",
  ]);
  assert.ok(plan.conditions.includes("caller-omits-reasoning-option"));
  assert.equal("anthropic_beta" in plan.target, false);
});

test("a caller cap of 8000 at high keeps the group of one level, with cap 24384 and budget 16384", () => {
  const plan = planned(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "high",
      request({ callerCap: { kind: "known", value: 8000 } }),
    ),
  );
  assert.equal(plan.piCap, 24384);
  assert.equal(plan.target.thinking.budget_tokens, 16384);
  assert.deepEqual(plan.compatibleLevels, ["high"]);
});

test("the stages of a planned level are returned and name each Pi step", () => {
  const plan = planned(
    planBedrockManualLevel(candidate(SONNET_45_US), "high", request()),
  );
  assert.deepEqual(plan.stages, {
    base: 64000,
    B0: 16384,
    m1: 64000,
    B: 16384,
    M: 64000,
    W: 16384,
    room: 195904,
  });
});

// ----- Region display (configured string only) -----

test("GovCloud display follows the case-insensitive literal predicate and omits the field", () => {
  for (const name of ["us-gov-west-1", "US-GOV-WEST-1", "Us-Gov-East-1"]) {
    const plan = planned(
      planBedrockManualLevel(
        candidate(SONNET_45_US),
        "high",
        request({
          region: { kind: "configured", name, provenance: "pi-display-env" },
        }),
      ),
    );
    assert.equal(plan.target.displayField, "omitted", name);
    assert.equal(
      plan.conditions.includes("default-thinking-display"),
      false,
      name,
    );
  }
});

test("names that do not start with us-gov- are standard, and a leading space is not trimmed into GovCloud", () => {
  for (const name of [
    " us-gov-west-1",
    "us-gov",
    "us east1",
    "not-a-region",
    "   ",
    "us-east-1",
  ]) {
    const plan = planned(
      planBedrockManualLevel(
        candidate(SONNET_45_US),
        "high",
        request({
          region: { kind: "configured", name, provenance: "pi-display-env" },
        }),
      ),
    );
    assert.equal(plan.target.displayField, "summarized", JSON.stringify(name));
    assert.ok(
      plan.conditions.includes("default-thinking-display"),
      JSON.stringify(name),
    );
  }
});

test("an unknown region leaves display unresolved and never falls back to us-east-1 or to standard", () => {
  const plan = planned(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "high",
      request({ region: { kind: "unknown" } }),
    ),
  );
  assert.equal(plan.target.displayField, "unresolved");
  assert.ok(plan.conditions.includes("display-region-unresolved"));
  assert.equal(plan.conditions.includes("default-thinking-display"), false);
  assert.equal(plan.piCap, 64000);
});

test("empty, provenance-free or non-string configured names are invalid region input", () => {
  for (const region of [
    { kind: "configured", name: "", provenance: "pi-display-env" },
    { kind: "configured", name: "us-east-1" },
    { kind: "configured", name: 42, provenance: "pi-display-env" },
    { kind: "guessed" },
    undefined,
  ]) {
    assert.deepEqual(
      planBedrockManualLevel(
        candidate(SONNET_45_US),
        "high",
        request({ region }),
      ),
      {
        kind: "invalid-input",
        code: "region",
      },
      JSON.stringify(region),
    );
  }
});

// ----- Native cap comparison (separate input, never backfilled) -----

test("native cap comparison labels equal, exceeds, below, absent and unknown without changing the Pi cap", () => {
  const cases = [
    [{ kind: "absent" }, "native-absent", "not-established"],
    [{ kind: "unknown" }, "native-unknown", "not-established"],
    [{ kind: "known", value: 64000 }, "equal", "met"],
    [{ kind: "known", value: 30000 }, "pi-exceeds-native", "blocked"],
    [{ kind: "known", value: 100000 }, "pi-below-native", "blocked"],
    [{ kind: "known", value: 0 }, "pi-exceeds-native", "blocked"],
    [{ kind: "known", value: -5 }, "pi-exceeds-native", "blocked"],
  ];
  for (const [nativeCap, relation, capPreservation] of cases) {
    const plan = planned(
      planBedrockManualLevel(
        candidate(SONNET_45_US),
        "high",
        request({ nativeCap }),
      ),
    );
    assert.equal(plan.piCap, 64000, relation);
    assert.equal(plan.hostCap.relation, relation, JSON.stringify(nativeCap));
    assert.equal(plan.hostCap.capPreservation, capPreservation, relation);
  }
});

test("an equal cap does not discharge client resolution, serialization or the native overlay conditions", () => {
  const plan = planned(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "high",
      request({ nativeCap: { kind: "known", value: 64000 } }),
    ),
  );
  assert.equal(plan.hostCap.capPreservation, "met");
  assert.ok(plan.conditions.includes("client-resolution-unresolved"));
  assert.ok(plan.conditions.includes("native-thinking-unobserved"));
});

test("a native cap that is not a finite number is invalid, without being backfilled into Pi's cap", () => {
  for (const nativeCap of [
    { kind: "known", value: Number.NaN },
    { kind: "known", value: "64000" },
    { kind: "guess" },
  ]) {
    assert.deepEqual(
      planBedrockManualLevel(
        candidate(SONNET_45_US),
        "high",
        request({ nativeCap }),
      ),
      {
        kind: "invalid-input",
        code: "native-cap",
      },
      JSON.stringify(nativeCap),
    );
  }
});

test("the native fit information is informative, uses the source 1024 floor, and is unknown when the cap is unknown", () => {
  const fitOf = (nativeCap) =>
    planned(
      planBedrockManualLevel(
        candidate(SONNET_45_US),
        "high",
        request({ nativeCap }),
      ),
    ).nativeFit;
  assert.deepEqual(fitOf({ kind: "absent" }), { kind: "value", value: 16384 });
  assert.deepEqual(fitOf({ kind: "unknown" }), { kind: "unknown" });
  assert.deepEqual(fitOf({ kind: "known", value: 40000 }), {
    kind: "value",
    value: 16384,
  });
  assert.deepEqual(fitOf({ kind: "known", value: 16000 }), {
    kind: "value",
    value: 8000,
  });
  assert.deepEqual(fitOf({ kind: "known", value: 2000 }), {
    kind: "value",
    value: 1024,
  });
  assert.deepEqual(fitOf({ kind: "known", value: 0 }), {
    kind: "value",
    value: 1024,
  });
});

test("off reports no native fit, since it sends no budget", () => {
  const plan = planned(
    planBedrockManualLevel(candidate(SONNET_45_US), "off", request()),
  );
  assert.equal(plan.nativeFit.kind, "not-applicable");
});

// ----- Input boundaries of the planner -----

test("unknown caller cap and unknown estimate are unresolved at the planner, never guessed", () => {
  assert.deepEqual(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "high",
      request({ callerCap: { kind: "unknown" } }),
    ),
    {
      kind: "conditional",
      unresolved: "caller-cap",
    },
  );
  assert.deepEqual(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "high",
      request({ estimate: { kind: "unknown" } }),
    ),
    {
      kind: "insufficient",
      reason: "estimate-unknown",
    },
  );
});

test("xhigh and max are unsupported in this snapshot and are never clamped to high", () => {
  for (const level of ["xhigh", "max"]) {
    assert.deepEqual(
      planBedrockManualLevel(candidate(SONNET_45_US), level, request()),
      {
        kind: "unsupported-in-snapshot",
        level,
      },
    );
  }
});

test("an off-only custom budget record is not read for off, while an invalid one fails a positive level", () => {
  assert.equal(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "off",
      request({ custom: { high: null } }),
    ).kind,
    "planned",
  );
  assert.deepEqual(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "high",
      request({ custom: { high: null } }),
    ),
    {
      kind: "invalid-input",
      code: "custom",
    },
  );
});

test("custom budgets apply to the planner's positive levels and change the group", () => {
  const plan = planned(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "high",
      request({ custom: { high: 8000 } }),
    ),
  );
  assert.equal(plan.target.thinking.budget_tokens, 8000);
  assert.deepEqual(plan.compatibleLevels, ["high"]);
});

// ----- Ranges: full sets, admitted intersection, no selection -----

test("a range over low..high gives one candidate per distinct control, each with its full compatible set", () => {
  const result = planBedrockManualRange(
    candidate(SONNET_45_US),
    { from: "low", to: "high" },
    request(),
  );
  assert.equal(result.kind, "range");
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(
    result.candidates.map((entry) => entry.admittedLevels),
    [["low"], ["medium"], ["high"]],
  );
  assert.deepEqual(
    result.candidates.map((entry) => entry.target.thinking.budget_tokens),
    [2048, 8192, 16384],
  );
  assert.equal("selected" in result, false);
});

test("a range over off..high gives the omitted-reasoning candidate and four positive candidates", () => {
  const result = planBedrockManualRange(
    candidate(SONNET_45_US),
    { from: "off", to: "high" },
    request(),
  );
  assert.equal(result.kind, "range");
  assert.equal(result.candidates.length, 5);
  assert.equal(result.candidates[0].target.kind, "omitted-reasoning");
  assert.deepEqual(result.candidates[0].compatibleLevels, ["off"]);
});

test("a range whose admitted levels share a control keeps the full compatible set, not only the admitted levels", () => {
  const result = planBedrockManualRange(
    candidate(SONNET_45_US),
    { from: "minimal", to: "low" },
    request({ estimate: { kind: "supplied", tokens: 195000 } }),
  );
  assert.equal(result.kind, "range");
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].admittedLevels, ["minimal", "low"]);
  assert.deepEqual(result.candidates[0].compatibleLevels, [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
});

test("a range containing xhigh or max is unsupported as a whole, naming the first unsupported level", () => {
  assert.deepEqual(
    planBedrockManualRange(
      candidate(SONNET_45_US),
      { from: "high", to: "max" },
      request(),
    ),
    {
      kind: "unsupported-in-snapshot",
      level: "xhigh",
    },
  );
  assert.deepEqual(
    planBedrockManualRange(
      candidate(SONNET_45_US),
      { from: "xhigh", to: "xhigh" },
      request(),
    ),
    {
      kind: "unsupported-in-snapshot",
      level: "xhigh",
    },
  );
});

test("reversed bounds are an invalid range, and an unknown endpoint is an invalid level", () => {
  assert.deepEqual(
    planBedrockManualRange(
      candidate(SONNET_45_US),
      { from: "high", to: "low" },
      request(),
    ),
    {
      kind: "invalid-input",
      code: "range",
    },
  );
  assert.deepEqual(
    planBedrockManualRange(
      candidate(SONNET_45_US),
      { from: "low", to: "ultra" },
      request(),
    ),
    {
      kind: "invalid-input",
      code: "level",
    },
  );
});

test("a single off range is a candidate, not an empty result", () => {
  const result = planBedrockManualRange(
    candidate(SONNET_45_US),
    { from: "off", to: "off" },
    request(),
  );
  assert.equal(result.kind, "range");
  assert.equal(result.candidates.length, 1);
});

// ----- Immutability, sanitization and defaults -----

test("calls do not mutate their inputs and repeating a call returns the same result", () => {
  const custom = { high: 8000 };
  const input = request({ custom, callerCap: { kind: "known", value: 8000 } });
  const before = JSON.stringify(input);
  const first = planBedrockManualLevel(candidate(SONNET_45_US), "high", input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(
    planBedrockManualLevel(candidate(SONNET_45_US), "high", input),
    first,
  );
});

test("returned targets are fresh objects, so changing one result does not change the next", () => {
  const first = planned(
    planBedrockManualLevel(candidate(SONNET_45_US), "high", request()),
  );
  first.target.thinking.budget_tokens = 1;
  const second = planned(
    planBedrockManualLevel(candidate(SONNET_45_US), "high", request()),
  );
  assert.equal(second.target.thinking.budget_tokens, 16384);
});

test("planner results carry no ThinkingProof fields and no compatible-unconditional kind", () => {
  const plan = planBedrockManualLevel(
    candidate(SONNET_45_US),
    "high",
    request(),
  );
  assert.equal("transportKind" in plan, false);
  assert.notEqual(plan.kind, "compatible-unconditional");
});

test("a throwing getter in a request record never leaks its message into the result", () => {
  const input = request();
  Object.defineProperty(input, "custom", {
    enumerable: true,
    get() {
      throw new Error(SECRET);
    },
  });
  const result = planBedrockManualLevel(candidate(SONNET_45_US), "high", input);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(result.kind, "invalid-input");
});

test("the default budget table is exactly the source table for the positive levels", () => {
  assert.deepEqual(BUDGET_DEFAULTS, {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
  });
});

// ----- Review regressions: off independence, positive guards, range shape -----

// A request whose custom field is an accessor that counts and throws. Own-data reads must never invoke it.
function customGetterRequest({ withRegion = true } = {}) {
  const input = request();
  delete input.custom;
  delete input.region;
  if (withRegion) {
    input.region = PROVEN_ABSENT;
  }
  const counter = { calls: 0 };
  Object.defineProperty(input, "custom", {
    enumerable: false,
    get() {
      counter.calls += 1;
      throw new Error(SECRET);
    },
  });
  return { input, counter };
}

function withoutRegion(overrides = {}) {
  const input = request(overrides);
  delete input.region;
  return input;
}

test("an off plan does not require a region record, and equals the plan with an unknown region", () => {
  const bare = planned(
    planBedrockManualLevel(candidate(SONNET_45_US), "off", withoutRegion()),
  );
  const unknown = planned(
    planBedrockManualLevel(
      candidate(SONNET_45_US),
      "off",
      request({ region: { kind: "unknown" } }),
    ),
  );
  assert.equal(bare.kind, "planned");
  assert.equal(bare.piCap, 64000);
  assert.deepEqual(bare.compatibleLevels, ["off"]);
  assert.deepEqual(bare, unknown);
});

test("an off plan never reads custom: an accessor on the custom field is neither invoked nor reported", () => {
  const { input, counter } = customGetterRequest({ withRegion: false });
  const plan = planned(
    planBedrockManualLevel(candidate(SONNET_45_US), "off", input),
  );
  assert.equal(plan.kind, "planned");
  assert.equal(counter.calls, 0);
});

test("an off-only range does not require custom or region, even when custom is an accessor", () => {
  const { input, counter } = customGetterRequest({ withRegion: false });
  const range = planBedrockManualRange(
    candidate(SONNET_45_US),
    { from: "off", to: "off" },
    input,
  );
  assert.equal(range.kind, "range");
  assert.equal(range.candidates.length, 1);
  assert.equal(counter.calls, 0);
});

test("a positive plan still rejects an accessor custom field without invoking it, and still needs a region record", () => {
  const { input, counter } = customGetterRequest({ withRegion: true });
  assert.deepEqual(
    planBedrockManualLevel(candidate(SONNET_45_US), "high", input),
    {
      kind: "invalid-input",
      code: "custom",
    },
  );
  assert.equal(counter.calls, 0);
  assert.deepEqual(
    planBedrockManualLevel(candidate(SONNET_45_US), "high", withoutRegion()),
    {
      kind: "invalid-input",
      code: "region",
    },
  );
});

test("a mixed off..low range still requires a valid custom record and a region record", () => {
  const { input, counter } = customGetterRequest({ withRegion: true });
  assert.deepEqual(
    planBedrockManualRange(
      candidate(SONNET_45_US),
      { from: "off", to: "low" },
      input,
    ),
    {
      kind: "invalid-input",
      code: "custom",
    },
  );
  assert.equal(counter.calls, 0);
  assert.deepEqual(
    planBedrockManualRange(
      candidate(SONNET_45_US),
      { from: "off", to: "low" },
      withoutRegion(),
    ),
    {
      kind: "invalid-input",
      code: "region",
    },
  );
});

test("a range that is not a plain record is an invalid range, never a level error", () => {
  for (const range of ["low..high", null, undefined, ["low", "high"]]) {
    assert.deepEqual(
      planBedrockManualRange(candidate(SONNET_45_US), range, request()),
      { kind: "invalid-input", code: "range" },
      typeof range === "string"
        ? range
        : (JSON.stringify(range) ?? String(range)),
    );
  }
});

// ----- Reference integrity: frozen catalogue rows and budget levels, and P3 guard coverage -----

const SCOPED_CANDIDATE = {
  packageName: PACKAGE,
  api: API,
  protocolModelID: "anthropic.claude-haiku-4-5-20251001-v1:0",
};

// A mutation attempt is made with Reflect.set, which reports instead of throwing. If the write succeeds (the defect),
// the original value is restored in finally, before any assertion, so no other test sees the mutated state.
function attemptSet(target, key, value) {
  const original = target[key];
  const accepted = Reflect.set(target, key, value);
  if (accepted) {
    target[key] = original;
  }
  return accepted;
}

test("every catalogue row is frozen, and its fields cannot be changed after construction", () => {
  for (const row of MANUAL_CATALOGUE) {
    assert.equal(Object.isFrozen(row), true, row.protocolModelID);
    assert.equal(
      attemptSet(row, "modelMaxTokens", 128000),
      false,
      row.protocolModelID,
    );
    assert.equal(
      attemptSet(row, "protocolModelID", "anthropic.claude-sonnet-4-6"),
      false,
      row.protocolModelID,
    );
  }
});

test("a mutation attempt on a catalogue row does not change the planner cap or the identity of the row", () => {
  const input = request({ region: { kind: "unknown" } });
  const row = MANUAL_CATALOGUE.find(
    (entry) => entry.protocolModelID === SCOPED_CANDIDATE.protocolModelID,
  );
  const original = row.modelMaxTokens;
  const accepted = Reflect.set(row, "modelMaxTokens", 128000);
  try {
    const after = planned(
      planBedrockManualLevel(SCOPED_CANDIDATE, "off", input),
    );
    assert.equal(after.piCap, 64000);
    assert.equal(after.modelMaxTokens, 64000);
    assert.equal(after.protocolModelID, SCOPED_CANDIDATE.protocolModelID);
  } finally {
    if (accepted) {
      row.modelMaxTokens = original;
    }
  }
});

test("the budget level list is frozen, so a level cannot be replaced with off and become a valid budget level", () => {
  const original = BUDGET_LEVELS[0];
  const accepted = Reflect.set(BUDGET_LEVELS, 0, "off");
  try {
    assert.equal(Object.isFrozen(BUDGET_LEVELS), true);
    assert.equal(accepted, false);
    assert.deepEqual(BUDGET_LEVELS, ["minimal", "low", "medium", "high"]);
    assert.deepEqual(
      calculateBudget({
        level: "off",
        custom: { off: 1024 },
        modelMaxTokens: 64000,
        contextWindow: 200000,
        estimate: SUPPLIED_ZERO,
        callerCap: undefined,
      }),
      { kind: "invalid-input", code: "level" },
    );
  } finally {
    if (accepted) {
      BUDGET_LEVELS[0] = original;
    }
  }
});

test("a negative native cap is a finite observation: it is compared, labelled and blocks cap preservation without changing Pi's cap", () => {
  const input = request({ nativeCap: { kind: "known", value: -1 } });
  for (const level of ["high", "off"]) {
    const plan = planned(
      planBedrockManualLevel(SCOPED_CANDIDATE, level, input),
    );
    assert.equal(plan.piCap > -1, true, level);
    assert.equal(plan.hostCap.relation, "pi-exceeds-native", level);
    assert.equal(plan.hostCap.capPreservation, "blocked", level);
  }
});

test("an estimate that is invalid is reported before an invalid custom record, with no other input read", () => {
  const request = {
    custom: { high: null },
    callerCap: undefined,
    estimate: { kind: "supplied", tokens: -1 },
    region: { kind: "unknown" },
    nativeCap: { kind: "unknown" },
  };
  assert.deepEqual(planBedrockManualLevel(SCOPED_CANDIDATE, "high", request), {
    kind: "invalid-input",
    code: "estimate",
  });
});

test("a region accessor on the original request is never invoked: off plans, and positive and mixed plans reject", () => {
  let calls = 0;
  const input = {
    custom: undefined,
    callerCap: undefined,
    estimate: SUPPLIED_ZERO,
    nativeCap: { kind: "unknown" },
  };
  Object.defineProperty(input, "region", {
    enumerable: false,
    get() {
      calls += 1;
      throw new Error(SECRET);
    },
  });
  assert.equal(
    planned(planBedrockManualLevel(SCOPED_CANDIDATE, "off", input)).piCap,
    64000,
  );
  assert.equal(
    planBedrockManualRange(SCOPED_CANDIDATE, { from: "off", to: "off" }, input)
      .kind,
    "range",
  );
  assert.deepEqual(planBedrockManualLevel(SCOPED_CANDIDATE, "high", input), {
    kind: "invalid-input",
    code: "region",
  });
  assert.deepEqual(
    planBedrockManualRange(SCOPED_CANDIDATE, { from: "off", to: "low" }, input),
    {
      kind: "invalid-input",
      code: "region",
    },
  );
  assert.equal(calls, 0);
});

test("an accessor on a range endpoint is reported as an invalid level, the existing definition, without invoking it", () => {
  let calls = 0;
  const range = { to: "high" };
  Object.defineProperty(range, "from", {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error(SECRET);
    },
  });
  assert.deepEqual(
    planBedrockManualRange(SCOPED_CANDIDATE, range, request({})),
    {
      kind: "invalid-input",
      code: "level",
    },
  );
  assert.equal(calls, 0);
});

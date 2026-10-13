import assert from "node:assert/strict";
import { test } from "node:test";

import * as bedrock from "../dist/thinking/bedrock.js";
import { knownThinkingProof } from "../dist/thinking/policies.js";

const {
  BEDROCK_BASELINE_IDS,
  planBedrockLevel,
  planBedrockRange,
  verifyBedrockOverlay,
} = bedrock;

// Source-defined expectations. The eleven ids are the 0.87.1 catalogue rows (amazon-bedrock.json, key
// "bedrock-converse-stream"), each with api bedrock-converse-stream, reasoning true and thinkingLevelMap {"max":"max"}.
// The expected controls come from Pi's buildAdditionalModelRequestFields, mapThinkingLevelToEffort and
// streamSimple, not from the module under test. No SDK, host, environment or network is used.

const PACKAGE = "@opencode/ai/providers/amazon-bedrock";
const API = "bedrock-converse-stream";
const SECRET = "synthetic-secret-marker-9c1e";

const EXPECTED_BASELINE = [
  "anthropic.claude-opus-4-6-v1",
  "anthropic.claude-sonnet-4-6",
  "au.anthropic.claude-opus-4-6-v1",
  "au.anthropic.claude-sonnet-4-6",
  "eu.anthropic.claude-opus-4-6-v1",
  "eu.anthropic.claude-sonnet-4-6",
  "global.anthropic.claude-opus-4-6-v1",
  "global.anthropic.claude-sonnet-4-6",
  "jp.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-opus-4-6-v1",
  "us.anthropic.claude-sonnet-4-6",
];

const STANDARD = { kind: "known", name: "us-east-1" };
const GOV = { kind: "known", name: "us-gov-west-1" };
const UNKNOWN = { kind: "unknown" };

function candidate(protocolModelID, overrides = {}) {
  return { packageName: PACKAGE, api: API, protocolModelID, ...overrides };
}

function planned(plan) {
  assert.equal(plan.kind, "planned", JSON.stringify(plan));
  return plan;
}

const ABSENT = { kind: "observed", additionalModelRequestFields: undefined };
const UNKNOWN_NATIVE = { kind: "unknown" };
const observed = (additionalModelRequestFields) => ({
  kind: "observed",
  additionalModelRequestFields,
});

// `display` null means the overlay sends no display field at all.
function adaptiveOverlay(effort, display = "summarized") {
  return {
    thinking:
      display === null ? { type: "adaptive" } : { type: "adaptive", display },
    output_config: { effort },
  };
}

test("the baseline is exactly the eleven verified 0.87.1 Claude 4.6 catalogue ids", () => {
  assert.deepEqual([...BEDROCK_BASELINE_IDS], EXPECTED_BASELINE);
  assert.equal(BEDROCK_BASELINE_IDS.length, 11);
  assert.ok(Object.isFrozen(BEDROCK_BASELINE_IDS));
});

test("every baseline id plans high adaptive with its exact target and its own evidence", () => {
  for (const id of EXPECTED_BASELINE) {
    const plan = planned(planBedrockLevel(candidate(id), "high", STANDARD));
    assert.equal(plan.level, "high");
    assert.deepEqual(plan.compatibleLevels, ["high"]);
    assert.equal(plan.target.kind, "adaptive");
    assert.deepEqual(plan.target.thinking, {
      type: "adaptive",
      display: "summarized",
    });
    assert.deepEqual(plan.target.output_config, { effort: "high" });
    assert.deepEqual(plan.target.absent, [
      "thinking.budget_tokens",
      "thinking.block_binding",
      "anthropic_beta",
    ]);
    assert.deepEqual(plan.conditions, ["default-thinking-display"]);
    assert.ok(plan.evidence.includes(`"${id}"`), plan.evidence);
    assert.ok(plan.evidence.includes("pi-ai@0.87.1"), plan.evidence);
  }
});

test("minimal and low share effort low and keep the logical set minimal, low", () => {
  for (const level of ["minimal", "low"]) {
    const plan = planned(
      planBedrockLevel(
        candidate("us.anthropic.claude-sonnet-4-6"),
        level,
        STANDARD,
      ),
    );
    assert.deepEqual(plan.compatibleLevels, ["minimal", "low"]);
    assert.deepEqual(plan.target.output_config, { effort: "low" });
  }
});

test("medium and max plan their own effort, and max is supported on 4.6", () => {
  const medium = planned(
    planBedrockLevel(
      candidate("eu.anthropic.claude-sonnet-4-6"),
      "medium",
      STANDARD,
    ),
  );
  assert.deepEqual(medium.target.output_config, { effort: "medium" });
  assert.deepEqual(medium.compatibleLevels, ["medium"]);

  const max = planned(
    planBedrockLevel(
      candidate("global.anthropic.claude-opus-4-6-v1"),
      "max",
      STANDARD,
    ),
  );
  assert.deepEqual(max.target.output_config, { effort: "max" });
  assert.deepEqual(max.compatibleLevels, ["max"]);
});

test("xhigh is unsupported for every baseline row, and is never clamped to high", () => {
  for (const id of EXPECTED_BASELINE) {
    for (const region of [STANDARD, GOV, UNKNOWN]) {
      assert.deepEqual(planBedrockLevel(candidate(id), "xhigh", region), {
        kind: "unsupported-level",
        level: "xhigh",
      });
    }
  }
});

test("off plans the absence target without any region, carrying the unproven caller condition", () => {
  for (const region of [STANDARD, GOV, UNKNOWN]) {
    const plan = planned(
      planBedrockLevel(
        candidate("au.anthropic.claude-opus-4-6-v1"),
        "off",
        region,
      ),
    );
    assert.equal(plan.target.kind, "off");
    assert.deepEqual(plan.target.absent, [
      "thinking",
      "output_config.effort",
      "anthropic_beta",
    ]);
    assert.deepEqual(plan.compatibleLevels, ["off"]);
    assert.deepEqual(plan.conditions, ["caller-omits-reasoning-option"]);
    assert.ok(
      plan.evidence.includes("caller mapping of off is outside the archive"),
      plan.evidence,
    );
  }
});

test("a positive level with an unknown region is pending, never assumed standard", () => {
  const plan = planBedrockLevel(
    candidate("us.anthropic.claude-sonnet-4-6"),
    "high",
    UNKNOWN,
  );
  assert.equal(plan.kind, "pending-region");
  assert.equal("target" in plan, false);
});

test("the SDK literal us-gov- predicate decides display: standard keeps summarized, GovCloud omits it", () => {
  const standardLower = planned(
    planBedrockLevel(candidate("us.anthropic.claude-sonnet-4-6"), "high", {
      kind: "known",
      name: "us-gov",
    }),
  );
  assert.deepEqual(standardLower.target.thinking, {
    type: "adaptive",
    display: "summarized",
  });

  const govUpper = planned(
    planBedrockLevel(candidate("us.anthropic.claude-sonnet-4-6"), "high", {
      kind: "known",
      name: "US-GOV-WEST-1",
    }),
  );
  assert.deepEqual(govUpper.target.thinking, { type: "adaptive" });
  assert.equal(Object.hasOwn(govUpper.target.thinking, "display"), false);
  assert.deepEqual(govUpper.target.output_config, { effort: "high" });
});

test("a region that is not a record with kind unknown or a known nonempty string name is invalid input", () => {
  for (const region of [
    { kind: "known", name: "" },
    { kind: "known" },
    undefined,
    { kind: "guess" },
  ]) {
    assert.deepEqual(
      planBedrockLevel(
        candidate("us.anthropic.claude-sonnet-4-6"),
        "high",
        region,
      ),
      {
        kind: "invalid-input",
        code: "region",
      },
    );
  }
});

test("non-baseline ids are insufficient evidence, never inferred from a prefix, version or alias", () => {
  const ids = [
    "chat:anthropic.claude-sonnet-4-6",
    "acme/anthropic.claude-sonnet-4-6",
    "anthropic.claude-opus-4-6",
    "anthropic.claude-sonnet-4-6-v2",
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "anthropic.claude-sonnet-5-5",
    "anthropic.claude-haiku-5-5",
    "us-gov.anthropic.claude-opus-4-6-v1",
    "arn:aws-us-gov:bedrock:anthropic.claude-sonnet-4-6",
    "openai.gpt-oss-120b",
    "xai.grok-4.6",
    "bedrock-sonnet-host",
  ];
  for (const id of ids) {
    assert.deepEqual(
      planBedrockLevel(candidate(id), "high", STANDARD),
      {
        kind: "insufficient",
        reason: "model",
      },
      id,
    );
  }
});

test("a wrong package or API is insufficient, with no fallback to another snapshot", () => {
  assert.deepEqual(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6", {
        packageName: "@opencode/ai/providers/amazon-bedrock-mantle",
      }),
      "high",
      STANDARD,
    ),
    { kind: "insufficient", reason: "package" },
  );
  assert.deepEqual(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6", { api: "bedrock-converse" }),
      "high",
      STANDARD,
    ),
    { kind: "insufficient", reason: "api" },
  );
});

test("an unknown, empty or non-string level is invalid input", () => {
  for (const level of ["none", "ultra", "", undefined, 3]) {
    assert.deepEqual(
      planBedrockLevel(
        candidate("us.anthropic.claude-sonnet-4-6"),
        level,
        STANDARD,
      ),
      {
        kind: "invalid-input",
        code: "level",
      },
    );
  }
});

test("a range admits the inclusive intersection of each control's logical set, without selecting one", () => {
  const range = planBedrockRange(
    candidate("us.anthropic.claude-sonnet-4-6"),
    { from: "low", to: "high" },
    STANDARD,
  );
  assert.equal(range.kind, "range");
  assert.deepEqual(
    range.candidates.map((entry) => entry.admittedLevels),
    [["low"], ["medium"], ["high"]],
  );
  assert.deepEqual(
    range.candidates.map((entry) => entry.target.output_config.effort),
    ["low", "medium", "high"],
  );
});

test("a range starting at minimal admits both minimal and low on the low control", () => {
  const range = planBedrockRange(
    candidate("us.anthropic.claude-sonnet-4-6"),
    { from: "minimal", to: "low" },
    STANDARD,
  );
  assert.equal(range.kind, "range");
  assert.equal(range.candidates.length, 1);
  assert.deepEqual(range.candidates[0].admittedLevels, ["minimal", "low"]);
  assert.deepEqual(range.candidates[0].compatibleLevels, ["minimal", "low"]);
});

test("a range admits max inside its bounds and its candidates reflect that", () => {
  const range = planBedrockRange(
    candidate("us.anthropic.claude-sonnet-4-6"),
    { from: "high", to: "max" },
    STANDARD,
  );
  assert.deepEqual(
    range.candidates.map((entry) => entry.admittedLevels),
    [["high"], ["max"]],
  );
});

test("a range whose only levels are xhigh admits nothing, and is none rather than success", () => {
  assert.deepEqual(
    planBedrockRange(
      candidate("us.anthropic.claude-sonnet-4-6"),
      { from: "xhigh", to: "xhigh" },
      STANDARD,
    ),
    { kind: "none" },
  );
});

test("reversed bounds and unknown endpoints are invalid input", () => {
  assert.deepEqual(
    planBedrockRange(
      candidate("us.anthropic.claude-sonnet-4-6"),
      { from: "high", to: "low" },
      STANDARD,
    ),
    { kind: "invalid-input", code: "range" },
  );
  assert.deepEqual(
    planBedrockRange(
      candidate("us.anthropic.claude-sonnet-4-6"),
      { from: "low", to: "ultra" },
      STANDARD,
    ),
    { kind: "invalid-input", code: "level" },
  );
});

test("a range with a positive level and an unknown region is pending, while an off-only range is planned", () => {
  assert.deepEqual(
    planBedrockRange(
      candidate("us.anthropic.claude-sonnet-4-6"),
      { from: "minimal", to: "high" },
      UNKNOWN,
    ),
    { kind: "pending-region" },
  );
  const offOnly = planBedrockRange(
    candidate("us.anthropic.claude-sonnet-4-6"),
    { from: "off", to: "off" },
    UNKNOWN,
  );
  assert.equal(offOnly.kind, "range");
  assert.equal(offOnly.candidates[0].target.kind, "off");
});

test("knowing an effort field alone never produces a ThinkingProof for Bedrock", () => {
  const proof = knownThinkingProof(
    {
      providerID: "acme",
      modelID: "anthropic.claude-sonnet-4-6",
      package: PACKAGE,
      limit: { output: 64000 },
      variants: [],
    },
    {
      id: "arbitrary",
      body: {
        additionalModelRequestFields: {
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
        },
      },
    },
  );
  assert.equal(proof, undefined);
});

test("a positive target over observed native fields without thinking is proven at the overlay", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const verdict = verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("high"));
  assert.deepEqual(verdict, {
    kind: "proven",
    scope: "at-overlay",
    level: "high",
    conditions: ["default-thinking-display"],
    evidence: plan.evidence,
  });
});

test("unrelated caller fields survive the merge and do not conflict with the target", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const verdict = verifyBedrockOverlay(
    plan,
    observed({
      top_k: 40,
      output_config: { effort: "high", format: "synthetic" },
    }),
    adaptiveOverlay("high"),
  );
  assert.equal(verdict.kind, "proven");
});

test("an inherited budget_tokens cannot be deleted by the overlay, so the verdict is unproven", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const verdict = verifyBedrockOverlay(
    plan,
    observed({ thinking: { type: "enabled", budget_tokens: 8000 } }),
    adaptiveOverlay("high"),
  );
  assert.deepEqual(verdict, { kind: "unproven", reasons: ["budget-tokens"] });
});

test("an inherited block_binding and an inherited anthropic_beta each conflict", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({
        thinking: { block_binding: { prefix_mismatch_behavior: "drop_block" } },
      }),
      adaptiveOverlay("high"),
    ),
    { kind: "unproven", reasons: ["block-binding"] },
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({ anthropic_beta: ["synthetic-beta"] }),
      adaptiveOverlay("high"),
    ),
    { kind: "unproven", reasons: ["anthropic-beta"] },
  );
});

test("a missing display is unproven, never assumed summarized", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("high", null)),
    {
      kind: "unproven",
      reasons: ["display"],
    },
  );
});

test("an inherited display is overwritten by the overlay, while a GovCloud target keeps display absent", () => {
  const standard = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  assert.equal(
    verifyBedrockOverlay(
      standard,
      observed({ thinking: { display: "omitted" } }),
      adaptiveOverlay("high"),
    ).kind,
    "proven",
  );

  const gov = planned(
    planBedrockLevel(candidate("us.anthropic.claude-sonnet-4-6"), "high", GOV),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      gov,
      observed({ thinking: { display: "summarized" } }),
      adaptiveOverlay("high", null),
    ),
    { kind: "unproven", reasons: ["display"] },
  );
});

test("an extra thinking subfield conflicts, and a disabled or other thinking type conflicts", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(plan, ABSENT, {
      thinking: { type: "adaptive", display: "summarized", synthetic: 1 },
      output_config: { effort: "high" },
    }),
    { kind: "unproven", reasons: ["thinking-extra-field"] },
  );
  assert.deepEqual(
    verifyBedrockOverlay(plan, ABSENT, {
      thinking: { type: "disabled" },
      output_config: { effort: "high" },
    }),
    { kind: "unproven", reasons: ["thinking-type", "display"] },
  );
});

test("a wrong or missing effort is unproven, and an inherited effort is overwritten only by the overlay", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(plan, observed({ output_config: { effort: "low" } }), {
      thinking: { type: "adaptive", display: "summarized" },
    }),
    { kind: "unproven", reasons: ["effort"] },
  );
  assert.deepEqual(
    verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("medium")),
    { kind: "unproven", reasons: ["effort"] },
  );
  assert.equal(
    verifyBedrockOverlay(
      plan,
      observed({ output_config: { effort: "low" } }),
      adaptiveOverlay("high"),
    ).kind,
    "proven",
  );
});

test("unknown native fields make the verdict conditional, whatever the overlay", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(plan, UNKNOWN_NATIVE, adaptiveOverlay("high")),
    {
      kind: "conditional",
      reason: "native-unknown",
    },
  );
});

test("off with observed absence and no overlay is proven, while an empty overlay over unknown native is conditional", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "off",
      UNKNOWN,
    ),
  );
  assert.equal(verifyBedrockOverlay(plan, ABSENT, undefined).kind, "proven");
  assert.deepEqual(verifyBedrockOverlay(plan, UNKNOWN_NATIVE, {}), {
    kind: "conditional",
    reason: "native-unknown",
  });
});

test("off rejects present thinking, disabled included, and present output effort", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "off",
      UNKNOWN,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({ thinking: { type: "disabled" } }),
      undefined,
    ),
    {
      kind: "unproven",
      reasons: ["thinking-present"],
    },
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({ output_config: { effort: "low" } }),
      undefined,
    ),
    {
      kind: "unproven",
      reasons: ["effort-present"],
    },
  );
  assert.deepEqual(verifyBedrockOverlay(plan, ABSENT, { thinking: null }), {
    kind: "unproven",
    reasons: ["thinking-present"],
  });
});

test("off keeps an output_config without effort, and rejects an inherited anthropic_beta", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "off",
      UNKNOWN,
    ),
  );
  assert.equal(
    verifyBedrockOverlay(
      plan,
      observed({ output_config: { format: "synthetic" } }),
      undefined,
    ).kind,
    "proven",
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({ anthropic_beta: ["synthetic-beta"] }),
      undefined,
    ),
    {
      kind: "unproven",
      reasons: ["anthropic-beta"],
    },
  );
});

test("a plan that is not planned is never verified", () => {
  const pending = planBedrockLevel(
    candidate("us.anthropic.claude-sonnet-4-6"),
    "high",
    UNKNOWN,
  );
  assert.deepEqual(
    verifyBedrockOverlay(pending, ABSENT, adaptiveOverlay("high")),
    {
      kind: "not-planned",
      plan: "pending-region",
    },
  );
  assert.deepEqual(
    verifyBedrockOverlay(null, ABSENT, adaptiveOverlay("high")),
    {
      kind: "invalid-input",
      code: "plan",
    },
  );
});

test("malformed native or overlay input fails closed with a code and never echoes the input", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const getter = {};
  Object.defineProperty(getter, "top_k", {
    enumerable: true,
    get() {
      throw new Error(SECRET);
    },
  });
  const sparse = [];
  sparse[1] = 1;
  const deep = { level: 0 };
  let cursor = deep;
  for (let depth = 0; depth < 40; depth += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  const cases = [
    [observed(getter), undefined, "native"],
    [ABSENT, { thinking: () => SECRET }, "overlay"],
    [
      observed({ output_config: { effort: "high", list: sparse } }),
      undefined,
      "native",
    ],
    [observed(deep), undefined, "native"],
    [observed({ n: Number.NaN }), undefined, "native"],
    [ABSENT, [SECRET], "overlay"],
    [
      Object.defineProperty(
        { kind: "observed" },
        "additionalModelRequestFields",
        {
          enumerable: true,
          get() {
            throw new Error(SECRET);
          },
        },
      ),
      undefined,
      "native",
    ],
  ];
  for (const [native, overlay, code] of cases) {
    const verdict = verifyBedrockOverlay(plan, native, overlay);
    assert.deepEqual(verdict, { kind: "invalid-input", code });
    assert.equal(JSON.stringify(verdict).includes(SECRET), false);
  }
});

test("returned plans are frozen and do not change when the candidate is mutated afterwards", () => {
  const input = candidate("us.anthropic.claude-sonnet-4-6");
  const plan = planned(planBedrockLevel(input, "high", STANDARD));
  input.protocolModelID = "anthropic.claude-sonnet-5-5";
  assert.ok(
    plan.evidence.includes('"us.anthropic.claude-sonnet-4-6"'),
    plan.evidence,
  );
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.target));
  assert.ok(Object.isFrozen(plan.target.thinking));
  assert.ok(Object.isFrozen(plan.compatibleLevels));
  assert.throws(() => {
    plan.target.output_config.effort = "low";
  }, TypeError);
});

test("the overlay gate never mutates the observed native fields or the overlay", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const native = observed({
    top_k: 40,
    output_config: { effort: "high", format: "synthetic" },
  });
  const overlay = adaptiveOverlay("high");
  const before = JSON.stringify([native, overlay]);
  verifyBedrockOverlay(plan, native, overlay);
  assert.equal(JSON.stringify([native, overlay]), before);
});

// Region boundary. The name is the supplied configured string, checked only by the literal SDK predicate
// (lowercased, startsWith "us-gov-"). Nothing here validates it as an AWS region, so these results carry no
// validity claim.
const STANDARD_THINKING = { type: "adaptive", display: "summarized" };
const GOVCLOUD_THINKING = { type: "adaptive" };

test("region names follow the literal SDK predicate case-insensitively, without trimming or AWS validation", () => {
  const cases = [
    ["us-gov-west-1", "govcloud"],
    ["US-GOV-WEST-1", "govcloud"],
    ["Us-Gov-East-1", "govcloud"],
    ["us-gov-", "govcloud"],
    ["us-gov", "standard"],
    ["us east1", "standard"],
    ["not-a-region", "standard"],
    ["   ", "standard"],
    [" us-gov-west-1", "standard"],
  ];
  for (const [name, expected] of cases) {
    const plan = planned(
      planBedrockLevel(candidate("us.anthropic.claude-sonnet-4-6"), "high", {
        kind: "known",
        name,
      }),
    );
    assert.equal(plan.regionClass, expected, JSON.stringify(name));
    if (expected === "govcloud") {
      assert.deepEqual(plan.target.thinking, GOVCLOUD_THINKING, name);
      assert.deepEqual(plan.conditions, [], name);
    } else {
      assert.deepEqual(plan.target.thinking, STANDARD_THINKING, name);
      assert.deepEqual(plan.conditions, ["default-thinking-display"], name);
    }
  }
});

test("unknown, missing, nonstring and empty region inputs never prove a standard result", () => {
  const id = "us.anthropic.claude-sonnet-4-6";
  assert.equal(
    planBedrockLevel(candidate(id), "high", { kind: "unknown" }).kind,
    "pending-region",
  );
  const rejected = [
    undefined,
    "us-east-1",
    { kind: "known" },
    { kind: "known", name: 42 },
    { kind: "known", name: "" },
    { kind: "guess", name: "us-east-1" },
  ];
  for (const region of rejected) {
    assert.deepEqual(
      planBedrockLevel(candidate(id), "high", region),
      { kind: "invalid-input", code: "region" },
      JSON.stringify(region),
    );
  }
});

test("the default display condition is required on the standard path, and a region class cannot bypass it", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const verdict = verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("high"));
  assert.equal(verdict.kind, "proven");
  assert.deepEqual(verdict.conditions, ["default-thinking-display"]);

  const invalid = { kind: "invalid-input", code: "plan" };
  assert.deepEqual(
    verifyBedrockOverlay(
      { ...plan, conditions: [] },
      ABSENT,
      adaptiveOverlay("high"),
    ),
    invalid,
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      { ...plan, regionClass: "govcloud", target: govTarget(plan) },
      ABSENT,
      adaptiveOverlay("high", null),
    ),
    invalid,
  );
});

function govTarget(plan) {
  return { ...plan.target, thinking: GOVCLOUD_THINKING };
}

// Own __proto__ records. JSON.parse and defineProperty both create an own key named __proto__. Merging such a
// record sets a prototype instead of a key, so a thinking field could be read from the prototype that the wire
// never sends. Any own __proto__ key is therefore rejected, at the root and when nested.
const PROTO_OVERLAY =
  '{"__proto__":{"thinking":{"type":"adaptive","display":"summarized"}},"output_config":{"effort":"high"}}';

test("an own __proto__ key in the overlay is invalid, at the root, when nested, and when defined directly", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const invalid = { kind: "invalid-input", code: "overlay" };
  assert.deepEqual(
    verifyBedrockOverlay(plan, observed({}), JSON.parse(PROTO_OVERLAY)),
    invalid,
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({}),
      JSON.parse(
        '{"thinking":{"__proto__":{"type":"adaptive"}},"output_config":{"effort":"high"}}',
      ),
    ),
    invalid,
  );
  const defined = { output_config: { effort: "high" } };
  Object.defineProperty(defined, "__proto__", {
    value: { thinking: { type: "adaptive", display: "summarized" } },
    enumerable: true,
  });
  assert.deepEqual(verifyBedrockOverlay(plan, observed({}), defined), invalid);
});

test("an own __proto__ key in the native fields is invalid at the root, when nested, and with an undefined value", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const invalid = { kind: "invalid-input", code: "native" };
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed(JSON.parse('{"__proto__":{"thinking":{"type":"adaptive"}}}')),
      adaptiveOverlay("high"),
    ),
    invalid,
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({ thinking: JSON.parse('{"__proto__":{}}') }),
      adaptiveOverlay("high"),
    ),
    invalid,
  );
  const undefinedValue = {};
  Object.defineProperty(undefinedValue, "__proto__", {
    value: undefined,
    enumerable: true,
  });
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed(undefinedValue),
      adaptiveOverlay("high"),
    ),
    invalid,
  );
});

test("an own __proto__ overlay is never proof for off either, and its serialized form carries no thinking key", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "off",
      UNKNOWN,
    ),
  );
  const parsed = JSON.parse(PROTO_OVERLAY);
  assert.equal(Object.hasOwn(parsed, "thinking"), false);
  assert.deepEqual(verifyBedrockOverlay(plan, ABSENT, parsed), {
    kind: "invalid-input",
    code: "overlay",
  });
});

test("an overlay whose nested thinking merges to nothing leaves the key absent, as the upstream merge does", () => {
  const offPlan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "off",
      UNKNOWN,
    ),
  );
  assert.equal(
    verifyBedrockOverlay(offPlan, observed({ thinking: {} }), { thinking: {} })
      .kind,
    "proven",
  );

  const adaptivePlan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const verdict = verifyBedrockOverlay(
    adaptivePlan,
    observed({ thinking: {} }),
    { thinking: {} },
  );
  assert.equal(verdict.kind, "unproven");
  assert.ok(
    verdict.reasons.includes("thinking-missing"),
    JSON.stringify(verdict),
  );
});

// Plan validation. A plan is trusted only when it equals the canonical plan recomputed from its own candidate,
// level and region class. Each forged shape below changes one field of a real plan, and each must be refused.
test("a forged plan whose target, level, set, evidence, candidate, conditions or region class differs is invalid", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const native = observed({});
  const invalid = { kind: "invalid-input", code: "plan" };
  const mediumOverlay = {
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "medium" },
  };
  const offTarget = {
    kind: "off",
    absent: ["thinking", "output_config.effort", "anthropic_beta"],
  };
  const forged = [
    {
      ...plan,
      target: { ...plan.target, output_config: { effort: "medium" } },
    },
    { ...plan, level: "medium" },
    { ...plan, compatibleLevels: ["high", "max"] },
    { ...plan, evidence: "pi-ai@0.87.1 forged citation" },
    {
      ...plan,
      candidate: {
        ...plan.candidate,
        protocolModelID: "anthropic.claude-sonnet-5-5",
      },
    },
    { ...plan, target: offTarget },
    { ...plan, conditions: [] },
    { ...plan, regionClass: "not-applicable" },
    { ...plan, extra: 1 },
  ];
  for (const candidatePlan of forged) {
    assert.deepEqual(
      verifyBedrockOverlay(candidatePlan, native, mediumOverlay),
      invalid,
    );
  }
});

test("arbitrary plans with no target, a getter or a function in place of a target are invalid and do not throw", () => {
  const invalid = { kind: "invalid-input", code: "plan" };
  assert.deepEqual(
    verifyBedrockOverlay(
      { kind: "planned", level: "high" },
      ABSENT,
      adaptiveOverlay("high"),
    ),
    invalid,
  );
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const withGetter = { ...plan };
  Object.defineProperty(withGetter, "target", {
    enumerable: true,
    get() {
      throw new Error(SECRET);
    },
  });
  assert.deepEqual(
    verifyBedrockOverlay(withGetter, ABSENT, adaptiveOverlay("high")),
    invalid,
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      { ...plan, target: () => SECRET },
      ABSENT,
      adaptiveOverlay("high"),
    ),
    invalid,
  );
});

test("a copied plan with unchanged canonical data is verified the same as the original", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-sonnet-4-6"),
      "high",
      STANDARD,
    ),
  );
  const copy = JSON.parse(JSON.stringify(plan));
  assert.equal(
    verifyBedrockOverlay(copy, ABSENT, adaptiveOverlay("high")).kind,
    "proven",
  );
});

// ----- All 47 verified adaptive profiles (Pi 0.87.1 catalogue, read as data) -----

// Source transcription, not the module under test. claude-model.ts (OpenCode 8a8bd622, blob 244b3bd8) claudeVersion and
// supportsThinkingBlockBinding, applied to the model id only. bedrock-converse.ts (blob 52a411e9)
// applyThinkingBindingDefault adds thinking adaptive with block_binding and the beta when no providerOptions.thinking is
// passed. The host compatibility override is passed explicitly here, as a fixture input, not as a module input.
function claudeVersion(id) {
  const match =
    /(?:^|[./])claude-(?<family>[a-z]+)-(?<major>\d+)(?:[.-](?<minor>\d{1,2}))?(?:$|[-:@])/.exec(
      id.toLowerCase(),
    )?.groups;
  if (!match) {
    return undefined;
  }
  return { major: Number(match.major), minor: Number(match.minor ?? 0) };
}

function supportsThinkingBlockBinding(id, compatibility) {
  if (compatibility?.supportsThinkingBlockBinding !== undefined) {
    return compatibility.supportsThinkingBlockBinding;
  }
  const version = claudeVersion(id);
  return (
    version !== undefined &&
    (version.major > 5 || (version.major === 5 && version.minor >= 1))
  );
}

// The native fields that the default route adds, or undefined when the source adds none.
function nativeDefaultFields(id, compatibility) {
  if (!supportsThinkingBlockBinding(id, compatibility)) {
    return undefined;
  }
  return {
    thinking: {
      type: "adaptive",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    },
    anthropic_beta: ["thinking-binding-controls-2026-08-01"],
  };
}

const GROUP_A = [
  "anthropic.claude-opus-4-7",
  "anthropic.claude-opus-4-8",
  "anthropic.claude-sonnet-5",
  "au.anthropic.claude-opus-4-7",
  "au.anthropic.claude-opus-4-8",
  "au.anthropic.claude-opus-5",
  "au.anthropic.claude-sonnet-5",
  "eu.anthropic.claude-opus-4-7",
  "eu.anthropic.claude-opus-4-8",
  "eu.anthropic.claude-opus-5",
  "eu.anthropic.claude-sonnet-5",
  "global.anthropic.claude-opus-4-7",
  "global.anthropic.claude-opus-4-8",
  "global.anthropic.claude-opus-5",
  "global.anthropic.claude-sonnet-5",
  "jp.anthropic.claude-opus-4-7",
  "jp.anthropic.claude-opus-4-8",
  "jp.anthropic.claude-opus-5",
  "jp.anthropic.claude-sonnet-5",
  "us.anthropic.claude-opus-4-7",
  "us.anthropic.claude-opus-4-8",
  "us.anthropic.claude-opus-5",
  "us.anthropic.claude-sonnet-5",
];
const GROUP_B = [
  "anthropic.claude-opus-5-5",
  "au.anthropic.claude-opus-5-5",
  "eu.anthropic.claude-opus-5-5",
  "global.anthropic.claude-opus-5-5",
  "jp.anthropic.claude-opus-5-5",
  "us.anthropic.claude-opus-5-5",
];
const GROUP_C = [
  "anthropic.claude-fable-5",
  "eu.anthropic.claude-fable-5",
  "global.anthropic.claude-fable-5",
  "us.anthropic.claude-fable-5",
];
const GROUP_D = [
  "anthropic.claude-fable-5-1",
  "global.anthropic.claude-fable-5-1",
  "us.anthropic.claude-fable-5-1",
];
const ALL_47 = [
  ...EXPECTED_BASELINE,
  ...GROUP_A,
  ...GROUP_B,
  ...GROUP_C,
  ...GROUP_D,
];
const PROFILES = bedrock.BEDROCK_ADAPTIVE_PROFILES;
const PROFILE_BY_ID = new Map(
  (PROFILES ?? []).map((profile) => [profile.protocolModelID, profile]),
);

// Reads the profile of a source id, failing the test when the id is not one of the 47.
function profileOf(id) {
  const profile = PROFILE_BY_ID.get(id);
  assert.notEqual(
    profile,
    undefined,
    `${id} is not a verified adaptive profile`,
  );
  return profile;
}

// A mutation attempt that reports instead of throwing. An accepted write is restored before any assertion.
function attemptSet(target, key, value) {
  const original = target[key];
  const accepted = Reflect.set(target, key, value);
  if (accepted) {
    target[key] = original;
  }
  return accepted;
}

const SONNET_46 = "us.anthropic.claude-sonnet-4-6";
const STANDARD_DISPLAY = "default-thinking-display";
const NATIVE_BINDING = "native-block-binding-default-applies";

test("the profile table is exactly the 47 verified 0.87.1 ids, each listed once", () => {
  assert.equal(Array.isArray(PROFILES), true);
  const ids = PROFILES.map((profile) => profile.protocolModelID);
  assert.equal(new Set(ids).size, 47);
  assert.deepEqual([...ids].sort(), [...ALL_47].sort());
});

test("the map shapes partition the 47 rows as 11 max-only, 29 xhigh-max and 7 off-null", () => {
  const shapes = (shape) =>
    PROFILES.filter((profile) => profile.thinkingLevelMap === shape).map(
      (profile) => profile.protocolModelID,
    );
  assert.deepEqual(shapes("max-only").sort(), [...EXPECTED_BASELINE].sort());
  assert.deepEqual(shapes("xhigh-max").sort(), [...GROUP_A, ...GROUP_B].sort());
  assert.deepEqual(
    shapes("off-null-xhigh-max").sort(),
    [...GROUP_C, ...GROUP_D].sort(),
  );
});

test("the eleven baseline ids are unchanged and are exactly the max-only profiles", () => {
  assert.deepEqual([...BEDROCK_BASELINE_IDS], EXPECTED_BASELINE);
  assert.deepEqual(
    PROFILES.filter((profile) => profile.thinkingLevelMap === "max-only").map(
      (profile) => profile.protocolModelID,
    ),
    EXPECTED_BASELINE,
  );
});

test("the native binding bit is set exactly for groups B and D, and matches the source predicate for every row", () => {
  const bits = PROFILES.filter((profile) => profile.nativeBindingDefault).map(
    (profile) => profile.protocolModelID,
  );
  assert.deepEqual(bits.sort(), [...GROUP_B, ...GROUP_D].sort());
  for (const profile of PROFILES) {
    const sourceApplies =
      nativeDefaultFields(profile.protocolModelID) !== undefined;
    assert.equal(
      profile.nativeBindingDefault,
      sourceApplies,
      profile.protocolModelID,
    );
  }
});

test("the source predicate disables the native binding default when the host override is false", () => {
  for (const id of [...GROUP_B, ...GROUP_D]) {
    assert.notEqual(nativeDefaultFields(id), undefined, id);
    assert.equal(
      nativeDefaultFields(id, { supportsThinkingBlockBinding: false }),
      undefined,
      id,
    );
  }
  assert.equal(nativeDefaultFields(SONNET_46), undefined);
});

test("the profile table, its rows and their fields cannot be changed through a mutation attempt", () => {
  assert.equal(Object.isFrozen(PROFILES), true);
  for (const profile of PROFILES) {
    assert.equal(Object.isFrozen(profile), true, profile.protocolModelID);
  }
  const row = profileOf(SONNET_46);
  assert.equal(attemptSet(row, "thinkingLevelMap", "xhigh-max"), false);
  assert.equal(attemptSet(row, "nativeBindingDefault", true), false);
  assert.equal(attemptSet(PROFILES, 0, { protocolModelID: "x" }), false);
  assert.equal(profileOf(SONNET_46).thinkingLevelMap, "max-only");
});

test("every profile plans high with its exact effort, and its conditions include the native binding obstacle only for B and D", () => {
  for (const profile of PROFILES) {
    const plan = planned(
      planBedrockLevel(candidate(profile.protocolModelID), "high", STANDARD),
    );
    assert.equal(
      plan.target.output_config.effort,
      "high",
      profile.protocolModelID,
    );
    assert.deepEqual(plan.compatibleLevels, ["high"], profile.protocolModelID);
    assert.deepEqual(
      plan.conditions,
      profile.nativeBindingDefault
        ? [STANDARD_DISPLAY, NATIVE_BINDING]
        : [STANDARD_DISPLAY],
      profile.protocolModelID,
    );
  }
});

test("minimal and low share effort low and the logical set minimal, low, for every profile", () => {
  for (const profile of PROFILES) {
    for (const level of ["minimal", "low"]) {
      const plan = planned(
        planBedrockLevel(candidate(profile.protocolModelID), level, STANDARD),
      );
      assert.equal(
        plan.target.output_config.effort,
        "low",
        profile.protocolModelID,
      );
      assert.deepEqual(
        plan.compatibleLevels,
        ["minimal", "low"],
        profile.protocolModelID,
      );
    }
  }
});

test("xhigh is planned with effort xhigh for every xhigh-max profile and unsupported for the max-only baseline", () => {
  for (const profile of PROFILES) {
    const plan = planBedrockLevel(
      candidate(profile.protocolModelID),
      "xhigh",
      STANDARD,
    );
    if (profile.thinkingLevelMap === "max-only") {
      assert.deepEqual(
        plan,
        { kind: "unsupported-level", level: "xhigh" },
        profile.protocolModelID,
      );
    } else {
      assert.equal(
        planned(plan).target.output_config.effort,
        "xhigh",
        profile.protocolModelID,
      );
      assert.deepEqual(
        plan.compatibleLevels,
        ["xhigh"],
        profile.protocolModelID,
      );
    }
  }
});

test("max is planned with effort max for every profile", () => {
  for (const profile of PROFILES) {
    const plan = planned(
      planBedrockLevel(candidate(profile.protocolModelID), "max", STANDARD),
    );
    assert.equal(
      plan.target.output_config.effort,
      "max",
      profile.protocolModelID,
    );
    assert.deepEqual(plan.compatibleLevels, ["max"], profile.protocolModelID);
  }
});

test("off is planned as omitted reasoning for every profile with off supported, and is unsupported on groups C and D", () => {
  for (const profile of PROFILES) {
    const result = planBedrockLevel(
      candidate(profile.protocolModelID),
      "off",
      UNKNOWN,
    );
    if (profile.thinkingLevelMap === "off-null-xhigh-max") {
      assert.deepEqual(
        result,
        { kind: "unsupported-level", level: "off" },
        profile.protocolModelID,
      );
    } else {
      const plan = planned(result);
      assert.equal(plan.target.kind, "off", profile.protocolModelID);
      assert.deepEqual(plan.compatibleLevels, ["off"], profile.protocolModelID);
      assert.deepEqual(
        plan.conditions,
        profile.nativeBindingDefault
          ? ["caller-omits-reasoning-option", NATIVE_BINDING]
          : ["caller-omits-reasoning-option"],
        profile.protocolModelID,
      );
    }
  }
});

test("explicit representative positives across groups A, B, C and D (expected values written from source)", () => {
  const cases = [
    {
      id: "au.anthropic.claude-opus-4-7",
      level: "high",
      region: STANDARD,
      effort: "high",
      compat: ["high"],
      conditions: [STANDARD_DISPLAY],
    },
    {
      id: "au.anthropic.claude-opus-4-8",
      level: "xhigh",
      region: STANDARD,
      effort: "xhigh",
      compat: ["xhigh"],
      conditions: [STANDARD_DISPLAY],
    },
    {
      id: "us.anthropic.claude-sonnet-5",
      level: "minimal",
      region: STANDARD,
      effort: "low",
      compat: ["minimal", "low"],
      conditions: [STANDARD_DISPLAY],
    },
    {
      id: "jp.anthropic.claude-opus-5",
      level: "max",
      region: STANDARD,
      effort: "max",
      compat: ["max"],
      conditions: [STANDARD_DISPLAY],
    },
    {
      id: "anthropic.claude-opus-5-5",
      level: "high",
      region: STANDARD,
      effort: "high",
      compat: ["high"],
      conditions: [STANDARD_DISPLAY, NATIVE_BINDING],
    },
    {
      id: "us.anthropic.claude-opus-5-5",
      level: "xhigh",
      region: STANDARD,
      effort: "xhigh",
      compat: ["xhigh"],
      conditions: [STANDARD_DISPLAY, NATIVE_BINDING],
    },
    {
      id: "anthropic.claude-fable-5",
      level: "high",
      region: STANDARD,
      effort: "high",
      compat: ["high"],
      conditions: [STANDARD_DISPLAY],
    },
    {
      id: "eu.anthropic.claude-fable-5",
      level: "xhigh",
      region: STANDARD,
      effort: "xhigh",
      compat: ["xhigh"],
      conditions: [STANDARD_DISPLAY],
    },
    {
      id: "us.anthropic.claude-fable-5",
      level: "minimal",
      region: STANDARD,
      effort: "low",
      compat: ["minimal", "low"],
      conditions: [STANDARD_DISPLAY],
    },
    {
      id: "anthropic.claude-fable-5-1",
      level: "max",
      region: STANDARD,
      effort: "max",
      compat: ["max"],
      conditions: [STANDARD_DISPLAY, NATIVE_BINDING],
    },
    {
      id: "us.anthropic.claude-fable-5-1",
      level: "high",
      region: STANDARD,
      effort: "high",
      compat: ["high"],
      conditions: [STANDARD_DISPLAY, NATIVE_BINDING],
    },
  ];
  for (const item of cases) {
    const plan = planned(
      planBedrockLevel(candidate(item.id), item.level, item.region),
    );
    assert.equal(plan.target.output_config.effort, item.effort, item.id);
    assert.deepEqual(plan.compatibleLevels, item.compat, item.id);
    assert.deepEqual(plan.conditions, item.conditions, item.id);
    assert.deepEqual(
      plan.target.absent,
      ["thinking.budget_tokens", "thinking.block_binding", "anthropic_beta"],
      item.id,
    );
  }
});

test("GovCloud omits display for a 47-profile row and carries no default display condition", () => {
  const plan = planned(
    planBedrockLevel(candidate("us.anthropic.claude-opus-4-7"), "high", GOV),
  );
  assert.deepEqual(plan.target.thinking, { type: "adaptive" });
  assert.deepEqual(plan.conditions, []);
});

test("an unknown region is pending for positive levels on any profile, while off is planned without a region", () => {
  for (const profile of PROFILES.filter(
    (entry) => entry.thinkingLevelMap !== "off-null-xhigh-max",
  )) {
    assert.equal(
      planBedrockLevel(candidate(profile.protocolModelID), "high", UNKNOWN)
        .kind,
      "pending-region",
    );
    assert.equal(
      planBedrockLevel(candidate(profile.protocolModelID), "off", UNKNOWN).kind,
      "planned",
    );
  }
});

test("a range over high to max admits high, xhigh and max as separate controls on an xhigh-max row (candidates)", () => {
  const result = planBedrockRange(
    candidate("au.anthropic.claude-opus-4-7"),
    { from: "high", to: "max" },
    STANDARD,
  );
  assert.equal(result.kind, "range");
  assert.deepEqual(
    result.candidates.map((entry) => entry.admittedLevels),
    [["high"], ["xhigh"], ["max"]],
  );
  assert.deepEqual(
    result.candidates.map((entry) => entry.target.output_config.effort),
    ["high", "xhigh", "max"],
  );
});

test("a range over off to high on an xhigh-max row keeps the off candidate with its full compatible set", () => {
  const result = planBedrockRange(
    candidate("au.anthropic.claude-opus-4-7"),
    { from: "off", to: "high" },
    STANDARD,
  );
  assert.equal(result.kind, "range");
  assert.deepEqual(
    result.candidates.map((entry) => entry.admittedLevels),
    [["off"], ["minimal", "low"], ["medium"], ["high"]],
  );
  assert.equal(result.candidates[0].target.kind, "off");
  assert.deepEqual(result.candidates[1].compatibleLevels, ["minimal", "low"]);
});

test("a range over off to high on an off-null row omits the off candidate, and off..off is none rather than success", () => {
  const result = planBedrockRange(
    candidate("anthropic.claude-fable-5"),
    { from: "off", to: "high" },
    STANDARD,
  );
  assert.equal(result.kind, "range");
  assert.deepEqual(
    result.candidates.map((entry) => entry.admittedLevels),
    [["minimal", "low"], ["medium"], ["high"]],
  );
  assert.deepEqual(
    planBedrockRange(
      candidate("anthropic.claude-fable-5"),
      { from: "off", to: "off" },
      STANDARD,
    ),
    { kind: "none" },
  );
});

test("a range over xhigh to max on a group B row admits xhigh and max, and on the baseline admits only max", () => {
  const groupB = planBedrockRange(
    candidate("anthropic.claude-opus-5-5"),
    { from: "xhigh", to: "max" },
    STANDARD,
  );
  assert.deepEqual(
    groupB.candidates.map((entry) => entry.admittedLevels),
    [["xhigh"], ["max"]],
  );
  const baseline = planBedrockRange(
    candidate(SONNET_46),
    { from: "xhigh", to: "max" },
    STANDARD,
  );
  assert.deepEqual(
    baseline.candidates.map((entry) => entry.admittedLevels),
    [["max"]],
  );
});

test("a range whose levels are all unsupported for the row is none, never success", () => {
  assert.deepEqual(
    planBedrockRange(
      candidate(SONNET_46),
      { from: "xhigh", to: "xhigh" },
      STANDARD,
    ),
    { kind: "none" },
  );
  assert.deepEqual(
    planBedrockRange(
      candidate("anthropic.claude-fable-5"),
      { from: "off", to: "off" },
      STANDARD,
    ),
    { kind: "none" },
  );
});

test("every profile keeps its full compatible set for a single-level range, with no selection", () => {
  for (const profile of PROFILES) {
    const result = planBedrockRange(
      candidate(profile.protocolModelID),
      { from: "minimal", to: "minimal" },
      STANDARD,
    );
    assert.equal(result.kind, "range", profile.protocolModelID);
    assert.deepEqual(
      result.candidates[0].compatibleLevels,
      ["minimal", "low"],
      profile.protocolModelID,
    );
    assert.deepEqual(
      result.candidates[0].admittedLevels,
      ["minimal"],
      profile.protocolModelID,
    );
  }
});

test("alias, prefix, version, host, 1.1-only and non-adaptive ids are insufficient for the model", () => {
  const ids = [
    "anthropic.claude-opus-5",
    "anthropic.claude-sonnet-5-5",
    "anthropic.claude-haiku-5-5",
    "chat:anthropic.claude-opus-4-7",
    "us.anthropic.claude-opus-4-7-v1",
    "global.anthropic.claude-opus-4-7-20260101",
    "au.anthropic.claude-opus-5-5-v2",
    "anthropic.claude-haiku-4-5-20251001-v1:0",
    "bedrock-opus-host",
  ];
  for (const id of ids) {
    assert.deepEqual(
      planBedrockLevel(candidate(id), "high", STANDARD),
      { kind: "insufficient", reason: "model" },
      id,
    );
  }
});

test("a name supplied on the candidate never makes a non-profile id adaptive", () => {
  const input = candidate("anthropic.claude-haiku-4-5-20251001-v1:0", {
    name: "Claude Opus 4.7",
  });
  assert.deepEqual(planBedrockLevel(input, "high", STANDARD), {
    kind: "insufficient",
    reason: "model",
  });
});

test("a profile id under the wrong package or API is insufficient for that axis", () => {
  assert.deepEqual(
    planBedrockLevel(
      candidate("anthropic.claude-opus-4-7", {
        packageName: "@opencode/ai/providers/amazon-bedrock-mantle",
      }),
      "high",
      STANDARD,
    ),
    { kind: "insufficient", reason: "package" },
  );
  assert.deepEqual(
    planBedrockLevel(
      candidate("anthropic.claude-opus-4-7", { api: "bedrock-converse" }),
      "high",
      STANDARD,
    ),
    { kind: "insufficient", reason: "api" },
  );
});

// ----- Native binding and the at-overlay gate: fixtures built from source transcription -----

test("group A with unknown native data is conditional, and never proved from the catalogue", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("au.anthropic.claude-opus-4-8"),
      "xhigh",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(plan, UNKNOWN_NATIVE, adaptiveOverlay("xhigh")),
    {
      kind: "conditional",
      reason: "native-unknown",
    },
  );
});

test("group A xhigh with an exact overlay is proven at the overlay with the display condition only", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("au.anthropic.claude-opus-4-8"),
      "xhigh",
      STANDARD,
    ),
  );
  const verdict = verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("xhigh"));
  assert.equal(verdict.kind, "proven");
  assert.equal(verdict.scope, "at-overlay");
  assert.deepEqual(verdict.conditions, [STANDARD_DISPLAY]);
  assert.deepEqual(
    verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("high")),
    { kind: "unproven", reasons: ["effort"] },
  );
});

test("group A off with no native fields is proven at the overlay under the caller condition only", () => {
  const plan = planned(
    planBedrockLevel(candidate("eu.anthropic.claude-opus-5"), "off", UNKNOWN),
  );
  const verdict = verifyBedrockOverlay(plan, ABSENT, undefined);
  assert.equal(verdict.kind, "proven");
  assert.deepEqual(verdict.conditions, ["caller-omits-reasoning-option"]);
});

test("group A off with an observed disabled thinking block is unproven as thinking-present, never proven", () => {
  const plan = planned(
    planBedrockLevel(candidate("eu.anthropic.claude-opus-5"), "off", UNKNOWN),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      plan,
      observed({ thinking: { type: "disabled" } }),
      undefined,
    ),
    {
      kind: "unproven",
      reasons: ["thinking-present"],
    },
  );
});

test("group A inherited budget_tokens and a GovCloud inherited display are unproven, since the overlay cannot delete them", () => {
  const xhigh = planned(
    planBedrockLevel(
      candidate("au.anthropic.claude-opus-4-8"),
      "xhigh",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      xhigh,
      observed({ thinking: { type: "enabled", budget_tokens: 8000 } }),
      adaptiveOverlay("xhigh"),
    ),
    { kind: "unproven", reasons: ["budget-tokens"] },
  );
  const gov = planned(
    planBedrockLevel(candidate("us.anthropic.claude-opus-4-7"), "high", GOV),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      gov,
      observed({ thinking: { display: "summarized" } }),
      adaptiveOverlay("high", null),
    ),
    { kind: "unproven", reasons: ["display"] },
  );
});

test("a standard display overlay replaces a foreign scalar display and is proven", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("au.anthropic.claude-opus-4-8"),
      "high",
      STANDARD,
    ),
  );
  assert.equal(
    verifyBedrockOverlay(
      plan,
      observed({ thinking: { display: "omitted" } }),
      adaptiveOverlay("high"),
    ).kind,
    "proven",
  );
});

test("group B default native generation (binding and beta) makes the positive plan unproven on both field conflicts", () => {
  const plan = planned(
    planBedrockLevel(candidate("anthropic.claude-opus-5-5"), "high", STANDARD),
  );
  const native = observed(nativeDefaultFields("anthropic.claude-opus-5-5"));
  const verdict = verifyBedrockOverlay(plan, native, adaptiveOverlay("high"));
  assert.equal(verdict.kind, "unproven");
  assert.deepEqual([...verdict.reasons].sort(), [
    "anthropic-beta",
    "block-binding",
  ]);
});

test("group B off with the default native generation is unproven on thinking-present and the beta", () => {
  const plan = planned(
    planBedrockLevel(candidate("au.anthropic.claude-opus-5-5"), "off", UNKNOWN),
  );
  const native = observed(nativeDefaultFields("au.anthropic.claude-opus-5-5"));
  const verdict = verifyBedrockOverlay(plan, native, undefined);
  assert.equal(verdict.kind, "unproven");
  assert.deepEqual([...verdict.reasons].sort(), [
    "anthropic-beta",
    "thinking-present",
  ]);
});

test("group D default native generation is unproven on both field conflicts", () => {
  const plan = planned(
    planBedrockLevel(candidate("anthropic.claude-fable-5-1"), "max", STANDARD),
  );
  const native = observed(nativeDefaultFields("anthropic.claude-fable-5-1"));
  const verdict = verifyBedrockOverlay(plan, native, adaptiveOverlay("max"));
  assert.equal(verdict.kind, "unproven");
  assert.deepEqual([...verdict.reasons].sort(), [
    "anthropic-beta",
    "block-binding",
  ]);
});

// Source-faithful fixture only: the helper models host compatibility false, but the gate never reads that value. The
// result proves the supplied JSON comparison at overlay. The binding condition stays open, and no default reachability
// or real host override is asserted.
test("group B override-derived unbound snapshot (host override false, fixture only) passes the exact overlay at overlay, with the binding condition still open", () => {
  const plan = planned(
    planBedrockLevel(candidate("anthropic.claude-opus-5-5"), "high", STANDARD),
  );
  const unbound = nativeDefaultFields("anthropic.claude-opus-5-5", {
    supportsThinkingBlockBinding: false,
  });
  assert.equal(unbound, undefined);
  const verdict = verifyBedrockOverlay(
    plan,
    observed(unbound),
    adaptiveOverlay("high"),
  );
  assert.equal(verdict.kind, "proven");
  assert.equal(verdict.scope, "at-overlay");
  assert.deepEqual(verdict.conditions, [STANDARD_DISPLAY, NATIVE_BINDING]);
});

test("group B off override-derived unbound snapshot (host override false, fixture only) is proven at overlay with the caller and binding conditions open", () => {
  const plan = planned(
    planBedrockLevel(candidate("au.anthropic.claude-opus-5-5"), "off", UNKNOWN),
  );
  const unbound = nativeDefaultFields("au.anthropic.claude-opus-5-5", {
    supportsThinkingBlockBinding: false,
  });
  const verdict = verifyBedrockOverlay(plan, observed(unbound), undefined);
  assert.equal(verdict.kind, "proven");
  assert.deepEqual(verdict.conditions, [
    "caller-omits-reasoning-option",
    NATIVE_BINDING,
  ]);
});

test("group C off is not a plan, so the gate reports not-planned rather than verifying it", () => {
  const plan = planBedrockLevel(
    candidate("anthropic.claude-fable-5"),
    "off",
    UNKNOWN,
  );
  assert.deepEqual(verifyBedrockOverlay(plan, ABSENT, undefined), {
    kind: "not-planned",
    plan: "unsupported-level",
  });
});

test("group C and D high plans are proven at overlay only with their display condition, since their native default is absent", () => {
  const c = planned(
    planBedrockLevel(candidate("anthropic.claude-fable-5"), "high", STANDARD),
  );
  assert.deepEqual(
    verifyBedrockOverlay(c, ABSENT, adaptiveOverlay("high")).conditions,
    [STANDARD_DISPLAY],
  );
  const d = planned(
    planBedrockLevel(
      candidate("us.anthropic.claude-fable-5-1"),
      "high",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(d, ABSENT, adaptiveOverlay("high")).conditions,
    [STANDARD_DISPLAY, NATIVE_BINDING],
  );
});

test("every profile's positive high plan is proven at overlay with exactly its planned conditions", () => {
  for (const profile of PROFILES) {
    const plan = planned(
      planBedrockLevel(candidate(profile.protocolModelID), "high", STANDARD),
    );
    const verdict = verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("high"));
    assert.equal(verdict.kind, "proven", profile.protocolModelID);
    assert.deepEqual(
      verdict.conditions,
      plan.conditions,
      profile.protocolModelID,
    );
  }
});

// ----- Forged and tampered plans against the canonical row reconstruction -----

test("a plan forged by moving an off plan to a group C row is invalid, since that row has no off control", () => {
  const offPlan = planned(
    planBedrockLevel(candidate("eu.anthropic.claude-opus-5"), "off", UNKNOWN),
  );
  const forged = {
    ...offPlan,
    candidate: {
      ...offPlan.candidate,
      protocolModelID: "anthropic.claude-fable-5",
    },
  };
  assert.deepEqual(verifyBedrockOverlay(forged, ABSENT, undefined), {
    kind: "invalid-input",
    code: "plan",
  });
});

test("a plan whose level is changed from xhigh to high while keeping the xhigh effort is invalid", () => {
  const xhigh = planned(
    planBedrockLevel(
      candidate("au.anthropic.claude-opus-4-8"),
      "xhigh",
      STANDARD,
    ),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      { ...xhigh, level: "high" },
      ABSENT,
      adaptiveOverlay("xhigh"),
    ),
    {
      kind: "invalid-input",
      code: "plan",
    },
  );
});

test("a group B plan with the native binding condition removed is invalid", () => {
  const plan = planned(
    planBedrockLevel(candidate("anthropic.claude-opus-5-5"), "high", STANDARD),
  );
  assert.deepEqual(
    verifyBedrockOverlay(
      { ...plan, conditions: [STANDARD_DISPLAY] },
      ABSENT,
      adaptiveOverlay("high"),
    ),
    {
      kind: "invalid-input",
      code: "plan",
    },
  );
});

test("a baseline plan whose candidate is replaced by a group B id, keeping its conditions, is invalid", () => {
  const plan = planned(
    planBedrockLevel(candidate(SONNET_46), "high", STANDARD),
  );
  const forged = {
    ...plan,
    candidate: {
      ...plan.candidate,
      protocolModelID: "anthropic.claude-opus-5-5",
    },
  };
  assert.deepEqual(
    verifyBedrockOverlay(forged, ABSENT, adaptiveOverlay("high")),
    { kind: "invalid-input", code: "plan" },
  );
});

test("a high plan whose target effort is forged to xhigh is invalid even when the overlay matches the forged target", () => {
  const plan = planned(
    planBedrockLevel(
      candidate("au.anthropic.claude-opus-4-8"),
      "high",
      STANDARD,
    ),
  );
  const forged = {
    ...plan,
    target: { ...plan.target, output_config: { effort: "xhigh" } },
  };
  assert.deepEqual(
    verifyBedrockOverlay(forged, ABSENT, adaptiveOverlay("xhigh")),
    { kind: "invalid-input", code: "plan" },
  );
});

test("a plan is never accepted as a role proof: its verdict carries only overlay scope and conditions", () => {
  const plan = planned(
    planBedrockLevel(candidate("anthropic.claude-opus-5-5"), "high", STANDARD),
  );
  const verdict = verifyBedrockOverlay(plan, ABSENT, adaptiveOverlay("high"));
  assert.equal(verdict.scope, "at-overlay");
  assert.equal("transportKind" in verdict, false);
  assert.notEqual(verdict.kind, "compatible-unconditional");
});

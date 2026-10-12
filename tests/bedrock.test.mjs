import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BEDROCK_BASELINE_IDS,
  planBedrockLevel,
  planBedrockRange,
  verifyBedrockOverlay,
} from "../dist/thinking/bedrock.js";
import { knownThinkingProof } from "../dist/thinking/policies.js";

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
    "us.anthropic.claude-opus-4-7",
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

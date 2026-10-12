import assert from "node:assert/strict";
import { test } from "node:test";

import {
  knownThinkingLevel,
  selectThinkingVariant,
  THINKING_LEVELS,
  thinkingRequirement,
} from "../dist/thinking/policies.js";

const OPENAI = "@opencode/ai/providers/openai";
const XAI = "@opencode/ai/providers/xai";

// Overlay shape emitted by the host's OpenAI Responses protocol for a named effort.
function effortOverlay(level) {
  return {
    settings: {
      reasoningEffort: level,
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  };
}

function model(overrides = {}) {
  return { package: OPENAI, variants: [], ...overrides };
}

function variant(id, overlay = {}) {
  return { id, ...overlay };
}

test("canonical thinking levels run from off to max", () => {
  assert.deepEqual(THINKING_LEVELS, [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});

test("a fixed level must be a canonical level name, compared exactly", () => {
  assert.deepEqual(thinkingRequirement({ kind: "fixed", level: "high" }), {
    ok: true,
    requirement: { from: "high", to: "high" },
  });

  for (const level of ["turbo", "High", "none", ""]) {
    assert.deepEqual(
      thinkingRequirement({ kind: "fixed", level }),
      { ok: false, code: "thinking-level-invalid" },
      `level ${JSON.stringify(level)}`,
    );
  }
});

test("a range accepts equal endpoints and rejects reversed or unknown bounds", () => {
  assert.deepEqual(
    thinkingRequirement({ kind: "range", from: "high", to: "high" }),
    { ok: true, requirement: { from: "high", to: "high" } },
  );
  assert.deepEqual(
    thinkingRequirement({ kind: "range", from: "high", to: "low" }),
    { ok: false, code: "thinking-range-invalid" },
  );
  assert.deepEqual(
    thinkingRequirement({ kind: "range", from: "low", to: "turbo" }),
    { ok: false, code: "thinking-range-invalid" },
  );
  assert.deepEqual(
    thinkingRequirement({ kind: "range", from: "turbo", to: "high" }),
    { ok: false, code: "thinking-range-invalid" },
  );
});

test("an unset setting imposes no requirement", () => {
  assert.deepEqual(thinkingRequirement({ kind: "unset" }), {
    ok: true,
    requirement: undefined,
  });
});

test("the level of an allowlisted package comes from its effort overlay, whatever the variant id", () => {
  assert.equal(
    knownThinkingLevel(model(), variant("deep-think", effortOverlay("high"))),
    "high",
  );
  assert.equal(
    knownThinkingLevel(
      model({ package: XAI }),
      variant("x-1", effortOverlay("low")),
    ),
    "low",
  );
});

test("a named variant id is not a proof of its level", () => {
  assert.equal(knownThinkingLevel(model(), variant("high")), undefined);
  assert.equal(
    knownThinkingLevel(
      model(),
      variant("high", { settings: { thinking: { budgetTokens: 8000 } } }),
    ),
    undefined,
  );
});

test("an overlay of a package outside the allowlist or without a package gives no level", () => {
  assert.equal(
    knownThinkingLevel(
      model({ package: "@opencode/ai/providers/anthropic" }),
      variant("deep", { settings: { effort: "high" } }),
    ),
    undefined,
  );
  assert.equal(
    knownThinkingLevel(
      model({ package: undefined }),
      variant("deep", effortOverlay("high")),
    ),
    undefined,
  );
});

test("a level value outside the canonical names gives no level", () => {
  assert.equal(
    knownThinkingLevel(model(), variant("v", effortOverlay("none"))),
    undefined,
  );
  assert.equal(
    knownThinkingLevel(model(), variant("v", effortOverlay("HIGH"))),
    undefined,
  );
});

test("an extra thinking control on the variant makes the overlay conflicting", () => {
  const conflicting = variant("v", {
    settings: {
      reasoningEffort: "high",
      thinking: { type: "enabled", budgetTokens: 4096 },
    },
  });

  assert.equal(knownThinkingLevel(model(), conflicting), undefined);
});

test("headers or body on the variant or the model make the level obscure", () => {
  const withBody = variant("v", {
    ...effortOverlay("high"),
    body: { reasoning_effort: "low" },
  });
  const withHeaders = variant("v", {
    ...effortOverlay("high"),
    headers: { "x-thinking": "off" },
  });

  assert.equal(knownThinkingLevel(model(), withBody), undefined);
  assert.equal(knownThinkingLevel(model(), withHeaders), undefined);
  assert.equal(
    knownThinkingLevel(
      model({ body: { thinking: false } }),
      variant("v", effortOverlay("high")),
    ),
    undefined,
  );
  assert.equal(
    knownThinkingLevel(
      model({ settings: { reasoningEffort: "low" } }),
      variant("v", effortOverlay("high")),
    ),
    undefined,
  );
});

test("model-level compaction does not hide a proven level", () => {
  assert.equal(
    knownThinkingLevel(
      model({ settings: { compaction: { type: "native" } } }),
      variant("v", effortOverlay("high")),
    ),
    "high",
  );
});

test("a fixed requirement accepts an inline variant with the same proven level", () => {
  const deep = variant("deep", effortOverlay("high"));

  assert.deepEqual(
    selectThinkingVariant(
      model({ variants: [deep] }),
      { from: "high", to: "high" },
      deep,
    ),
    {
      ok: true,
      selection: { kind: "inline", variant: "deep", level: "high" },
    },
  );
});

test("a fixed requirement rejects an inline variant with another or no proven level", () => {
  const low = variant("low", effortOverlay("low"));
  const budget = variant("high", {
    settings: { thinking: { budgetTokens: 8000 } },
  });

  assert.deepEqual(
    selectThinkingVariant(
      model({ variants: [low] }),
      { from: "high", to: "high" },
      low,
    ),
    { ok: false, code: "thinking-variant-mismatch" },
  );
  assert.deepEqual(
    selectThinkingVariant(
      model({ variants: [budget] }),
      { from: "high", to: "high" },
      budget,
    ),
    { ok: false, code: "thinking-variant-unproven" },
  );
});

test("a range accepts an inline variant only inside the inclusive bounds", () => {
  const range = { from: "low", to: "high" };
  const inside = (level) => variant(level, effortOverlay(level));
  const variants = ["minimal", "low", "medium", "high", "xhigh"].map(inside);

  for (const level of ["low", "medium", "high"]) {
    const selected = selectThinkingVariant(
      model({ variants }),
      range,
      inside(level),
    );
    assert.deepEqual(
      selected,
      {
        ok: true,
        selection: { kind: "inline", variant: level, level },
      },
      `inline ${level}`,
    );
  }
  for (const level of ["minimal", "xhigh"]) {
    assert.deepEqual(
      selectThinkingVariant(model({ variants }), range, inside(level)),
      { ok: false, code: "thinking-variant-mismatch" },
      `inline ${level}`,
    );
  }
});

test("without an inline variant every proven option in range is returned, none chosen", () => {
  const variants = [
    variant("max-budget", { settings: { thinking: { budgetTokens: 32000 } } }),
    variant("medium", effortOverlay("medium")),
    variant("low", effortOverlay("low")),
    variant("xhigh", effortOverlay("xhigh")),
  ];

  assert.deepEqual(
    selectThinkingVariant(
      model({ variants }),
      { from: "low", to: "medium" },
      undefined,
    ),
    {
      ok: true,
      selection: {
        kind: "options",
        options: [
          { variant: "medium", level: "medium" },
          { variant: "low", level: "low" },
        ],
      },
    },
  );
});

test("a requirement with no proven variant in range is unsupported", () => {
  const budgetOnly = model({
    variants: [
      variant("high", { settings: { thinking: { budgetTokens: 8000 } } }),
    ],
  });

  assert.deepEqual(
    selectThinkingVariant(budgetOnly, { from: "high", to: "high" }, undefined),
    { ok: false, code: "thinking-unsupported" },
  );
  assert.deepEqual(
    selectThinkingVariant(
      model({ variants: [] }),
      { from: "off", to: "off" },
      undefined,
    ),
    { ok: false, code: "thinking-unsupported" },
  );
});

test("the canonical level list is frozen so callers cannot extend it", () => {
  assert.equal(Object.isFrozen(THINKING_LEVELS), true);
});

test("an empty range bound is invalid, on either side", () => {
  assert.deepEqual(
    thinkingRequirement({ kind: "range", from: "", to: "high" }),
    { ok: false, code: "thinking-range-invalid" },
  );
  assert.deepEqual(
    thinkingRequirement({ kind: "range", from: "low", to: "" }),
    { ok: false, code: "thinking-range-invalid" },
  );
});

test("a literal off effort is not a proven level, with an arbitrary or off-named variant", () => {
  assert.equal(
    knownThinkingLevel(model(), variant("arbitrary", effortOverlay("off"))),
    undefined,
  );
  assert.equal(
    knownThinkingLevel(model(), variant("off", effortOverlay("off"))),
    undefined,
  );
});

test("settings inherited through a prototype cannot establish a level", () => {
  const inheritedSettings = Object.create({ reasoningEffort: "high" });
  const inheritedVariant = Object.create({
    settings: { reasoningEffort: "high" },
  });

  assert.equal(
    knownThinkingLevel(model(), { id: "deep", settings: inheritedSettings }),
    undefined,
  );
  assert.equal(knownThinkingLevel(model(), inheritedVariant), undefined);
});

test("own settings on a null-prototype object establish their level", () => {
  const nullPrototypeSettings = Object.assign(Object.create(null), {
    reasoningEffort: "high",
  });

  assert.equal(
    knownThinkingLevel(model(), {
      id: "deep",
      settings: nullPrototypeSettings,
    }),
    "high",
  );
});

test("an unset requirement keeps the selection unset and leaves an inline variant to the caller", () => {
  assert.deepEqual(selectThinkingVariant(model(), undefined, undefined), {
    ok: true,
    selection: { kind: "unset" },
  });
});

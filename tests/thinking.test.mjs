import assert from "node:assert/strict";
import { test } from "node:test";

import {
  knownThinkingLevels,
  selectThinkingVariant,
  THINKING_LEVELS,
  thinkingRequirement,
} from "../dist/thinking/policies.js";

const OPENAI = "@opencode/ai/providers/openai";

// Single-level adapter for the cases below. Multi-level proofs (many-to-one) are asserted in
// protocols.test.mjs, so a set here reads as undefined, never as a chosen level.
function knownThinkingLevel(model, variant) {
  const levels = knownThinkingLevels(model, variant);
  return levels.length === 1 ? levels[0] : undefined;
}
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
  return {
    id: "gpt-5.4",
    modelID: "gpt-5.4",
    providerID: "openai",
    package: OPENAI,
    variants: [],
    ...overrides,
  };
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
    "high",
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
    withoutEvidence(
      selectThinkingVariant(
        model({ variants: [deep] }),
        { from: "high", to: "high" },
        deep,
      ),
    ),
    {
      ok: true,
      selection: {
        kind: "inline",
        variant: "deep",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
      },
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
    { ok: false, code: "thinking-controls-unproven" },
  );
});

test("a range accepts an inline variant only inside the inclusive bounds", () => {
  const range = { from: "low", to: "high" };
  const inside = (level) => {
    const item = variant(level, effortOverlay(level));
    return {
      ...item,
      settings: {
        ...item.settings,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    };
  };
  const variants = ["minimal", "low", "medium", "high", "xhigh"].map(inside);

  for (const level of ["low", "medium", "high"]) {
    const selected = selectThinkingVariant(
      model({ variants }),
      range,
      inside(level),
    );
    assert.deepEqual(
      withoutEvidence(selected),
      {
        ok: true,
        selection: {
          kind: "inline",
          variant: level,
          transportKind: "native",
          compatibleLevels: [level],
          admittedLevels: [level],
        },
      },
      `inline ${level}`,
    );
  }
  // minimal and xhigh are known OpenAI responses literals, so they are proven but outside low..high.
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
    withoutEvidence(
      selectThinkingVariant(
        model({ variants }),
        { from: "low", to: "medium" },
        undefined,
      ),
    ),
    {
      ok: true,
      selection: {
        kind: "options",
        options: [
          {
            variant: "medium",
            transportKind: "native",
            compatibleLevels: ["medium"],
            admittedLevels: ["medium"],
          },
          {
            variant: "low",
            transportKind: "native",
            compatibleLevels: ["low"],
            admittedLevels: ["low"],
          },
        ],
      },
    },
  );
});

test("a requirement whose variants have unknown semantics is unmapped, not unsupported", () => {
  const budgetOnly = model({
    variants: [
      variant("high", { settings: { thinking: { budgetTokens: 8000 } } }),
    ],
  });

  assert.deepEqual(
    selectThinkingVariant(budgetOnly, { from: "high", to: "high" }, undefined),
    { ok: false, code: "thinking-unmapped" },
  );
  assert.deepEqual(
    selectThinkingVariant(
      model({
        variants: [
          variant("low", { settings: { reasoningEffort: "low" } }),
          variant("deep", { settings: { thinking: { budgetTokens: 8000 } } }),
        ],
      }),
      { from: "high", to: "high" },
      undefined,
    ),
    { ok: false, code: "thinking-unmapped" },
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

// Binary transport (Pi deepseek-format switch for kimi-k2.6). The proof is the full positive
// set; admission depends on the requirement, and the wire stays one binary switch.
const BINARY_MODEL = {
  providerID: "moonshotai",
  modelID: "kimi-k2.6",
  package: "@opencode/ai/providers/moonshot/chat",
  variants: [{ id: "switch", settings: { thinking: { type: "enabled" } } }],
};
const BINARY_POSITIVES = ["minimal", "low", "medium", "high"];

function onlyOption(result) {
  assert.equal(result.ok, true);
  assert.equal(result.selection.kind, "options");
  assert.equal(result.selection.options.length, 1);
  return result.selection.options[0];
}

test("fixed low and fixed high share one binary proof and admit different levels", () => {
  const low = onlyOption(
    selectThinkingVariant(BINARY_MODEL, { from: "low", to: "low" }, undefined),
  );
  const high = onlyOption(
    selectThinkingVariant(
      BINARY_MODEL,
      { from: "high", to: "high" },
      undefined,
    ),
  );

  assert.equal(low.transportKind, "binary");
  assert.deepEqual(low.compatibleLevels, BINARY_POSITIVES);
  assert.deepEqual(low.admittedLevels, ["low"]);
  assert.deepEqual(high.compatibleLevels, BINARY_POSITIVES);
  assert.deepEqual(high.admittedLevels, ["high"]);
  assert.match(low.evidence, /kimi-k2\.6/);
});

test("an inline binary switch keeps its variant and the same transport semantics", () => {
  const result = selectThinkingVariant(
    BINARY_MODEL,
    { from: "low", to: "low" },
    BINARY_MODEL.variants[0],
  );

  assert.equal(result.ok, true);
  assert.equal(result.selection.kind, "inline");
  assert.equal(result.selection.variant, "switch");
  assert.equal(result.selection.transportKind, "binary");
  assert.deepEqual(result.selection.compatibleLevels, BINARY_POSITIVES);
  assert.deepEqual(result.selection.admittedLevels, ["low"]);
});

test("a narrow range admits the non-empty intersection with the proof", () => {
  const option = onlyOption(
    selectThinkingVariant(
      BINARY_MODEL,
      { from: "minimal", to: "low" },
      undefined,
    ),
  );

  assert.deepEqual(option.admittedLevels, ["minimal", "low"]);
  assert.deepEqual(option.compatibleLevels, BINARY_POSITIVES);
});

test("off and max are unsupported by a binary enabled switch, and fail as unsupported", () => {
  assert.deepEqual(
    selectThinkingVariant(BINARY_MODEL, { from: "off", to: "off" }, undefined),
    { ok: false, code: "thinking-unsupported" },
  );
  assert.deepEqual(
    selectThinkingVariant(BINARY_MODEL, { from: "max", to: "max" }, undefined),
    { ok: false, code: "thinking-unsupported" },
  );
});

test("a model id outside the exact table never inherits the binary proof", () => {
  const renamed = { ...BINARY_MODEL, modelID: "kimi-k2.6-preview" };

  assert.deepEqual(
    selectThinkingVariant(renamed, { from: "low", to: "low" }, undefined),
    { ok: false, code: "thinking-unmapped" },
  );
});

test("an effort-capable model does not turn a bare switch into a binary proof", () => {
  const capable = { ...BINARY_MODEL, modelID: "kimi-k3" };

  assert.deepEqual(
    selectThinkingVariant(capable, { from: "low", to: "low" }, undefined),
    { ok: false, code: "thinking-unmapped" },
  );
});

// Evidence is asserted in protocols.test.mjs against its exact scope. Here a selection is compared on
// transport and levels, so the same proof reads the same wherever the evidence string sits.
function withoutEvidence(value) {
  if (Array.isArray(value)) {
    return value.map(withoutEvidence);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const { evidence, ...rest } = value;
  if (evidence !== undefined) {
    assert.equal(typeof evidence, "string");
    assert.notEqual(evidence, "");
  }
  return Object.fromEntries(
    Object.entries(rest).map(([key, field]) => [key, withoutEvidence(field)]),
  );
}

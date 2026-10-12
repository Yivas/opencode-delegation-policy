import assert from "node:assert/strict";
import { test } from "node:test";
import { PreferenceStore } from "../dist/state/store.js";
import {
  googleApiForPackage,
  planGoogleLevel,
  planGoogleRange,
  planGoogleThinkingConfig,
  verifyGoogleCandidate,
  verifyGoogleRange,
} from "../dist/thinking/google.js";
import { knownThinkingProof } from "../dist/thinking/policies.js";
import { validateDelegationAxes } from "../dist/validation/models.js";

// Fixtures below come from the named sources: Pi 0.87.1 catalogue maps and budget code, and the
// @google/genai 2.21.0 ThinkingLevel and ThinkingConfig declarations. No SDK, provider or host runs here.

const GENAI = "google-generative-ai";
const VERTEX = "google-vertex";
const FLASH = "gemini-3-flash-preview";
const PRO31 = "gemini-3.1-pro-preview";
const GEMMA = "gemma-4-31b-it";
const FLASH_LITE_BUDGET = "gemini-2.5-flash-lite";
const COMPUTER_USE = "gemini-2.5-computer-use-preview-10-2025";
const UNCAPPED = { kind: "unknown" };
const ABSENT = { kind: "absent" };
const known = (maxTokens) => ({ kind: "known", maxTokens });

// The whole table is shared between tests, so every case reads it through a fresh object copy.
function snapshot(value) {
  return structuredClone(value);
}

test("the flash level table serializes each canonical level to its SDK enum value", () => {
  const expected = {
    minimal: "MINIMAL",
    low: "LOW",
    medium: "MEDIUM",
    high: "HIGH",
  };
  for (const [level, wire] of Object.entries(expected)) {
    const result = planGoogleLevel(GENAI, FLASH, level);
    assert.equal(result.kind, "compatible-unconditional", level);
    assert.deepEqual(
      result.control,
      { includeThoughts: true, thinkingLevel: wire },
      level,
    );
    assert.deepEqual(result.compatibleLevels, [level], level);
    assert.match(
      result.evidence,
      /^pi-ai@0\.87\.1 google-generative-ai gemini-3-flash-preview thinkingLevelMap /,
    );
    assert.match(result.evidence, /@google\/genai@2\.21\.0 ThinkingLevel$/);
  }
});

test("a pro-class level table nulls minimal, so minimal is a null level, not a clamp", () => {
  assert.deepEqual(planGoogleLevel(GENAI, PRO31, "minimal"), {
    kind: "incompatible",
    reason: "null-level",
    requestedLevel: "minimal",
  });
  assert.equal(
    planGoogleLevel(GENAI, PRO31, "low").control.thinkingLevel,
    "LOW",
  );
  assert.equal(
    planGoogleLevel(GENAI, PRO31, "high").control.thinkingLevel,
    "HIGH",
  );
});

test("off is a null level on every level-table id, and xhigh and max are unsupported", () => {
  for (const modelID of [FLASH, PRO31, GEMMA]) {
    assert.equal(
      planGoogleLevel(GENAI, modelID, "off").reason,
      "null-level",
      modelID,
    );
    assert.equal(
      planGoogleLevel(GENAI, modelID, "xhigh").reason,
      "unsupported-level",
      modelID,
    );
    assert.equal(
      planGoogleLevel(GENAI, modelID, "max").reason,
      "unsupported-level",
      modelID,
    );
  }
});

test("Gemma keeps only minimal and high; its low and medium are nulls that Pi would clamp upward", () => {
  assert.equal(
    planGoogleLevel(GENAI, GEMMA, "minimal").control.thinkingLevel,
    "MINIMAL",
  );
  assert.equal(
    planGoogleLevel(GENAI, GEMMA, "high").control.thinkingLevel,
    "HIGH",
  );
  assert.equal(planGoogleLevel(GENAI, GEMMA, "low").reason, "null-level");
  assert.equal(planGoogleLevel(GENAI, GEMMA, "medium").reason, "null-level");
});

test("the flash-lite image id keeps minimal and high, and low is a null level", () => {
  assert.equal(
    planGoogleLevel(GENAI, "gemini-3.1-flash-lite-image", "minimal").control
      .thinkingLevel,
    "MINIMAL",
  );
  assert.equal(
    planGoogleLevel(GENAI, "gemini-3.1-flash-lite-image", "low").reason,
    "null-level",
  );
});

test("genai and vertex are separate tables: 3.1-pro is on vertex, the 3.1 live and 3.1-lite-preview ids are genai-only", () => {
  assert.equal(
    planGoogleLevel(VERTEX, PRO31, "low").control.thinkingLevel,
    "LOW",
  );
  assert.equal(
    planGoogleLevel(VERTEX, "gemini-3.1-flash-lite-preview", "low").reason,
    "scope",
  );
  assert.equal(
    planGoogleLevel(VERTEX, "gemini-3.1-flash-live-preview", "low").reason,
    "scope",
  );
  assert.equal(
    planGoogleLevel(GENAI, "gemini-3.1-flash-lite-preview", "low").control
      .thinkingLevel,
    "LOW",
  );
});

test("the pro budget table is exact, and levels are conditional on the request cap", () => {
  const expected = { minimal: 128, low: 2048, medium: 8192, high: 32768 };
  for (const [level, budget] of Object.entries(expected)) {
    const result = planGoogleLevel(GENAI, "gemini-2.5-pro", level);
    assert.equal(result.kind, "compatible-conditional", level);
    assert.deepEqual(
      result.control,
      { includeThoughts: true, thinkingBudget: budget },
      level,
    );
    assert.deepEqual(result.condition, { kind: "request-cap", budget }, level);
  }
});

test("the genai flash-lite minimal budget is 512, but vertex flash-lite minimal is 128", () => {
  assert.equal(
    planGoogleLevel(GENAI, FLASH_LITE_BUDGET, "minimal").control.thinkingBudget,
    512,
  );
  assert.equal(
    planGoogleLevel(GENAI, FLASH_LITE_BUDGET, "high").control.thinkingBudget,
    24576,
  );
  assert.equal(
    planGoogleLevel(VERTEX, FLASH_LITE_BUDGET, "minimal").control
      .thinkingBudget,
    128,
  );
  assert.equal(
    planGoogleLevel(VERTEX, FLASH_LITE_BUDGET, "high").control.thinkingBudget,
    24576,
  );
});

test("off on a budget id is conditional on includeThoughts: Pi omits the field and the native reader defaults it to true", () => {
  const off = planGoogleLevel(GENAI, "gemini-2.5-flash", "off");
  assert.equal(off.kind, "compatible-conditional");
  assert.deepEqual(off.control, { thinkingBudget: 0 });
  assert.deepEqual(off.condition, { kind: "include-thoughts-unproven" });
  assert.deepEqual(verifyGoogleCandidate(off, known(4096)), {
    ok: false,
    reason: "include-thoughts-unproven",
  });
});

test("the dynamic fallback ids send -1 as a conditional request-cap control, and off is a conditional budget 0", () => {
  const result = planGoogleLevel(GENAI, COMPUTER_USE, "low");
  assert.equal(result.kind, "compatible-conditional");
  assert.deepEqual(result.control, {
    includeThoughts: true,
    thinkingBudget: -1,
  });
  assert.deepEqual(result.condition, { kind: "request-cap", budget: -1 });
  assert.deepEqual(result.compatibleLevels, [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.match(
    result.evidence,
    /AUTOMATIC, same wire for every positive level/,
  );
  const off = planGoogleLevel(GENAI, COMPUTER_USE, "off");
  assert.equal(off.kind, "compatible-conditional");
  assert.deepEqual(off.control, { thinkingBudget: 0 });
  assert.deepEqual(off.condition, { kind: "include-thoughts-unproven" });
  assert.deepEqual(off.compatibleLevels, ["off"]);
  assert.equal(
    planGoogleLevel(GENAI, COMPUTER_USE, "xhigh").reason,
    "unsupported-level",
  );
  assert.equal(planGoogleLevel(VERTEX, COMPUTER_USE, "low").reason, "scope");
  assert.equal(
    planGoogleLevel(GENAI, "deep-research-max-preview-04-2026", "high").kind,
    "compatible-conditional",
  );
});

test("alias, dated, prefixed and unknown ids get no recipe, and so no inherited budget or level", () => {
  for (const modelID of [
    "gemini-3-flash",
    "gemini-2.5-flash-preview-09-2025",
    "constructor",
    "",
    "gemini-2.5-pro-latest",
  ]) {
    assert.equal(
      planGoogleLevel(GENAI, modelID, "high").reason,
      "scope",
      JSON.stringify(modelID),
    );
  }
});

test("only the exact package names dispatch to a Google API", () => {
  assert.equal(googleApiForPackage("@opencode/ai/providers/google"), GENAI);
  assert.equal(
    googleApiForPackage("@opencode/ai/providers/google-vertex"),
    VERTEX,
  );
  assert.equal(
    googleApiForPackage("@opencode/ai/providers/google-vertex/gemini"),
    undefined,
  );
  assert.equal(googleApiForPackage("@ai-sdk/google"), undefined);
  assert.equal(googleApiForPackage(undefined), undefined);
  assert.equal(
    googleApiForPackage(new String("@opencode/ai/providers/google")),
    undefined,
  );
});

test("a fixed level on a level id verifies with any valid or unknown cap, and a known invalid cap fails first", () => {
  const candidate = planGoogleLevel(GENAI, FLASH, "high");
  assert.deepEqual(verifyGoogleCandidate(candidate, UNCAPPED), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(candidate, known(1)), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(candidate, known(-10)), {
    ok: false,
    reason: "cap-invalid",
  });
  assert.deepEqual(verifyGoogleCandidate(candidate, known(Number.NaN)), {
    ok: false,
    reason: "cap-invalid",
  });
});

test("a conditional budget is refused while its cap is unknown, and passes only when the cap is absent or proves the fit", () => {
  const pro = planGoogleLevel(GENAI, "gemini-2.5-pro", "high");
  assert.deepEqual(verifyGoogleCandidate(pro, UNCAPPED), {
    ok: false,
    reason: "cap-unknown",
  });
  assert.deepEqual(verifyGoogleCandidate(pro, ABSENT), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(pro, known(65536)), { ok: true });
});

test("the native fit at the 32768 boundary: 65536 passes, 65535 and 40000 change the budget", () => {
  const pro = planGoogleLevel(GENAI, "gemini-2.5-pro", "high");
  assert.deepEqual(verifyGoogleCandidate(pro, known(65536)), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(pro, known(65535)), {
    ok: false,
    reason: "budget-changed",
  });
  assert.deepEqual(verifyGoogleCandidate(pro, known(40000)), {
    ok: false,
    reason: "budget-changed",
  });
});

test("the native fit at 128 and at a 512 floor: 256 passes, 255 changes 128 to 512", () => {
  const flash = planGoogleLevel(GENAI, "gemini-2.5-flash", "minimal");
  assert.deepEqual(verifyGoogleCandidate(flash, known(256)), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(flash, known(255)), {
    ok: false,
    reason: "budget-changed",
  });
});

test("512 with a 1023 cap is an equality case: the floor returns 512 unchanged", () => {
  const lite = planGoogleLevel(GENAI, FLASH_LITE_BUDGET, "minimal");
  assert.deepEqual(verifyGoogleCandidate(lite, known(1023)), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(lite, known(1024)), { ok: true });
});

test("a budget above half the cap changes, even when the floor is below the budget", () => {
  const flashMedium = planGoogleLevel(GENAI, "gemini-2.5-flash", "medium");
  assert.deepEqual(verifyGoogleCandidate(flashMedium, known(4096)), {
    ok: false,
    reason: "budget-changed",
  });
  assert.deepEqual(verifyGoogleCandidate(flashMedium, known(16384)), {
    ok: true,
  });
});

test("low at 2048 needs a cap of at least 4096; 4095 floors to 2047 and changes the budget", () => {
  const flashLow = planGoogleLevel(GENAI, "gemini-2.5-flash", "low");
  assert.deepEqual(verifyGoogleCandidate(flashLow, known(4096)), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(flashLow, known(4095)), {
    ok: false,
    reason: "budget-changed",
  });
});

test("a known cap must be a finite positive number; anything else is refused as invalid", () => {
  const pro = planGoogleLevel(GENAI, "gemini-2.5-pro", "high");
  for (const maxTokens of [
    0,
    -4,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "4096",
  ]) {
    assert.deepEqual(
      verifyGoogleCandidate(pro, { kind: "known", maxTokens }),
      { ok: false, reason: "cap-invalid" },
      String(maxTokens),
    );
  }
});

test("a dynamic -1 budget needs a proven cap: unknown fails, absent and valid known pass, invalid known fails", () => {
  const dynamic = planGoogleLevel(GENAI, COMPUTER_USE, "medium");
  assert.deepEqual(verifyGoogleCandidate(dynamic, UNCAPPED), {
    ok: false,
    reason: "cap-unknown",
  });
  assert.deepEqual(verifyGoogleCandidate(dynamic, ABSENT), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(dynamic, known(4096)), { ok: true });
  assert.deepEqual(verifyGoogleCandidate(dynamic, known(-10)), {
    ok: false,
    reason: "cap-invalid",
  });
  assert.deepEqual(verifyGoogleCandidate(dynamic, known(Number.NaN)), {
    ok: false,
    reason: "cap-invalid",
  });
});

test("a dynamic off is a conditional budget 0 gated by includeThoughts, whatever the cap", () => {
  const off = planGoogleLevel(GENAI, COMPUTER_USE, "off");
  assert.deepEqual(verifyGoogleCandidate(off, known(4096)), {
    ok: false,
    reason: "include-thoughts-unproven",
  });
  assert.deepEqual(verifyGoogleCandidate(off, UNCAPPED), {
    ok: false,
    reason: "include-thoughts-unproven",
  });
});

test("a range admits every level its table serves, in order, and chooses none", () => {
  const plan = planGoogleRange(GENAI, FLASH, { from: "low", to: "high" });
  assert.equal(plan.kind, "planned");
  assert.deepEqual(plan.admittedLevels, ["low", "medium", "high"]);
  assert.deepEqual(plan.compatibleLevels, ["minimal", "low", "medium", "high"]);
  assert.deepEqual(
    plan.candidates.map((entry) => entry.level),
    ["low", "medium", "high"],
  );
  assert.deepEqual(
    plan.candidates.map((entry) => entry.compatibility.control.thinkingLevel),
    ["LOW", "MEDIUM", "HIGH"],
  );
});

test("Gemma's range minimal..high admits only minimal and high, and the nulls are excluded", () => {
  const plan = planGoogleRange(GENAI, GEMMA, { from: "minimal", to: "high" });
  assert.deepEqual(plan.admittedLevels, ["minimal", "high"]);
});

test("a pro range that starts at minimal admits low and medium, not a clamped minimal", () => {
  const plan = planGoogleRange(GENAI, PRO31, { from: "minimal", to: "medium" });
  assert.deepEqual(plan.admittedLevels, ["low", "medium"]);
});

test("a range whose only level is null is incompatible with no admitted level", () => {
  assert.deepEqual(
    planGoogleRange(GENAI, PRO31, { from: "minimal", to: "minimal" }),
    {
      kind: "incompatible",
      reason: "no-admitted-level",
    },
  );
});

test("a budget range keeps conditional candidates, each gated separately", () => {
  const plan = planGoogleRange(GENAI, FLASH_LITE_BUDGET, {
    from: "off",
    to: "minimal",
  });
  assert.deepEqual(plan.admittedLevels, ["off", "minimal"]);
  assert.equal(plan.candidates[0].compatibility.kind, "compatible-conditional");
  assert.deepEqual(plan.candidates[0].compatibility.condition, {
    kind: "include-thoughts-unproven",
  });
  assert.deepEqual(plan.candidates[1].compatibility.condition, {
    kind: "request-cap",
    budget: 512,
  });
});

test("a dynamic range admits minimal through high as conditional request-cap candidates and excludes xhigh and max", () => {
  const plan = planGoogleRange(GENAI, COMPUTER_USE, {
    from: "minimal",
    to: "max",
  });
  assert.deepEqual(plan.admittedLevels, ["minimal", "low", "medium", "high"]);
  assert.ok(
    plan.candidates.every(
      (entry) => entry.compatibility.kind === "compatible-conditional",
    ),
  );
  assert.ok(
    plan.candidates.every(
      (entry) => entry.compatibility.condition.kind === "request-cap",
    ),
  );
});

test("a range on an unregistered id is incompatible with scope", () => {
  assert.deepEqual(
    planGoogleRange(GENAI, "unknown-model", { from: "low", to: "high" }),
    {
      kind: "incompatible",
      reason: "scope",
    },
  );
});

test("a native uppercase level is planned from the wire and names no requested level", () => {
  const result = planGoogleThinkingConfig(GENAI, FLASH, {
    thinkingLevel: "MINIMAL",
  });
  assert.equal(result.kind, "compatible-unconditional");
  assert.deepEqual(result.compatibleLevels, ["minimal"]);
  assert.equal("requestedLevel" in result, false);
  assert.equal("level" in result, false);
});

test("a native lowercase level is not a Pi wire, and a mixed-case one is unknown", () => {
  assert.equal(
    planGoogleThinkingConfig(GENAI, FLASH, { thinkingLevel: "minimal" }).reason,
    "unknown-wire",
  );
  assert.equal(
    planGoogleThinkingConfig(GENAI, FLASH, { thinkingLevel: "Minimal" }).reason,
    "unknown-wire",
  );
});

test("a native level outside the table is null, and a level wire on a budget id is a scope mismatch", () => {
  assert.equal(
    planGoogleThinkingConfig(GENAI, GEMMA, { thinkingLevel: "LOW" }).reason,
    "null-level",
  );
  assert.equal(
    planGoogleThinkingConfig(GENAI, PRO31, { thinkingLevel: "MINIMAL" }).reason,
    "null-level",
  );
  assert.equal(
    planGoogleThinkingConfig(GENAI, "gemini-2.5-pro", { thinkingLevel: "LOW" })
      .reason,
    "scope",
  );
});

test("a native wire that conflicts with includeThoughts, or mixes control families, is refused", () => {
  assert.equal(
    planGoogleThinkingConfig(GENAI, GEMMA, {
      thinkingLevel: "HIGH",
      includeThoughts: false,
    }).reason,
    "inline-control-conflict",
  );
  assert.equal(
    planGoogleThinkingConfig(GENAI, FLASH, {
      thinkingLevel: "MINIMAL",
      thinkingBudget: 128,
    }).reason,
    "inline-control-conflict",
  );
  assert.equal(
    planGoogleThinkingConfig(GENAI, FLASH, {}).reason,
    "inline-control-conflict",
  );
});

test("a native budget that matches a recipe is conditional on the cap, and a zero budget is gated by includeThoughts", () => {
  const low = planGoogleThinkingConfig(GENAI, FLASH_LITE_BUDGET, {
    thinkingBudget: 2048,
  });
  assert.equal(low.kind, "compatible-conditional");
  assert.deepEqual(low.compatibleLevels, ["low"]);
  const off = planGoogleThinkingConfig(GENAI, FLASH_LITE_BUDGET, {
    thinkingBudget: 0,
    includeThoughts: true,
  });
  assert.equal(off.kind, "compatible-conditional");
  assert.deepEqual(off.condition, { kind: "include-thoughts-unproven" });
});

test("a native -1 on the fallback id is a conditional request-cap control, and the same number on a budget id is null", () => {
  const dynamic = planGoogleThinkingConfig(GENAI, COMPUTER_USE, {
    thinkingBudget: -1,
  });
  assert.equal(dynamic.kind, "compatible-conditional");
  assert.deepEqual(dynamic.condition, { kind: "request-cap", budget: -1 });
  assert.deepEqual(dynamic.compatibleLevels, [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.equal(
    planGoogleThinkingConfig(GENAI, "gemini-2.5-pro", { thinkingBudget: -1 })
      .reason,
    "null-level",
  );
});

test("a vertex flash-lite budget of 512 is null: vertex's minimal is 128", () => {
  assert.equal(
    planGoogleThinkingConfig(VERTEX, FLASH_LITE_BUDGET, { thinkingBudget: 512 })
      .reason,
    "null-level",
  );
  assert.equal(
    planGoogleThinkingConfig(VERTEX, FLASH_LITE_BUDGET, { thinkingBudget: 128 })
      .kind,
    "compatible-conditional",
  );
});

test("a native budget with includeThoughts false conflicts, and a non-number budget is unknown", () => {
  assert.equal(
    planGoogleThinkingConfig(GENAI, FLASH_LITE_BUDGET, {
      thinkingBudget: 2048,
      includeThoughts: false,
    }).reason,
    "inline-control-conflict",
  );
  assert.equal(
    planGoogleThinkingConfig(GENAI, FLASH_LITE_BUDGET, {
      thinkingBudget: "2048",
    }).reason,
    "unknown-wire",
  );
});

test("a conditional budget variant never becomes a ThinkingProof, however closely it matches a recipe", () => {
  const model = {
    providerID: "google",
    modelID: "gemini-2.5-flash",
    package: "@opencode/ai/providers/google",
    variants: [],
  };
  const variant = {
    id: "budget",
    settings: { thinkingConfig: { thinkingBudget: 2048 } },
  };

  assert.equal(knownThinkingProof(model, variant), undefined);
});

test("a native uppercase MINIMAL through the validator is inline, exact, and never swapped", async () => {
  const catalog = [
    {
      providerID: "google",
      id: FLASH,
      modelID: FLASH,
      enabled: true,
      package: "@opencode/ai/providers/google",
      limit: { context: 1048576, output: 65536 },
      variants: [
        {
          id: "minimal",
          settings: { thinkingConfig: { thinkingLevel: "MINIMAL" } },
        },
        { id: "low", settings: { thinkingConfig: { thinkingLevel: "LOW" } } },
      ],
    },
  ];
  const result = await validateWithRole(catalog, `google/${FLASH}#minimal`, {
    kind: "fixed",
    level: "minimal",
  });

  assert.equal(result.delegation.status, "active");
  assert.equal(result.delegation.roles[0].model.variant, "minimal");
  assert.equal(result.delegation.roles[0].thinking.kind, "inline");
  assert.deepEqual(result.delegation.roles[0].thinking.compatibleLevels, [
    "minimal",
  ]);
});

test("a conditional budget variant on a fixed role fails inline and is not selected as an option", async () => {
  const catalog = [
    {
      providerID: "google",
      id: "gemini-2.5-flash",
      modelID: "gemini-2.5-flash",
      enabled: true,
      package: "@opencode/ai/providers/google",
      limit: { context: 1048576, output: 65536 },
      variants: [
        {
          id: "budget",
          settings: { thinkingConfig: { thinkingBudget: 2048 } },
        },
      ],
    },
  ];

  const inline = await validateWithRole(
    catalog,
    "google/gemini-2.5-flash#budget",
    { kind: "fixed", level: "low" },
  );
  assert.equal(inline.delegation.issues[0].code, "thinking-variant-unproven");

  const option = await validateWithRole(catalog, "google/gemini-2.5-flash", {
    kind: "fixed",
    level: "low",
  });
  assert.equal(option.delegation.issues[0].code, "thinking-unmapped");
});

// Real PreferenceStore over a JSON-copying storage double, and a catalogue double with the envelope the
// host returns. Only these two boundaries are doubles; the validator and store run unchanged.
async function validateWithRole(catalog, reference, thinking) {
  const records = new Map();
  const storage = {
    async get(key) {
      const text = records.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    async set(key, value) {
      records.set(key, JSON.stringify(value));
    },
    async remove(key) {
      records.delete(key);
    },
  };
  const store = new PreferenceStore(storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: { kind: "configured", model: reference } },
    thinking: { small: thinking },
  });
  return validateDelegationAxes({
    store,
    catalog: {
      async list() {
        return {
          location: { directory: "/synthetic" },
          data: snapshot(catalog),
        };
      },
    },
    sessionID: "parent",
  });
}

test("the planners and verifier never mutate their inputs or results across calls", () => {
  const config = Object.freeze({
    thinkingLevel: "MINIMAL",
    includeThoughts: true,
  });
  const before = snapshot(config);
  const first = planGoogleThinkingConfig(GENAI, FLASH, config);
  const second = planGoogleThinkingConfig(GENAI, FLASH, config);
  assert.deepEqual(config, before);
  assert.deepEqual(first, second);
  first.compatibleLevels.push("max");
  assert.deepEqual(
    planGoogleThinkingConfig(GENAI, FLASH, config).compatibleLevels,
    ["minimal"],
  );
});

// verifyGoogleRange: per-candidate gating over one range plan. Passing levels and refused levels are both
// returned; no first level, variant or launch is selected here.
test("a pro range over a 16384 cap admits low and medium and refuses high, with no selection", () => {
  const plan = planGoogleRange(GENAI, "gemini-2.5-pro", {
    from: "low",
    to: "high",
  });
  const verdict = verifyGoogleRange(plan, known(16384));
  assert.equal(verdict.kind, "passing");
  assert.deepEqual(verdict.levels, ["low", "medium"]);
  assert.deepEqual(verdict.rejected, [
    { level: "high", reason: "budget-changed" },
  ]);
  assert.equal("selected" in verdict, false);
  assert.equal("level" in verdict, false);
  assert.equal("variant" in verdict, false);
});

test("an unknown cap admits no budget candidate: the verdict is none-passing, never success", () => {
  const plan = planGoogleRange(GENAI, "gemini-2.5-pro", {
    from: "low",
    to: "high",
  });
  const verdict = verifyGoogleRange(plan, UNCAPPED);
  assert.equal(verdict.kind, "none-passing");
  assert.equal("levels" in verdict, false);
  assert.deepEqual(
    verdict.rejected.map((entry) => entry.reason),
    ["cap-unknown", "cap-unknown", "cap-unknown"],
  );
});

test("a dynamic range passes every level under a known cap and none under an unknown one", () => {
  const plan = planGoogleRange(GENAI, COMPUTER_USE, {
    from: "low",
    to: "high",
  });
  const passing = verifyGoogleRange(plan, known(4096));
  assert.equal(passing.kind, "passing");
  assert.deepEqual(passing.levels, ["low", "medium", "high"]);
  assert.deepEqual(passing.rejected, []);
  assert.equal(verifyGoogleRange(plan, UNCAPPED).kind, "none-passing");
});

test("discrete levels pass under an unknown cap, and a known invalid cap refuses them all", () => {
  const plan = planGoogleRange(GENAI, FLASH, { from: "low", to: "high" });
  const unknown = verifyGoogleRange(plan, UNCAPPED);
  assert.equal(unknown.kind, "passing");
  assert.deepEqual(unknown.levels, ["low", "medium", "high"]);
  const invalid = verifyGoogleRange(plan, known(-10));
  assert.equal(invalid.kind, "none-passing");
  assert.deepEqual(
    invalid.rejected.map((entry) => entry.reason),
    ["cap-invalid", "cap-invalid", "cap-invalid"],
  );
});

test("a mixed range over a known cap keeps only the admitted budget levels, and an absent cap admits all", () => {
  const plan = planGoogleRange(GENAI, "gemini-2.5-flash", {
    from: "minimal",
    to: "high",
  });
  const absent = verifyGoogleRange(plan, ABSENT);
  assert.deepEqual(absent.levels, ["minimal", "low", "medium", "high"]);
  // Native fit keeps a budget only when it is at most half the cap: 8192 / 2 = 4096, so 2048 passes and 8192 does not.
  const capped = verifyGoogleRange(plan, known(8192));
  assert.deepEqual(capped.levels, ["minimal", "low"]);
  assert.deepEqual(capped.rejected, [
    { level: "medium", reason: "budget-changed" },
    { level: "high", reason: "budget-changed" },
  ]);
});

test("an incompatible range plan stays incompatible under any cap", () => {
  const plan = planGoogleRange(GENAI, "unknown-model", {
    from: "low",
    to: "high",
  });
  assert.deepEqual(verifyGoogleRange(plan, known(4096)), {
    kind: "incompatible",
    reason: "scope",
  });
});

test("a dynamic -1 budget variant stays out of the validator: inline fails unproven and no option is offered", async () => {
  const catalog = [
    {
      providerID: "google",
      id: COMPUTER_USE,
      modelID: COMPUTER_USE,
      enabled: true,
      package: "@opencode/ai/providers/google",
      limit: { context: 1048576, output: 65536 },
      variants: [
        {
          id: "auto",
          settings: {
            thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
          },
        },
      ],
    },
  ];
  const inline = await validateWithRole(
    catalog,
    `google/${COMPUTER_USE}#auto`,
    { kind: "fixed", level: "low" },
  );
  assert.equal(inline.delegation.issues[0].code, "thinking-variant-unproven");
  const option = await validateWithRole(catalog, `google/${COMPUTER_USE}`, {
    kind: "fixed",
    level: "low",
  });
  assert.equal(option.delegation.issues[0].code, "thinking-unmapped");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  knownThinkingProof,
  selectThinkingVariant,
} from "../dist/thinking/policies.js";
import { recognizeVariantProof } from "../dist/thinking/protocols.js";
import { admitResponsesVariant } from "../dist/thinking/responses-admission.js";

const OPENAI = "@opencode/ai/providers/openai";
const XAI = "@opencode/ai/providers/xai";

function model(overrides = {}) {
  return {
    id: "gpt-5",
    modelID: "gpt-5",
    providerID: "openai",
    package: OPENAI,
    variants: [],
    ...overrides,
  };
}

function variant(id, effort, overrides = {}) {
  return {
    id,
    settings: {
      reasoningEffort: effort,
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
    ...overrides,
  };
}

const high = { from: "high", to: "high" };
const max = { from: "max", to: "max" };

function selected(modelInfo, variantInfo, requirement) {
  return selectThinkingVariant(modelInfo, requirement, variantInfo);
}

test("OpenAI Responses rejects native max when Pi does not advertise it for GPT-5", () => {
  const maxVariant = variant("arbitrary-name", "max");
  assert.deepEqual(
    selected(model({ variants: [maxVariant] }), maxVariant, max),
    { ok: false, code: "thinking-pi-level-unsupported" },
  );
});

test("the native proof remains a separate fact from Pi admission", () => {
  const maxVariant = variant("anything", "max");
  const modelInfo = model({ variants: [maxVariant] });
  assert.deepEqual(
    knownThinkingProof(modelInfo, maxVariant)?.compatibleLevels,
    ["max"],
  );
  assert.deepEqual(selected(modelInfo, maxVariant, max), {
    ok: false,
    code: "thinking-pi-level-unsupported",
  });
});

test("a matching declared OpenAI identity admits only the translated high class", () => {
  const highVariant = variant("arbitrary", "high");
  const result = selected(
    model({ variants: [highVariant] }),
    highVariant,
    high,
  );
  assert.equal(result.ok, true);
  assert.equal(result.selection.kind, "inline");
  assert.equal(result.selection.variant, "arbitrary");
  assert.deepEqual(result.selection.compatibleLevels, ["high"]);
});

test("xAI uses its own exact catalogue row and route identity", () => {
  const highVariant = variant("v", "high");
  const result = selected(
    model({
      id: "grok-4.6",
      modelID: "grok-4.6",
      providerID: "xai",
      package: XAI,
      variants: [highVariant],
    }),
    highVariant,
    high,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.selection.compatibleLevels, ["high"]);
});

test("the selector admits only Pi levels mapped to the matched native effort", () => {
  const low = variant("low", "low");
  const result = selectThinkingVariant(
    model({ variants: [low] }),
    { from: "low", to: "high" },
    undefined,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.selection.options[0].compatibleLevels, ["low"]);
  assert.deepEqual(result.selection.options[0].admittedLevels, ["low"]);
});

test("direct provider/package conflicts are unresolved instead of permanently unsupported", () => {
  const highVariant = variant("v", "high");
  for (const altered of [
    { providerID: "xai", package: OPENAI },
    { providerID: "openai", package: "custom/openai" },
    { providerID: "openai", canonical: "alias" },
  ]) {
    assert.deepEqual(
      selected(
        model({ ...altered, variants: [highVariant] }),
        highVariant,
        high,
      ),
      { ok: false, code: "thinking-identity-unresolved" },
    );
  }
});

test("unknown model identities remain unresolved and a mismatched API id is not guessed", () => {
  const highVariant = variant("v", "high");
  assert.deepEqual(
    selected(
      model({
        id: "future-model",
        modelID: "future-model",
        variants: [highVariant],
      }),
      highVariant,
      high,
    ),
    { ok: false, code: "thinking-identity-unresolved" },
  );
});

test("summary and include controls are part of admission; unrelated body keys are preserved", () => {
  const missingSummary = variant("missing-summary", "high", {
    settings: {
      reasoningEffort: "high",
      include: ["reasoning.encrypted_content"],
    },
  });
  assert.deepEqual(
    selected(
      model({
        id: "grok-4.6",
        modelID: "grok-4.6",
        providerID: "xai",
        package: XAI,
        variants: [missingSummary],
      }),
      missingSummary,
      high,
    ),
    { ok: false, code: "thinking-controls-unproven" },
  );

  const bodyOverride = variant("body", "high", {
    body: {
      temperature: 0.2,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high", summary: "auto" },
    },
  });
  const proof = recognizeVariantProof(
    model({ variants: [bodyOverride] }),
    bodyOverride,
  );
  assert.equal(proof?.transportKind, "native");
  assert.deepEqual(
    selected(model({ variants: [bodyOverride] }), bodyOverride, high).ok,
    true,
  );
});

test("controlled body overrides and malformed controls are not silently accepted", () => {
  const replacedInclude = variant("body-include", "high", {
    body: { include: [], reasoning: { effort: "high", summary: "auto" } },
  });
  assert.deepEqual(
    selected(model({ variants: [replacedInclude] }), replacedInclude, high),
    { ok: false, code: "thinking-controls-unproven" },
  );

  const unknownReasoningControl = variant("unknown", "high", {
    body: { reasoning: { effort: "high", summary: "auto", budget: 100 } },
  });
  assert.deepEqual(
    selected(
      model({ variants: [unknownReasoningControl] }),
      unknownReasoningControl,
      high,
    ),
    { ok: false, code: "thinking-controls-unproven" },
  );
});

test("an accessor identity is unresolved without invoking the getter", () => {
  let reads = 0;
  const modelInfo = model({ variants: [variant("v", "high")] });
  Object.defineProperty(modelInfo, "canonical", {
    get() {
      reads += 1;
      throw new Error("must not run");
    },
  });
  assert.deepEqual(selected(modelInfo, modelInfo.variants[0], high), {
    ok: false,
    code: "thinking-identity-unresolved",
  });
  assert.equal(reads, 0);
});

test("the exact 33-row fixture exhaustively verifies fixed levels and all ranges", () => {
  const rows = [
    ["openai", "gpt-5", ["minimal", "low", "medium", "high"]],
    ["openai", "gpt-5-mini", ["minimal", "low", "medium", "high"]],
    ["openai", "gpt-5-nano", ["minimal", "low", "medium", "high"]],
    ["openai", "gpt-5-pro", ["high"]],
    ["openai", "gpt-5.1", ["off", "low", "medium", "high"]],
    ["openai", "gpt-5.2", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.2-chat-latest", ["medium", "xhigh"]],
    ["openai", "gpt-5.2-pro", ["medium", "high", "xhigh"]],
    ["openai", "gpt-5.3-codex", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.3-codex-spark", ["low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.4", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.4-mini", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.4-nano", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.4-pro", ["medium", "high", "xhigh"]],
    ["openai", "gpt-5.5", ["off", "low", "medium", "high", "xhigh"]],
    ["openai", "gpt-5.5-pro", ["medium", "high", "xhigh"]],
    [
      "openai",
      "gpt-5.6-luna",
      ["off", "low", "medium", "high", "xhigh", "max"],
    ],
    ["openai", "gpt-5.6-sol", ["off", "low", "medium", "high", "xhigh", "max"]],
    [
      "openai",
      "gpt-5.6-terra",
      ["off", "low", "medium", "high", "xhigh", "max"],
    ],
    ["openai", "gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
    ["openai", "gpt-6-luna", ["off", "low", "medium", "high", "xhigh", "max"]],
    ["openai", "gpt-6-sol", ["off", "low", "medium", "high", "xhigh", "max"]],
    [
      "openai",
      "gpt-realtime-2.1",
      ["minimal", "low", "medium", "high", "xhigh"],
    ],
    ["openai", "o1", ["low", "medium", "high"]],
    ["openai", "o1-pro", ["low", "medium", "high"]],
    ["openai", "o3", ["low", "medium", "high"]],
    ["openai", "o3-mini", ["low", "medium", "high"]],
    ["openai", "o3-pro", ["low", "medium", "high"]],
    ["openai", "o4-mini", ["low", "medium", "high"]],
    ["xai", "grok-4.3", ["off", "low", "medium", "high"]],
    ["xai", "grok-4.5", ["low", "medium", "high"]],
    ["xai", "grok-4.6", ["low", "medium", "high", "xhigh"]],
    ["xai", "grok-4.7", ["low", "medium", "high", "xhigh"]],
  ];
  const canonical = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  // These advertised off recipes cannot omit the facade's inherited summary with valid overlays.
  const summaryBlockedOff = new Set([
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.5",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
  ]);
  const allExpected = new Map(
    rows.map(([provider, id, levels]) => [`${provider}/${id}`, levels]),
  );
  assert.equal(rows.filter(([provider]) => provider === "openai").length, 29);
  assert.equal(rows.filter(([provider]) => provider === "xai").length, 4);

  const info = (provider, id, variants = []) =>
    model({
      id,
      modelID: id,
      providerID: provider,
      package: provider === "openai" ? OPENAI : XAI,
      variants,
    });
  const candidate = (provider, level) => {
    if (level === "off") {
      return variant("off", "none", {
        settings: {
          reasoningEffort: "none",
          include: provider === "openai" ? [] : ["reasoning.encrypted_content"],
        },
      });
    }
    return variant(level, level);
  };
  const compatibleVariants = (provider, levels) =>
    levels.map((level) => candidate(provider, level));

  for (const [provider, id, advertised] of rows) {
    const input = info(provider, id);
    const sourceAdvertisement = admitResponsesVariant(input, {
      id: "uncontrolled",
      settings: { temperature: 0.3 },
    });
    assert.ok(
      ["matched", "unproven-controls"].includes(sourceAdvertisement.kind),
    );
    assert.deepEqual(
      sourceAdvertisement.advertisedLevels,
      advertised,
      `${provider}/${id} source levels independent of controls`,
    );
    for (const level of canonical) {
      const item = candidate(provider, level);
      const selection = selectThinkingVariant(
        input,
        { from: level, to: level },
        item,
      );
      if (
        level === "off" &&
        provider === "openai" &&
        summaryBlockedOff.has(id)
      ) {
        assert.deepEqual(
          selection,
          { ok: false, code: "thinking-controls-unproven" },
          `${provider}/${id}:${level} inherited summary`,
        );
      } else if (advertised.includes(level)) {
        assert.equal(selection.ok, true, `${provider}/${id}:${level}`);
        assert.deepEqual(
          selection.selection.compatibleLevels,
          [level],
          `${provider}/${id}:${level} compatible`,
        );
        assert.deepEqual(
          selection.selection.admittedLevels,
          [level],
          `${provider}/${id}:${level} admitted`,
        );
        assert.match(
          selection.selection.evidence,
          new RegExp(`${provider}/${id}`),
        );
      } else {
        assert.deepEqual(
          selection,
          { ok: false, code: "thinking-pi-level-unsupported" },
          `${provider}/${id}:${level}`,
        );
      }
    }

    const variants = compatibleVariants(provider, advertised);
    const withVariants = info(provider, id, variants);
    for (let from = 0; from < canonical.length; from += 1) {
      for (let to = from; to < canonical.length; to += 1) {
        const range = { from: canonical[from], to: canonical[to] };
        const selected = selectThinkingVariant(withVariants, range, undefined);
        const expected = [];
        for (const level of advertised) {
          if (
            level === "off" &&
            provider === "openai" &&
            summaryBlockedOff.has(id)
          )
            continue;
          const admitted = advertised.filter(
            (item) =>
              canonical.indexOf(item) >= from && canonical.indexOf(item) <= to,
          );
          if (admitted.includes(level)) {
            expected.push({
              variant: level,
              compatibleLevels: [level],
              admittedLevels: [level],
            });
          }
        }
        assert.equal(
          selected.ok,
          expected.length > 0,
          `${provider}/${id}:${range.from}..${range.to}`,
        );
        if (expected.length > 0) {
          assert.equal(selected.selection.kind, "options");
          assert.deepEqual(
            selected.selection.options.map(
              ({ variant: variantID, compatibleLevels, admittedLevels }) => ({
                variant: variantID,
                compatibleLevels,
                admittedLevels,
              }),
            ),
            expected,
            `${provider}/${id}:${range.from}..${range.to}`,
          );
        } else {
          assert.deepEqual(
            selected,
            {
              ok: false,
              code: advertised.some(
                (level) =>
                  canonical.indexOf(level) >= from &&
                  canonical.indexOf(level) <= to,
              )
                ? "thinking-unmapped"
                : "thinking-pi-level-unsupported",
            },
            `${provider}/${id}:${range.from}..${range.to}`,
          );
        }
      }
    }
  }
  assert.equal(allExpected.size, 33);
});

test("off recipes are source-gated and independent of native literal proof", () => {
  const openAIOff = variant("off", "none", {
    settings: { reasoningEffort: "none", include: [] },
  });
  const openAIModel = model({
    id: "gpt-6-luna",
    modelID: "gpt-6-luna",
    variants: [openAIOff],
  });
  const openAISelection = selected(openAIModel, openAIOff, {
    from: "off",
    to: "off",
  });
  assert.equal(openAISelection.ok, true);
  assert.deepEqual(openAISelection.selection.compatibleLevels, ["off"]);
  assert.equal(knownThinkingProof(openAIModel, openAIOff), undefined);

  const xaiOff = variant("off", "none", {
    settings: {
      reasoningEffort: "none",
      include: ["reasoning.encrypted_content"],
    },
  });
  const xaiModel = model({
    id: "grok-4.3",
    modelID: "grok-4.3",
    providerID: "xai",
    package: XAI,
    variants: [xaiOff],
  });
  const xaiSelection = selected(xaiModel, xaiOff, { from: "off", to: "off" });
  assert.equal(xaiSelection.ok, true);
  assert.deepEqual(xaiSelection.selection.compatibleLevels, ["off"]);

  const inheritedSummaryOff = variant("off", "none", {
    settings: { reasoningEffort: "none", include: [] },
  });
  const gpt5 = model({
    id: "gpt-5.4",
    modelID: "gpt-5.4",
    settings: { reasoningSummary: "auto" },
    variants: [inheritedSummaryOff],
  });
  assert.deepEqual(
    selected(gpt5, inheritedSummaryOff, { from: "off", to: "off" }),
    {
      ok: false,
      code: "thinking-controls-unproven",
    },
  );
});

test("undefined settings and body overlays preserve inherited controls", () => {
  const base = model({
    id: "gpt-6-luna",
    modelID: "gpt-6-luna",
    settings: {
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
    body: {
      temperature: 0.2,
      reasoning: { effort: "high", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    },
  });
  const overlay = variant("undefined-overrides", "high", {
    settings: {
      reasoningEffort: undefined,
      reasoningSummary: undefined,
      include: undefined,
    },
    body: {
      reasoning: { effort: undefined, summary: undefined },
      include: undefined,
    },
  });
  const result = selected({ ...base, variants: [overlay] }, overlay, high);
  assert.equal(result.ok, true);
  assert.deepEqual(result.selection.compatibleLevels, ["high"]);
  assert.equal(base.settings.reasoningEffort, "high");
  assert.equal(overlay.body.reasoning.effort, undefined);
});

test("logical projection tolerates unrelated body and header fields without reading header values", () => {
  let credentialRead = false;
  const headers = {};
  Object.defineProperty(headers, "authorization", {
    get() {
      credentialRead = true;
      throw new Error("must not be read");
    },
  });
  const positive = variant("non-thinking-metadata", "high", {
    headers,
    body: {
      temperature: 0.2,
      include: ["reasoning.encrypted_content", "code_interpreter_call.outputs"],
    },
  });
  const result = selected(model({ variants: [positive] }), positive, high);
  assert.equal(result.ok, true);
  assert.equal(credentialRead, false);
});

test("reasoningConfig cannot compete with either a positive or off recipe", () => {
  const info = model({ id: "gpt-6-luna", modelID: "gpt-6-luna" });
  for (const effort of ["high", "none"]) {
    for (const field of ["settings", "body"]) {
      const item = variant(
        "bound",
        effort,
        effort === "none"
          ? {
              settings: { reasoningEffort: "none", include: [] },
            }
          : {},
      );
      item[field] = { ...item[field], reasoningConfig: { effort: "high" } };
      assert.deepEqual(
        selected(
          info,
          item,
          effort === "none" ? { from: "off", to: "off" } : high,
        ),
        { ok: false, code: "thinking-controls-unproven" },
      );
    }
  }
});

test("the OpenAI facade defaults are included even when omitted from declared metadata", () => {
  const effortOnly = { id: "high", settings: { reasoningEffort: "high" } };
  assert.equal(selected(model(), effortOnly, high).ok, true);
  const off = { id: "off", settings: { reasoningEffort: "none", include: [] } };
  const gpt51 = model({ id: "gpt-5.1", modelID: "gpt-5.1", variants: [off] });
  assert.deepEqual(selected(gpt51, off, { from: "off", to: "off" }), {
    ok: false,
    code: "thinking-controls-unproven",
  });
  assert.deepEqual(
    selectThinkingVariant(gpt51, { from: "off", to: "minimal" }, undefined),
    { ok: false, code: "thinking-unmapped" },
  );
  for (const id of ["gpt-5-pro", "gpt-6-luna"]) {
    assert.deepEqual(selected(model({ id, modelID: id }), effortOnly, high), {
      ok: false,
      code: "thinking-controls-unproven",
    });
  }
  const xai = model({
    id: "grok-4.3",
    modelID: "grok-4.3",
    providerID: "xai",
    package: XAI,
  });
  assert.deepEqual(selected(xai, effortOnly, high), {
    ok: false,
    code: "thinking-controls-unproven",
  });
});

test("unset leaves an opaque or unresolved provider variant unchanged", () => {
  const opaque = {
    id: "provider-owned",
    settings: { thinking: { type: "enabled" } },
  };
  assert.deepEqual(
    selectThinkingVariant(model({ variants: [opaque] }), undefined, opaque),
    {
      ok: true,
      selection: { kind: "unset" },
    },
  );
});

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
const META_RESPONSES = "@opencode/ai/providers/meta/responses";

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

test("Meta Responses admits exact Pi catalogue rows and mapped fixed levels", () => {
  const rows = [
    ["muse-spark-1.1", ["minimal", "low", "medium", "high", "xhigh"]],
    ["muse-spark-1.2", ["minimal", "low", "medium", "high", "xhigh"]],
    [
      "muse-spark-1.2-contributor",
      ["minimal", "low", "medium", "high", "xhigh"],
    ],
    ["muse-spark-1.3", ["minimal", "low", "medium", "high", "xhigh", "max"]],
    [
      "muse-spark-1.3-contributor",
      ["minimal", "low", "medium", "high", "xhigh"],
    ],
  ];
  const canonical = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const metaModel = (id, overrides = {}) =>
    model({
      id,
      modelID: id,
      providerID: "meta",
      package: META_RESPONSES,
      ...overrides,
    });
  const candidate = (level) =>
    variant(level, level, {
      settings: {
        reasoningEffort: level,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    });

  assert.equal(rows.length, 5);
  assert.equal(
    rows.reduce((count, [, levels]) => count + levels.length, 0),
    26,
  );
  for (const [id, advertised] of rows) {
    const input = metaModel(id);
    const observed = admitResponsesVariant(input, {
      id: "uncontrolled",
      settings: { temperature: 0.3 },
    });
    assert.equal(observed.kind, "unproven-controls");
    assert.deepEqual(
      observed.advertisedLevels,
      advertised,
      `${id} advertisements`,
    );
    assert.deepEqual(
      observed.unsupportedLevels,
      canonical.filter((level) => !advertised.includes(level)),
      `${id} unsupported levels`,
    );

    for (const level of canonical) {
      const item = candidate(level);
      const result = selected(metaModel(id, { variants: [item] }), item, {
        from: level,
        to: level,
      });
      if (advertised.includes(level)) {
        assert.equal(result.ok, true, `${id}:${level}`);
        assert.deepEqual(result.selection.compatibleLevels, [level]);
        assert.deepEqual(result.selection.admittedLevels, [level]);
        assert.equal(result.selection.variant, level);
        assert.match(result.selection.evidence, /providers\/data\/meta\.json/);
        assert.match(
          result.selection.evidence,
          /providers\/meta\/responses\.ts/,
        );
        assert.match(result.selection.evidence, /conditional, not final wire/);
      } else {
        assert.deepEqual(
          result,
          { ok: false, code: "thinking-pi-level-unsupported" },
          `${id}:${level}`,
        );
      }
    }
  }
});

test("Meta Responses checks all 28 inclusive ranges without choosing or falling back", () => {
  const rows = [
    ["muse-spark-1.1", ["minimal", "low", "medium", "high", "xhigh"]],
    ["muse-spark-1.2", ["minimal", "low", "medium", "high", "xhigh"]],
    [
      "muse-spark-1.2-contributor",
      ["minimal", "low", "medium", "high", "xhigh"],
    ],
    ["muse-spark-1.3", ["minimal", "low", "medium", "high", "xhigh", "max"]],
    [
      "muse-spark-1.3-contributor",
      ["minimal", "low", "medium", "high", "xhigh"],
    ],
  ];
  const canonical = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const metaModel = (id, variants = []) =>
    model({
      id,
      modelID: id,
      providerID: "meta",
      package: META_RESPONSES,
      variants,
    });
  const variantsFor = (levels) =>
    levels.map((level) =>
      variant(level, level, {
        settings: {
          reasoningEffort: level,
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      }),
    );

  for (const [id, advertised] of rows) {
    const input = metaModel(id, variantsFor(advertised));
    for (let from = 0; from < canonical.length; from += 1) {
      for (let to = from; to < canonical.length; to += 1) {
        const result = selectThinkingVariant(
          input,
          { from: canonical[from], to: canonical[to] },
          undefined,
        );
        const expected = advertised
          .filter(
            (level) =>
              canonical.indexOf(level) >= from &&
              canonical.indexOf(level) <= to,
          )
          .map((level) => ({
            variant: level,
            compatibleLevels: [level],
            admittedLevels: [level],
          }));
        assert.equal(
          result.ok,
          expected.length > 0,
          `${id}:${canonical[from]}..${canonical[to]}`,
        );
        if (expected.length > 0) {
          assert.equal(result.selection.kind, "options");
          assert.deepEqual(
            result.selection.options.map(
              ({ variant: variantID, compatibleLevels, admittedLevels }) => ({
                variant: variantID,
                compatibleLevels,
                admittedLevels,
              }),
            ),
            expected,
          );
        } else {
          assert.deepEqual(result, {
            ok: false,
            code: "thinking-pi-level-unsupported",
          });
        }
      }
    }
  }
});

test("Meta Responses requires its summary recipe and exact declared route identity", () => {
  const meta = model({
    id: "muse-spark-1.3",
    modelID: "muse-spark-1.3",
    providerID: "meta",
    canonical: "meta",
    package: META_RESPONSES,
  });
  const missingSummary = variant("high", "high", {
    settings: {
      reasoningEffort: "high",
      include: ["reasoning.encrypted_content"],
    },
  });
  assert.deepEqual(selected(meta, missingSummary, high), {
    ok: false,
    code: "thinking-controls-unproven",
  });

  const valid = variant("high", "high", {
    settings: {
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  });
  for (const altered of [
    { ...meta, canonical: "openai" },
    { ...meta, package: "@opencode/ai/providers/meta" },
    { ...meta, providerID: "openai" },
  ]) {
    assert.deepEqual(selected(altered, valid, high), {
      ok: false,
      code: "thinking-identity-unresolved",
    });
  }

  assert.equal(admitResponsesVariant(meta, valid).kind, "matched");
  assert.equal(
    admitResponsesVariant({ ...meta, id: "muse-spark-1.3-contributor" }, valid)
      .kind,
    "matched",
    "modelID is the effective route id when present",
  );
  assert.equal(
    admitResponsesVariant(
      { ...meta, id: "muse-spark-1.3", modelID: undefined },
      valid,
    ).kind,
    "matched",
    "id is used when modelID is absent",
  );
});

test("Meta Responses reads declared identity without getters or credential headers", () => {
  let identityReads = 0;
  let credentialReads = 0;
  const modelInfo = model({
    id: "muse-spark-1.3",
    modelID: "muse-spark-1.3",
    providerID: "meta",
    package: META_RESPONSES,
  });
  Object.defineProperty(modelInfo, "canonical", {
    get() {
      identityReads += 1;
      throw new Error("must not run");
    },
  });
  const headers = {};
  Object.defineProperty(headers, "authorization", {
    get() {
      credentialReads += 1;
      throw new Error("must not run");
    },
  });
  const item = variant("high", "high", {
    headers,
    settings: {
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  });
  const originalSettings = { ...item.settings };

  assert.deepEqual(admitResponsesVariant(modelInfo, item), {
    kind: "unresolved",
  });
  assert.equal(identityReads, 0);

  const positiveModel = model({
    id: "muse-spark-1.3",
    modelID: "muse-spark-1.3",
    providerID: "meta",
    package: META_RESPONSES,
  });
  const result = selected(positiveModel, item, high);
  assert.equal(result.ok, true);
  assert.equal(credentialReads, 0);
  assert.deepEqual(item.settings, originalSettings);
  assert.deepEqual(item.body, undefined);
});

const OPENCODE_GENERIC = "@opencode/ai/providers/openai-compatible-responses";
const OPENCODE_FACADE_ALIAS = "@opencode/ai/providers/openai/responses";
const OPENCODE_ROWS = [
  ["opencode", "gpt-5", ["minimal", "low", "medium", "high"]],
  ["opencode", "gpt-5-codex", ["low", "medium", "high"]],
  ["opencode", "gpt-5-nano", ["minimal", "low", "medium", "high"]],
  ["opencode", "gpt-5.1", ["low", "medium", "high"]],
  ["opencode", "gpt-5.1-codex", ["low", "medium", "high"]],
  ["opencode", "gpt-5.1-codex-max", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.1-codex-mini", ["low", "medium", "high"]],
  ["opencode", "gpt-5.2", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.2-codex", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.3-codex", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.4", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.4-mini", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.4-nano", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.4-pro", ["medium", "high", "xhigh"]],
  ["opencode", "gpt-5.5", ["low", "medium", "high", "xhigh"]],
  ["opencode", "gpt-5.5-pro", ["medium", "high", "xhigh"]],
  ["opencode", "gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
  ["opencode", "gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]],
  ["opencode", "gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max"]],
  ["opencode", "gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
  ["opencode", "gpt-6-luna", ["off", "low", "medium", "high", "xhigh", "max"]],
  ["opencode", "gpt-6-sol", ["off", "low", "medium", "high", "xhigh", "max"]],
  ["opencode", "grok-4.5", ["low", "medium", "high"]],
  ["opencode", "grok-4.6", ["low", "medium", "high", "xhigh"]],
  ["opencode", "grok-build-0.1", ["high"]],
  ["opencode", "muse-spark-1.2", ["minimal", "low", "medium", "high", "xhigh"]],
  [
    "opencode",
    "muse-spark-1.2-contributor-free",
    ["minimal", "low", "medium", "high", "xhigh"],
  ],
  ["opencode", "muse-spark-1.3", ["minimal", "low", "medium", "high", "xhigh"]],
  [
    "opencode",
    "muse-spark-1.3-contributor-free",
    ["minimal", "low", "medium", "high", "xhigh"],
  ],
  ["opencode-go", "gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
  ["opencode-go", "grok-4.6", ["low", "medium", "high", "xhigh"]],
  ["opencode-go", "grok-4.7", ["low", "medium", "high", "xhigh"]],
  [
    "opencode-go",
    "muse-spark-1.2-contributor",
    ["minimal", "low", "medium", "high", "xhigh"],
  ],
  [
    "opencode-go",
    "muse-spark-1.3-contributor",
    ["minimal", "low", "medium", "high", "xhigh"],
  ],
];
const RESPONSES_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const OPENCODE_OFF_MODELS = new Set(["gpt-6-luna", "gpt-6-sol"]);

function opencodeModel(providerID, modelID, packageName, overrides = {}) {
  return model({
    id: modelID,
    modelID,
    providerID,
    canonical: providerID,
    package: packageName,
    variants: [],
    ...overrides,
  });
}

function opencodeCandidate(level, packageName) {
  const baseURL =
    packageName === OPENCODE_GENERIC ? "declared-but-not-verified" : undefined;
  if (level === "off") {
    return variant("off", "none", {
      settings: {
        reasoningEffort: "none",
        include: [],
        ...(baseURL === undefined ? {} : { baseURL }),
      },
    });
  }
  return variant(level, level, {
    settings: {
      reasoningEffort: level,
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
      ...(baseURL === undefined ? {} : { baseURL }),
    },
  });
}

test("the exact 34 OpenCode and OpenCode Go source rows admit translated fixed levels and ranges", () => {
  assert.equal(OPENCODE_ROWS.length, 34);
  assert.equal(
    OPENCODE_ROWS.filter(([provider]) => provider === "opencode").length,
    29,
  );
  assert.equal(
    OPENCODE_ROWS.filter(([provider]) => provider === "opencode-go").length,
    5,
  );

  for (const route of [
    { packageName: "@opencode/ai/providers/openai", name: "OpenAI facade" },
    { packageName: OPENCODE_FACADE_ALIAS, name: "Responses facade alias" },
    { packageName: OPENCODE_GENERIC, name: "generic Responses" },
  ]) {
    for (const [providerID, id, advertised] of OPENCODE_ROWS) {
      const modelSettings =
        route.packageName === OPENCODE_GENERIC
          ? { baseURL: "declared-but-not-verified" }
          : undefined;
      const modelInfo = opencodeModel(providerID, id, route.packageName, {
        settings: modelSettings,
      });
      const source = admitResponsesVariant(modelInfo, {
        id: "uncontrolled",
        settings: { temperature: 0.3 },
      });
      assert.ok(
        ["matched", "unproven-controls"].includes(source.kind),
        `${route.name} ${providerID}/${id}`,
      );
      assert.deepEqual(
        source.advertisedLevels,
        advertised,
        `${route.name} ${providerID}/${id} source levels`,
      );

      for (const level of RESPONSES_LEVELS) {
        const candidate = opencodeCandidate(level, route.packageName);
        const result = selected(modelInfo, candidate, {
          from: level,
          to: level,
        });
        const expected =
          advertised.includes(level) &&
          (level !== "off" ||
            (providerID === "opencode" && OPENCODE_OFF_MODELS.has(id)));
        assert.equal(
          result.ok,
          expected,
          `${route.name} ${providerID}/${id}:${level}`,
        );
        if (expected) {
          assert.deepEqual(result.selection.compatibleLevels, [level]);
          assert.deepEqual(result.selection.admittedLevels, [level]);
          assert.match(
            result.selection.evidence,
            /providers\/data\/opencode(-go)?\.json/,
          );
          assert.match(
            result.selection.evidence,
            new RegExp(`${providerID}/${id}`),
          );
        }
      }

      const variants = advertised.map((level) =>
        opencodeCandidate(level, route.packageName),
      );
      const withVariants = { ...modelInfo, variants };
      for (let from = 0; from < RESPONSES_LEVELS.length; from += 1) {
        for (let to = from; to < RESPONSES_LEVELS.length; to += 1) {
          const range = {
            from: RESPONSES_LEVELS[from],
            to: RESPONSES_LEVELS[to],
          };
          const result = selectThinkingVariant(withVariants, range, undefined);
          const expected = advertised
            .filter((level) => {
              const position = RESPONSES_LEVELS.indexOf(level);
              return (
                position >= from &&
                position <= to &&
                (level !== "off" ||
                  (providerID === "opencode" && OPENCODE_OFF_MODELS.has(id)))
              );
            })
            .map((level) => ({
              variant: level,
              compatibleLevels: [level],
              admittedLevels: [level],
            }));
          assert.equal(
            result.ok,
            expected.length > 0,
            `${route.name} ${providerID}/${id}:${range.from}..${range.to}`,
          );
          if (expected.length > 0) {
            assert.equal(result.selection.kind, "options");
            assert.deepEqual(
              result.selection.options.map(
                ({ variant: variantID, compatibleLevels, admittedLevels }) => ({
                  variant: variantID,
                  compatibleLevels,
                  admittedLevels,
                }),
              ),
              expected,
            );
          }
        }
      }
    }
  }
});

test("declared OpenCode identity uses exact provider and effective model IDs", () => {
  const highVariant = opencodeCandidate(
    "high",
    "@opencode/ai/providers/openai",
  );
  assert.equal(
    selected(
      opencodeModel("opencode", "gpt-6-luna", "@opencode/ai/providers/openai", {
        canonical: undefined,
      }),
      highVariant,
      high,
    ).ok,
    true,
  );
  for (const [providerID, modelID] of [
    ["opencode", "gpt-6-luna"],
    ["opencode-go", "gpt-5.6-luna"],
  ]) {
    const modelInfo = opencodeModel(
      providerID,
      modelID,
      "@opencode/ai/providers/openai",
      { id: `alias-${modelID}`, modelID },
    );
    assert.equal(selected(modelInfo, highVariant, high).ok, true);
  }
  assert.deepEqual(
    selected(
      opencodeModel(
        "opencode-go",
        "gpt-5.6-luna",
        "@opencode/ai/providers/openai",
      ),
      highVariant,
      high,
    ).selection.compatibleLevels,
    ["high"],
  );
  for (const altered of [
    { providerID: "opencode", canonical: "opencode-go" },
    { providerID: "opencode-go", canonical: "custom" },
    { providerID: "unknown-provider" },
    { package: "@opencode/ai/providers/openai-compatible" },
    { package: "@opencode/ai/providers/openai-compatible-chat" },
    { package: "custom/responses" },
    { modelID: "gpt-6-luna-alias" },
  ]) {
    const input = opencodeModel(
      "opencode",
      "gpt-6-luna",
      "@opencode/ai/providers/openai",
      altered,
    );
    assert.deepEqual(selected(input, highVariant, high), {
      ok: false,
      code: "thinking-identity-unresolved",
    });
  }
});

test("generic Responses requires declared baseURL and explicit facade-equivalent controls", () => {
  const effortOnly = { id: "high", settings: { reasoningEffort: "high" } };
  const generic = opencodeModel("opencode", "gpt-5.6-luna", OPENCODE_GENERIC, {
    settings: { baseURL: "declared" },
  });
  assert.deepEqual(selected(generic, effortOnly, high), {
    ok: false,
    code: "thinking-controls-unproven",
  });
  const inheritedInclude = variant("high", "high", {
    settings: {
      reasoningEffort: "high",
      reasoningSummary: "auto",
    },
  });
  assert.equal(selected(generic, inheritedInclude, high).ok, true);
  const explicit = opencodeCandidate("high", OPENCODE_GENERIC);
  assert.equal(selected(generic, explicit, high).ok, true);
  const missingSummary = variant("high", "high", {
    settings: {
      reasoningEffort: "high",
      include: ["reasoning.encrypted_content"],
    },
  });
  assert.deepEqual(selected(generic, missingSummary, high), {
    ok: false,
    code: "thinking-controls-unproven",
  });
  const explicitWithoutURL = variant("high", "high", {
    settings: {
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  });

  for (const settings of [
    undefined,
    {},
    { baseURL: undefined },
    { baseURL: 42 },
    { baseURL: null },
  ]) {
    const missing = opencodeModel(
      "opencode",
      "gpt-5.6-luna",
      OPENCODE_GENERIC,
      {
        settings,
      },
    );
    assert.equal(
      admitResponsesVariant(missing, explicitWithoutURL).kind,
      "construction-unproven",
    );
    assert.deepEqual(selected(missing, explicitWithoutURL, high), {
      ok: false,
      code: "thinking-construction-unproven",
    });
  }
  const overlaidURL = {
    ...explicit,
    settings: { ...explicit.settings, baseURL: "variant-declared" },
  };
  assert.equal(
    admitResponsesVariant(
      opencodeModel("opencode", "gpt-5.6-luna", OPENCODE_GENERIC),
      overlaidURL,
    ).kind,
    "matched",
  );
  assert.equal(
    admitResponsesVariant(generic, {
      ...overlaidURL,
      settings: { ...overlaidURL.settings, baseURL: undefined },
    }).kind,
    "matched",
    "undefined in a variant overlay preserves the model's declared baseURL",
  );
  const accessor = {};
  let baseURLReads = 0;
  Object.defineProperty(accessor, "baseURL", {
    get() {
      baseURLReads += 1;
      throw new Error("must not run");
    },
  });
  const accessorModel = opencodeModel(
    "opencode",
    "gpt-5.6-luna",
    OPENCODE_GENERIC,
    {
      settings: accessor,
    },
  );
  assert.equal(
    admitResponsesVariant(accessorModel, explicitWithoutURL).kind,
    "construction-unproven",
  );
  assert.equal(baseURLReads, 0);

  const missingVariantURL = {
    ...generic,
    settings: undefined,
  };
  assert.equal(
    admitResponsesVariant(missingVariantURL, explicitWithoutURL).kind,
    "construction-unproven",
  );
  const variantURLAccessor = {};
  let variantURLReads = 0;
  Object.defineProperty(variantURLAccessor, "baseURL", {
    get() {
      variantURLReads += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(
    admitResponsesVariant(generic, {
      ...explicitWithoutURL,
      settings: variantURLAccessor,
    }).kind,
    "construction-unproven",
  );
  assert.equal(variantURLReads, 0);
});

test("malformed proxies fail with fixed unresolved results without coercion", () => {
  const highVariant = opencodeCandidate(
    "high",
    "@opencode/ai/providers/openai",
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(admitResponsesVariant(revoked.proxy, highVariant), {
    kind: "unresolved",
  });

  let packageCoercions = 0;
  const malformedPackage = {
    ...opencodeModel("opencode", "gpt-6-luna", "@opencode/ai/providers/openai"),
    package: {
      toString() {
        packageCoercions += 1;
        throw new Error("must not run");
      },
    },
  };
  assert.deepEqual(admitResponsesVariant(malformedPackage, highVariant), {
    kind: "unresolved",
  });
  assert.equal(packageCoercions, 0);

  const throwingProxy = new Proxy(
    opencodeModel("opencode", "gpt-6-luna", "@opencode/ai/providers/openai"),
    {
      getOwnPropertyDescriptor() {
        throw new Error("raw trap detail");
      },
    },
  );
  assert.deepEqual(admitResponsesVariant(throwingProxy, highVariant), {
    kind: "unresolved",
  });
});

test("facade identity controls defaults, off recipes, and known factory routes", () => {
  const gpt56 = opencodeModel(
    "opencode",
    "gpt-5.6-luna",
    "@opencode/ai/providers/openai",
  );
  const effortOnly = { id: "high", settings: { reasoningEffort: "high" } };
  assert.equal(selected(gpt56, effortOnly, high).ok, true);
  const aliasModel = opencodeModel(
    "opencode",
    "gpt-5.6-luna",
    OPENCODE_FACADE_ALIAS,
  );
  assert.equal(selected(aliasModel, effortOnly, high).ok, true);
  const pro = opencodeModel(
    "opencode",
    "gpt-5.4-pro",
    "@opencode/ai/providers/openai",
  );
  assert.equal(selected(pro, effortOnly, high).ok, true);

  for (const id of ["gpt-6-luna", "gpt-6-sol"]) {
    const off = opencodeCandidate("off", "@opencode/ai/providers/openai");
    assert.equal(
      selected(
        opencodeModel("opencode", id, "@opencode/ai/providers/openai"),
        off,
        { from: "off", to: "off" },
      ).ok,
      true,
    );
  }
  for (const id of ["gpt-6-luna", "gpt-6-sol"]) {
    const genericModel = opencodeModel("opencode", id, OPENCODE_GENERIC, {
      settings: { baseURL: "declared" },
    });
    const genericOff = opencodeCandidate("off", OPENCODE_GENERIC);
    assert.deepEqual(
      selected(genericModel, genericOff, { from: "off", to: "off" }).ok,
      true,
    );
    assert.deepEqual(
      selected(genericModel, variant("off-default-include", "none"), {
        from: "off",
        to: "off",
      }),
      { ok: false, code: "thinking-controls-unproven" },
    );
    const bodyIncludeEmpty = {
      ...genericOff,
      body: { include: [] },
    };
    assert.deepEqual(
      selected(genericModel, bodyIncludeEmpty, { from: "off", to: "off" }),
      { ok: false, code: "thinking-controls-unproven" },
    );
  }

  for (const packageName of [
    "@opencode/ai/providers/openai-compatible",
    "@opencode/ai/providers/openai-compatible-chat",
    "@opencode/ai/providers/openai-compatible-responses/chat",
  ]) {
    const unsupported = opencodeModel("opencode", "gpt-6-luna", packageName);
    assert.deepEqual(selected(unsupported, effortOnly, high), {
      ok: false,
      code: "thinking-identity-unresolved",
    });
  }
});

const CLOUDFLARE = "@opencode/ai/providers/cloudflare-ai-gateway";
const CLOUDFLARE_ROWS = [
  ["gpt-5", ["minimal", "low", "medium", "high"]],
  ["gpt-5-mini", ["minimal", "low", "medium", "high"]],
  ["gpt-5-nano", ["minimal", "low", "medium", "high"]],
  ["gpt-5.1", ["low", "medium", "high"]],
  ["gpt-5.4", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.4-mini", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.4-nano", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.4-pro", ["medium", "high", "xhigh"]],
  ["gpt-5.5", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.5-pro", ["medium", "high", "xhigh"]],
  ["gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-6-astra", ["low", "medium", "high", "xhigh", "max"]],
  ["o3", ["low", "medium", "high"]],
  ["o3-mini", ["low", "medium", "high"]],
  ["o4-mini", ["low", "medium", "high"]],
];
const CLOUDFLARE_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function cloudflareModel(id, overrides = {}) {
  return model({
    id: `openai/${id}`,
    modelID: `openai/${id}`,
    providerID: "cloudflare-ai-gateway",
    canonical: "cloudflare-ai-gateway",
    package: CLOUDFLARE,
    settings: { accountId: "synthetic-account" },
    ...overrides,
  });
}

function cloudflareCandidate(level) {
  return variant(level, level, {
    settings: {
      reasoningEffort: level,
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    },
  });
}

test("the exact 17 Cloudflare Responses rows verify 119 fixed levels and 476 inclusive ranges", () => {
  assert.equal(CLOUDFLARE_ROWS.length, 17);
  for (const [id, advertised] of CLOUDFLARE_ROWS) {
    const input = cloudflareModel(id);
    const observed = admitResponsesVariant(input, {
      id: "uncontrolled",
      settings: { temperature: 0.3 },
    });
    assert.equal(observed.kind, "unproven-controls", id);
    assert.deepEqual(observed.advertisedLevels, advertised, `${id} advertised`);
    assert.deepEqual(
      observed.unsupportedLevels,
      CLOUDFLARE_LEVELS.filter((level) => !advertised.includes(level)),
      `${id} unsupported`,
    );
    assert.ok(!advertised.includes("off"), `${id} does not advertise off`);

    for (const level of CLOUDFLARE_LEVELS) {
      const candidate = cloudflareCandidate(level);
      const result = selected(input, candidate, { from: level, to: level });
      assert.equal(result.ok, advertised.includes(level), `${id}:${level}`);
      if (advertised.includes(level)) {
        assert.deepEqual(result.selection.compatibleLevels, [level]);
        assert.deepEqual(result.selection.admittedLevels, [level]);
        assert.equal(result.selection.variant, level);
        assert.match(
          result.selection.evidence,
          /cloudflare-ai-gateway\.json cloudflare-ai-gateway\//,
        );
        assert.match(result.selection.evidence, /conditional, not final wire/);
      } else {
        assert.deepEqual(result, {
          ok: false,
          code: "thinking-pi-level-unsupported",
        });
      }
    }

    const variants = advertised.map(cloudflareCandidate);
    const withVariants = { ...input, variants };
    for (let from = 0; from < CLOUDFLARE_LEVELS.length; from += 1) {
      for (let to = from; to < CLOUDFLARE_LEVELS.length; to += 1) {
        const range = {
          from: CLOUDFLARE_LEVELS[from],
          to: CLOUDFLARE_LEVELS[to],
        };
        const result = selectThinkingVariant(withVariants, range, undefined);
        const expected = advertised
          .filter((level) => {
            const position = CLOUDFLARE_LEVELS.indexOf(level);
            return position >= from && position <= to;
          })
          .map((level) => ({
            variant: level,
            compatibleLevels: [level],
            admittedLevels: [level],
          }));
        assert.equal(
          result.ok,
          expected.length > 0,
          `${id}:${range.from}..${range.to}`,
        );
        if (expected.length > 0) {
          assert.equal(result.selection.kind, "options");
          assert.deepEqual(
            result.selection.options.map(
              ({ variant: variantID, compatibleLevels, admittedLevels }) => ({
                variant: variantID,
                compatibleLevels,
                admittedLevels,
              }),
            ),
            expected,
            `${id}:${range.from}..${range.to}`,
          );
        } else {
          assert.deepEqual(result, {
            ok: false,
            code: "thinking-pi-level-unsupported",
          });
        }
      }
    }
  }
});

test("Cloudflare requires the exact native route prefix, exact catalogue ID, and source package", () => {
  const candidate = cloudflareCandidate("high");
  const source = cloudflareModel("gpt-5.6-luna");
  const positive = selected(source, candidate, high);
  assert.equal(positive.ok, true);
  assert.equal(positive.selection.variant, "high");
  assert.deepEqual(positive.selection.compatibleLevels, ["high"]);
  assert.deepEqual(
    admitResponsesVariant(source, candidate).proof.transportKind,
    "native",
  );
  assert.deepEqual(source.id, "openai/gpt-5.6-luna");
  assert.deepEqual(source.modelID, "openai/gpt-5.6-luna");

  for (const altered of [
    { id: "gpt-5.6-luna", modelID: "gpt-5.6-luna" },
    { id: "openai/gpt-5.6-luna", modelID: "gpt-5.6-luna" },
    { id: "openai/gpt-5.6-luna", modelID: "openai/unknown-model" },
    { id: "openai/gpt-5.6-luna", modelID: "openai/openai/gpt-5.6-luna" },
    { id: "openai/gpt-5.6-luna", modelID: "openai/" },
    { id: "openai/gpt-5.6-luna", modelID: "openai/gpt-5.6-luna-alias" },
    { providerID: "openai" },
    { package: "@opencode/ai/providers/openai" },
    { canonical: "openai" },
  ]) {
    assert.deepEqual(
      selected(cloudflareModel("gpt-5.6-luna", altered), candidate, high),
      { ok: false, code: "thinking-identity-unresolved" },
    );
  }

  for (const baseURL of [
    "https://gateway.ai.cloudflare.com/native-looking",
    "",
    42,
    null,
  ]) {
    const configured = cloudflareModel("gpt-5.6-luna", {
      settings: { accountId: "synthetic-account", baseURL },
    });
    assert.deepEqual(selected(configured, candidate, high), {
      ok: false,
      code: "thinking-identity-unresolved",
    });
  }
  const configuredVariant = {
    ...candidate,
    settings: { ...candidate.settings, baseURL: "https://custom.invalid" },
  };
  assert.deepEqual(selected(source, configuredVariant, high), {
    ok: false,
    code: "thinking-identity-unresolved",
  });
  const undefinedOverlay = {
    ...candidate,
    settings: { ...candidate.settings, baseURL: undefined },
  };
  assert.equal(selected(source, undefinedOverlay, high).ok, true);
});

test("Cloudflare native construction requires a readable non-empty declared account ID", () => {
  const candidate = cloudflareCandidate("high");
  const noAccount = cloudflareModel("gpt-5.6-luna", { settings: {} });
  assert.deepEqual(selected(noAccount, candidate, high), {
    ok: false,
    code: "thinking-construction-unproven",
  });
  for (const accountId of ["", 42, null]) {
    const invalid = cloudflareModel("gpt-5.6-luna", {
      settings: { accountId },
    });
    assert.deepEqual(selected(invalid, candidate, high), {
      ok: false,
      code: "thinking-construction-unproven",
    });
  }
  const inherited = cloudflareModel("gpt-5.6-luna", {
    settings: { accountId: "synthetic-account" },
  });
  const undefinedOverlay = {
    ...candidate,
    settings: { ...candidate.settings, accountId: undefined },
  };
  assert.equal(selected(inherited, undefinedOverlay, high).ok, true);
  const variantAccount = {
    ...candidate,
    settings: { ...candidate.settings, accountId: "synthetic-variant-account" },
  };
  assert.equal(
    selected(
      cloudflareModel("gpt-5.6-luna", { settings: {} }),
      variantAccount,
      high,
    ).ok,
    true,
  );

  let accountReads = 0;
  const secretLikeSettings = {};
  Object.defineProperty(secretLikeSettings, "accountId", {
    get() {
      accountReads += 1;
      throw new Error("must not run");
    },
  });
  assert.deepEqual(
    selected(
      cloudflareModel("gpt-5.6-luna", { settings: secretLikeSettings }),
      candidate,
      high,
    ),
    { ok: false, code: "thinking-construction-unproven" },
  );
  assert.equal(accountReads, 0);
});

test("Cloudflare does not infer facade defaults or source-model support for an unprefixed reference", () => {
  const input = cloudflareModel("gpt-5.6-luna");
  const effortOnly = { id: "high", settings: { reasoningEffort: "high" } };
  assert.deepEqual(selected(input, effortOnly, high), {
    ok: false,
    code: "thinking-controls-unproven",
  });
  const off = variant("off", "none", {
    settings: { reasoningEffort: "none", include: [] },
  });
  assert.deepEqual(selected(input, off, { from: "off", to: "off" }), {
    ok: false,
    code: "thinking-pi-level-unsupported",
  });
  assert.deepEqual(
    selected(
      cloudflareModel("gpt-5.6-luna", {
        id: "gpt-5.6-luna",
        modelID: "gpt-5.6-luna",
        settings: { accountId: "synthetic-account", baseURL: "custom" },
      }),
      cloudflareCandidate("high"),
      high,
    ),
    { ok: false, code: "thinking-identity-unresolved" },
  );
});

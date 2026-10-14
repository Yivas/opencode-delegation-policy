import type {
  ThinkingLevel,
  ThinkingModel,
  ThinkingVariant,
} from "./policies.js";
import type { ContractProof } from "./protocols.js";

const ENCRYPTED_REASONING = "reasoning.encrypted_content";
const PACKAGE_BY_PROVIDER = Object.freeze({
  openai: "@opencode/ai/providers/openai",
  xai: "@opencode/ai/providers/xai",
  meta: "@opencode/ai/providers/meta/responses",
});

// The table is a source-owned snapshot of Pi AI 0.87.1's OpenAI Responses, xAI and Meta
// catalogue rows. Null means Pi does not advertise that level for the exact model.
const LEVEL_MAPS: Readonly<
  Record<string, Readonly<Record<string, string | null>>>
> = Object.freeze({
  "openai/gpt-5": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5-mini": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5-nano": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5-pro": {
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5.1": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5.2": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.2-chat-latest": {
    minimal: null,
    low: null,
    medium: "medium",
    high: null,
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.2-pro": {
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.3-codex": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.3-codex-spark": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4-mini": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4-nano": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4-pro": {
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.5": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.5-pro": {
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.6-luna": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-5.6-sol": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-5.6-terra": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-6-astra": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-6-luna": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-6-sol": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-realtime-2.1": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/o1": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o1-pro": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o3": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o3-mini": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o3-pro": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o4-mini": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "xai/grok-4.3": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "xai/grok-4.5": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "xai/grok-4.6": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "xai/grok-4.7": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.1": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.2": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.2-contributor": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.3": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "meta/muse-spark-1.3-contributor": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
});

for (const row of Object.values(LEVEL_MAPS)) {
  if (!Object.hasOwn(row, "off")) {
    Object.defineProperty(row, "off", {
      value: null,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  Object.freeze(row);
}

export type ResponsesAdmission =
  | { readonly kind: "outside-scope" }
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "matched";
      readonly advertisedLevels: readonly ThinkingLevel[];
      readonly compatibleLevels: readonly ThinkingLevel[];
      readonly unsupportedLevels: readonly ThinkingLevel[];
      readonly proof: ContractProof;
    }
  | {
      readonly kind: "unproven-controls";
      readonly advertisedLevels: readonly ThinkingLevel[];
      readonly unsupportedLevels: readonly ThinkingLevel[];
    };

const CANONICAL_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const RESPONSES_EVIDENCE =
  "opencode@8a8bd622 packages/ai/src/protocols/utils/open-responses-options.ts";
const PI_OPENAI = "pi-ai@0.87.1 providers/data/openai.json";
const PI_XAI = "pi-ai@0.87.1 providers/data/xai.json";
const PI_META = "pi-ai@0.87.1 providers/data/meta.json";
const META_RESPONSES_EVIDENCE =
  "OpenCode 8a8bd622 packages/ai/src/providers/meta/responses.ts + protocols/meta-responses.ts + providers/meta.ts";
const SAFE_NON_REASONING_INCLUDES = new Set(["code_interpreter_call.outputs"]);

// Source-level admission does not authenticate a provider or prove the final wire. The returned
// proof names both the exact Pi row and the native projection constraints used by this matcher.
export function admitResponsesVariant(
  model: ThinkingModel,
  variant: ThinkingVariant,
): ResponsesAdmission {
  const identity = readIdentity(model);
  if (identity.kind === "outside-scope") return identity;
  if (identity.kind !== "resolved") return { kind: "unresolved" };

  const rawLevels = LEVEL_MAPS[`${identity.provider}/${identity.modelID}`];
  if (rawLevels === undefined) return { kind: "unresolved" };
  const levels = completeLevelMap(rawLevels);
  const advertisedLevels = CANONICAL_LEVELS.filter(
    (level) => levels[level] !== null,
  );
  const unsupportedLevels = CANONICAL_LEVELS.filter(
    (level) => levels[level] === null,
  );
  const controls = readControls(
    model,
    variant,
    identity.provider,
    identity.modelID,
  );
  if (controls === undefined)
    return { kind: "unproven-controls", advertisedLevels, unsupportedLevels };

  const effort = controls.effort;
  const compatibleLevels = CANONICAL_LEVELS.filter(
    (level) =>
      level !== "off" && levels[level] !== null && levels[level] === effort,
  );
  const offAdmitted = levels.off !== null;
  const expectedOffInclude =
    identity.provider === "xai" ? "encrypted" : "absent";
  const positiveControlsMatch =
    controls.summary === "auto" &&
    includeContainsReasoning(controls.include) &&
    (controls.include === undefined ||
      isValidLogicalIncludes(controls.include));
  const offControlsMatch =
    effort === "none" &&
    controls.summary === undefined &&
    (expectedOffInclude === "encrypted"
      ? includeContainsReasoning(controls.include)
      : controls.include === undefined);
  const offCompatible = offAdmitted && offControlsMatch;
  const compatible = offCompatible
    ? ["off" as const]
    : positiveControlsMatch
      ? compatibleLevels
      : [];
  if (compatible.length === 0) {
    return { kind: "unproven-controls", advertisedLevels, unsupportedLevels };
  }

  const sourceFile =
    identity.provider === "openai"
      ? PI_OPENAI
      : identity.provider === "xai"
        ? PI_XAI
        : PI_META;
  const projection = offCompatible
    ? identity.provider === "openai"
      ? "OpenCode Responses projection: effort=none, summary absent, include absent"
      : "OpenCode Responses projection: effort=none, summary absent, encrypted include retained"
    : identity.provider === "meta"
      ? "OpenCode Meta Responses projection: mapped effort, summary=auto required, encrypted include retained"
      : "OpenCode Responses projection: mapped effort, summary=auto, encrypted include retained";
  return {
    kind: "matched",
    advertisedLevels,
    compatibleLevels: compatible,
    unsupportedLevels,
    proof: {
      transportKind: "native",
      compatibleLevels: compatible,
      evidence: `${sourceFile} ${identity.provider}/${identity.modelID}; ${identity.provider === "meta" ? META_RESPONSES_EVIDENCE : RESPONSES_EVIDENCE}; ${projection} (conditional, not final wire)`,
    },
  };
}

function completeLevelMap(
  raw: Readonly<Record<string, string | null>>,
): Record<ThinkingLevel, string | null> {
  return Object.fromEntries(
    CANONICAL_LEVELS.map((level) => [
      level,
      level === "off" ? (raw.off ?? null) : (raw[level] ?? null),
    ]),
  ) as Record<ThinkingLevel, string | null>;
}

type Identity =
  | { readonly kind: "outside-scope" }
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "resolved";
      readonly provider: "openai" | "xai" | "meta";
      readonly modelID: string;
    };

function readIdentity(model: ThinkingModel): Identity {
  try {
    if (
      ["providerID", "package", "canonical", "modelID", "id"].some((key) =>
        hasAccessor(model, key),
      )
    ) {
      return { kind: "unresolved" };
    }
    const providerID = ownData(model, "providerID");
    const packageName = ownData(model, "package");
    const candidate =
      providerID === "openai" ||
      providerID === "xai" ||
      providerID === "meta" ||
      packageName === PACKAGE_BY_PROVIDER.openai ||
      packageName === PACKAGE_BY_PROVIDER.xai ||
      packageName === PACKAGE_BY_PROVIDER.meta;
    if (!candidate) return { kind: "outside-scope" };
    if (
      (providerID !== "openai" &&
        providerID !== "xai" &&
        providerID !== "meta") ||
      typeof packageName !== "string" ||
      packageName !== PACKAGE_BY_PROVIDER[providerID]
    )
      return { kind: "unresolved" };
    const canonical = ownData(model, "canonical");
    if (canonical !== undefined && canonical !== providerID)
      return { kind: "unresolved" };
    const modelID = ownData(model, "modelID");
    const id = ownData(model, "id");
    const effectiveID = modelID ?? id;
    return typeof effectiveID === "string" && effectiveID.length > 0
      ? { kind: "resolved", provider: providerID, modelID: effectiveID }
      : { kind: "unresolved" };
  } catch {
    return { kind: "unresolved" };
  }
}

type Controls = { effort: unknown; summary: unknown; include: unknown };

function readControls(
  model: ThinkingModel,
  variant: ThinkingVariant,
  provider: "openai" | "xai" | "meta",
  modelID: string,
): Controls | undefined {
  try {
    if (
      ["settings", "body"].some((key) => hasAccessor(model, key)) ||
      ["settings", "body"].some((key) => hasAccessor(variant, key))
    )
      return undefined;
    const modelSettings = readSettings(ownData(model, "settings"));
    const variantSettings = readSettings(ownData(variant, "settings"));
    const body = mergeBody(ownData(model, "body"), ownData(variant, "body"));
    if (
      modelSettings === undefined ||
      variantSettings === undefined ||
      body === undefined
    )
      return undefined;

    const defaultInclude = [ENCRYPTED_REASONING];
    const selectedSettings =
      variantSettings.includeEmpty || variantSettings.include !== undefined
        ? variantSettings
        : modelSettings.includeEmpty || modelSettings.include !== undefined
          ? modelSettings
          : undefined;
    // The OpenAI facade normalizes GPT-5 defaults before applying caller options.
    // This predicate mirrors that native step, not Pi model admission.
    const lowerID = modelID.toLowerCase();
    const gpt5Defaults =
      provider === "openai" &&
      lowerID.includes("gpt-5") &&
      !lowerID.includes("gpt-5-chat") &&
      !lowerID.includes("gpt-5-pro");
    const projected: Controls = {
      effort:
        variantSettings.effort ??
        modelSettings.effort ??
        (gpt5Defaults ? "medium" : undefined),
      summary:
        variantSettings.summary ??
        modelSettings.summary ??
        (gpt5Defaults ? "auto" : undefined),
      include:
        selectedSettings === undefined
          ? defaultInclude
          : selectedSettings.includeEmpty
            ? undefined
            : selectedSettings.include,
    };
    if (body.hasEffort) projected.effort = body.effort;
    if (body.hasSummary) projected.summary = body.summary;
    if (body.hasInclude) projected.include = body.include;
    return isNativeControl(
      projectionValue(model, variant, "settings", "reasoningEffort"),
      projected.effort,
    ) &&
      isNativeControl(
        projectionValue(model, variant, "settings", "reasoningSummary"),
        projected.summary,
      ) &&
      (projected.include === undefined ||
        isValidLogicalIncludes(projected.include))
      ? projected
      : undefined;
  } catch {
    return undefined;
  }
}

type Settings = {
  effort: unknown;
  summary: unknown;
  include: unknown;
  includeEmpty: boolean;
};
function readSettings(value: unknown): Settings | undefined {
  if (value === undefined)
    return {
      effort: undefined,
      summary: undefined,
      include: undefined,
      includeEmpty: false,
    };
  if (
    !isRecord(value) ||
    ["reasoningEffort", "reasoningSummary", "include"].some((key) =>
      hasAccessor(value, key),
    ) ||
    [
      "thinking",
      "thinkingBudget",
      "thinkingConfig",
      "reasoningConfig",
      "reasoning",
      "reasoning_effort",
      "reasoning_budget",
      "budgetTokens",
    ].some((key) => hasOwn(value, key))
  )
    return undefined;
  const effort = ownData(value, "reasoningEffort");
  const summary = ownData(value, "reasoningSummary");
  const include = ownData(value, "include");
  if (
    (effort !== undefined && typeof effort !== "string") ||
    (summary !== undefined &&
      summary !== "auto" &&
      summary !== "concise" &&
      summary !== "detailed") ||
    (include !== undefined && !isValidInclude(include))
  )
    return undefined;
  return {
    effort,
    summary,
    include:
      Array.isArray(include) && include.length === 0 ? undefined : include,
    includeEmpty: Array.isArray(include) && include.length === 0,
  };
}

function mergeBody(
  base: unknown,
  overlay: unknown,
):
  | (Controls & {
      hasEffort: boolean;
      hasSummary: boolean;
      hasInclude: boolean;
    })
  | undefined {
  const baseFields = bodyControls(base);
  const overlayFields = bodyControls(overlay);
  if (baseFields === undefined || overlayFields === undefined) return undefined;
  return {
    effort: overlayFields.hasEffort ? overlayFields.effort : baseFields.effort,
    summary: overlayFields.hasSummary
      ? overlayFields.summary
      : baseFields.summary,
    include: overlayFields.hasInclude
      ? overlayFields.include
      : baseFields.include,
    hasEffort: overlayFields.hasEffort || baseFields.hasEffort,
    hasSummary: overlayFields.hasSummary || baseFields.hasSummary,
    hasInclude: overlayFields.hasInclude || baseFields.hasInclude,
  };
}

function bodyControls(value: unknown):
  | (Controls & {
      hasEffort: boolean;
      hasSummary: boolean;
      hasInclude: boolean;
    })
  | undefined {
  if (value === undefined)
    return {
      effort: undefined,
      summary: undefined,
      include: undefined,
      hasEffort: false,
      hasSummary: false,
      hasInclude: false,
    };
  if (
    !isRecord(value) ||
    ["include", "reasoning"].some((key) => hasAccessor(value, key)) ||
    [
      "reasoning_effort",
      "reasoning_summary",
      "reasoningEffort",
      "reasoningSummary",
      "thinking",
      "thinkingBudget",
      "thinkingConfig",
      "reasoningConfig",
      "budget_tokens",
      "reasoning_budget",
    ].some((key) => hasOwn(value, key))
  )
    return undefined;
  const include = ownField(value, "include");
  const reasoning = ownField(value, "reasoning");
  let effort: unknown;
  let summary: unknown;
  let hasEffort = false;
  let hasSummary = false;
  if (reasoning !== undefined) {
    if (
      !isRecord(reasoning) ||
      ["effort", "summary"].some((key) => hasAccessor(reasoning, key))
    )
      return undefined;
    for (const key of ownKeys(reasoning))
      if (!["effort", "summary"].includes(key)) return undefined;
    effort = ownField(reasoning, "effort");
    summary = ownField(reasoning, "summary");
    hasEffort = hasOwn(reasoning, "effort");
    hasSummary = hasOwn(reasoning, "summary");
  }
  if (include !== undefined && !isValidLogicalIncludes(include))
    return undefined;
  return {
    effort,
    summary,
    include,
    hasEffort: hasEffort && effort !== undefined,
    hasSummary: hasSummary && summary !== undefined,
    hasInclude: hasOwn(value, "include") && include !== undefined,
  };
}

function projectionValue(
  model: ThinkingModel,
  variant: ThinkingVariant,
  field: string,
  key: string,
): unknown {
  const variantSettings = ownData(variant, field);
  const modelSettings = ownData(model, field);
  const v =
    variantSettings === undefined ? undefined : ownData(variantSettings, key);
  return (
    v ?? (modelSettings === undefined ? undefined : ownData(modelSettings, key))
  );
}

function isNativeControl(_explicit: unknown, value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
function isValidInclude(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1)
    if (typeof ownData(value, String(index)) !== "string") return false;
  return true;
}
function isValidLogicalIncludes(value: unknown): value is readonly string[] {
  if (!isValidInclude(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const entry = ownData(value, String(index));
    if (
      entry !== ENCRYPTED_REASONING &&
      !(typeof entry === "string" && SAFE_NON_REASONING_INCLUDES.has(entry))
    )
      return false;
  }
  return true;
}
function includeContainsReasoning(value: unknown): boolean {
  if (!isValidLogicalIncludes(value)) return false;
  for (let index = 0; index < value.length; index += 1)
    if (ownData(value, String(index)) === ENCRYPTED_REASONING) return true;
  return false;
}
function isRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function ownData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function hasAccessor(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && !("value" in descriptor);
}
function ownField(value: object, key: string): unknown {
  return ownData(value, key);
}
function hasOwn(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor;
}
function ownKeys(value: object): string[] {
  return Object.keys(value);
}

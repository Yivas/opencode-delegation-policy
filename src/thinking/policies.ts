import type { ThinkingSetting } from "../state/schema.js";

// Canonical names, ordered from least to most reasoning. The host has no level field: a
// variant's level exists only where a public protocol overlay spells it out.
export const THINKING_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type ThinkingIssueCode =
  | "thinking-level-invalid"
  | "thinking-range-invalid"
  | "thinking-variant-unproven"
  | "thinking-variant-mismatch"
  | "thinking-unsupported";

// Structural subset of the host's model metadata (Model.Info from @opencode/schema 2.0.21).
// The catalogue port supplies these objects; this module only reads them.
export type ThinkingVariant = {
  readonly id: string;
  readonly settings?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
};

export type ThinkingModel = {
  readonly package?: string;
  readonly settings?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
  readonly variants: readonly ThinkingVariant[];
};

// Both bounds are inclusive. A fixed level is a range whose bounds are equal.
export type ThinkingRequirement = {
  readonly from: ThinkingLevel;
  readonly to: ThinkingLevel;
};

export type ThinkingRequirementResult =
  | { readonly ok: true; readonly requirement: ThinkingRequirement | undefined }
  | { readonly ok: false; readonly code: ThinkingIssueCode };

export type ThinkingOption = {
  readonly variant: string;
  readonly level: ThinkingLevel;
};

// "inline" keeps the variant written in the model reference. "options" lists every proven
// variant that satisfies the requirement; choosing one is the caller's launch decision.
export type ThinkingSelection =
  | { readonly kind: "unset" }
  | {
      readonly kind: "inline";
      readonly variant: string;
      readonly level: ThinkingLevel;
    }
  | { readonly kind: "options"; readonly options: readonly ThinkingOption[] };

export type ThinkingSelectionResult =
  | { readonly ok: true; readonly selection: ThinkingSelection }
  | { readonly ok: false; readonly code: ThinkingIssueCode };

// Public protocol evidence for the host's variant ids, pinned to @opencode/schema 2.0.21
// and the source commit 8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72. In packages/core/src/variant.ts
// (blob c07fcf13) the OpenAI Responses protocol and its xAI variant both emit
// `settings: { reasoningEffort, reasoningSummary, include }` through `responsesEffort`.
// Packages not listed here have no known level, even when their overlays look similar.
const RESPONSES_EFFORT_SETTINGS: readonly string[] = Object.freeze([
  "reasoningEffort",
  "reasoningSummary",
  "include",
]);
const REASONING_EFFORT_SETTINGS: ReadonlyMap<string, readonly string[]> =
  new Map([
    ["@opencode/ai/providers/openai", RESPONSES_EFFORT_SETTINGS],
    ["@opencode/ai/providers/xai", RESPONSES_EFFORT_SETTINGS],
  ]);

const LEVEL_SETTING = "reasoningEffort";

// Literal reasoningEffort values with a proven level. The protocol schema
// (packages/ai/src/schema/options.ts, blob 88429a2d, at 8a8bd622) lists none and minimal..max as
// known efforts. None has no canonical level here, and off is not listed, so a literal off proves
// nothing. The schema also accepts any string, which proves no semantics either.
const PROVEN_EFFORT_LEVELS: readonly ThinkingLevel[] = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

// Model-level compaction is not a thinking control. Any other model-level overlay could hide
// or override the variant's effort, so it makes every level unknown.
const MODEL_SETTING_ALLOWLIST: readonly string[] = Object.freeze([
  "compaction",
]);

export function thinkingRequirement(
  setting: ThinkingSetting,
): ThinkingRequirementResult {
  switch (setting.kind) {
    case "unset":
      return { ok: true, requirement: undefined };
    case "fixed":
      if (!isThinkingLevel(setting.level)) {
        return { ok: false, code: "thinking-level-invalid" };
      }
      return {
        ok: true,
        requirement: { from: setting.level, to: setting.level },
      };
    case "range": {
      if (!isThinkingLevel(setting.from) || !isThinkingLevel(setting.to)) {
        return { ok: false, code: "thinking-range-invalid" };
      }
      if (levelRank(setting.from) > levelRank(setting.to)) {
        return { ok: false, code: "thinking-range-invalid" };
      }
      return {
        ok: true,
        requirement: { from: setting.from, to: setting.to },
      };
    }
  }
}

// Returns the level only when the variant's own overlay and the model-level overlays are
// exactly the shape the allowlist names. Anything else is unknown, not a guess.
export function knownThinkingLevel(
  model: ThinkingModel,
  variant: ThinkingVariant,
): ThinkingLevel | undefined {
  const allowedSettings =
    model.package === undefined
      ? undefined
      : REASONING_EFFORT_SETTINGS.get(model.package);
  if (allowedSettings === undefined) {
    return undefined;
  }
  if (
    !hasOnlyModelSettings(model) ||
    variant.body !== undefined ||
    variant.headers !== undefined
  ) {
    return undefined;
  }
  // Only own settings count: an inherited field is not part of the variant the host serves.
  const settings = Object.hasOwn(variant, "settings")
    ? variant.settings
    : undefined;
  if (
    !isPlainRecord(settings) ||
    !Object.keys(settings).every((key) => allowedSettings.includes(key)) ||
    !Object.hasOwn(settings, LEVEL_SETTING)
  ) {
    return undefined;
  }
  const level = settings[LEVEL_SETTING];
  return typeof level === "string" && isProvenEffortLevel(level)
    ? level
    : undefined;
}

// `inlineVariant` is the variant written in the model reference, already checked by the caller
// to exist and to be unique. It is never replaced: a proven match is accepted as written.
export function selectThinkingVariant(
  model: ThinkingModel,
  requirement: ThinkingRequirement | undefined,
  inlineVariant: ThinkingVariant | undefined,
): ThinkingSelectionResult {
  if (requirement === undefined) {
    return { ok: true, selection: { kind: "unset" } };
  }

  if (inlineVariant !== undefined) {
    const level = knownThinkingLevel(model, inlineVariant);
    if (level === undefined) {
      return { ok: false, code: "thinking-variant-unproven" };
    }
    if (!satisfies(level, requirement)) {
      return { ok: false, code: "thinking-variant-mismatch" };
    }
    return {
      ok: true,
      selection: { kind: "inline", variant: inlineVariant.id, level },
    };
  }

  const options: ThinkingOption[] = [];
  for (const variant of model.variants) {
    const level = knownThinkingLevel(model, variant);
    if (level !== undefined && satisfies(level, requirement)) {
      options.push({ variant: variant.id, level });
    }
  }
  if (options.length === 0) {
    return { ok: false, code: "thinking-unsupported" };
  }
  return { ok: true, selection: { kind: "options", options } };
}

function satisfies(
  level: ThinkingLevel,
  requirement: ThinkingRequirement,
): boolean {
  const rank = levelRank(level);
  return (
    rank >= levelRank(requirement.from) && rank <= levelRank(requirement.to)
  );
}

function levelRank(level: ThinkingLevel): number {
  return THINKING_LEVELS.indexOf(level);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

function isProvenEffortLevel(value: string): value is ThinkingLevel {
  return (PROVEN_EFFORT_LEVELS as readonly string[]).includes(value);
}

function hasOnlyModelSettings(model: ThinkingModel): boolean {
  if (model.headers !== undefined || model.body !== undefined) {
    return false;
  }
  if (model.settings === undefined) {
    return true;
  }
  return (
    isPlainRecord(model.settings) &&
    Object.keys(model.settings).every((key) =>
      MODEL_SETTING_ALLOWLIST.includes(key),
    )
  );
}

// Only plain and null-prototype objects are records. Arrays, class instances and prototype-linked
// objects can carry fields that Object.keys does not list, so they are not treated as settings.
export function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

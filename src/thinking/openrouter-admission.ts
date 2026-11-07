import { declaredBodyModelMatches } from "./model-identity.js";
import type {
  ThinkingLevel,
  ThinkingModel,
  ThinkingVariant,
} from "./policies.js";
import type { ContractProof } from "./protocols.js";

const OPENROUTER_PACKAGE = "@opencode/ai/providers/openrouter";
const OPENROUTER_PROVIDER = "openrouter";

// OpenRouter is a router: packages/ai/src/providers/openrouter.ts forwards the whole `reasoning`
// object unchanged (only max_tokens is fitted) and never translates a level itself. The host's own
// OpenRouter variants (packages/core/src/variant.ts, PROTOCOLS.openrouter) carry exactly three shapes:
// `{effort}` with the effort value as the variant id, `{enabled: false|true}` for its off/on toggle,
// and `{max_tokens}` for its two budget variants. Only the effort values the host names as defaults
// (EFFORTS: low, medium, high) and the explicit off switch are admitted here; a budget names no
// level, and minimal/xhigh/max only arrive as models.dev values this module cannot read.
const EFFORT_LEVELS: readonly ThinkingLevel[] = Object.freeze([
  "low",
  "medium",
  "high",
]);
const OFF_LEVELS: readonly ThinkingLevel[] = Object.freeze(["off"]);
const NO_UNSUPPORTED_LEVELS: readonly ThinkingLevel[] = Object.freeze([]);

const EVIDENCE =
  "opencode@dc2ffcf8 packages/ai/src/providers/openrouter.ts + packages/core/src/variant.ts " +
  "(router passthrough: the request names the level; upstream model support behind the router is not verified)";

export type OpenRouterAdmission =
  | { readonly kind: "outside-scope" }
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "unproven-controls";
      readonly unsupportedLevels: readonly ThinkingLevel[];
    }
  | {
      readonly kind: "matched";
      readonly proof: ContractProof;
      readonly unsupportedLevels: readonly ThinkingLevel[];
    };

// Source-level admission: it checks the declared OpenRouter route and the controls after the
// model/variant overlays. It does not authenticate the provider, prove the upstream model or
// observe the final wire.
export function admitOpenRouterVariant(
  model: ThinkingModel,
  variant: ThinkingVariant,
): OpenRouterAdmission {
  try {
    const identity = readIdentity(model);
    if (identity.kind !== "resolved") return identity;
    if (!declaredBodyModelMatches(model, variant, identity.modelID)) {
      return { kind: "unresolved" };
    }
    const reasoning = effectiveReasoning(model, variant);
    if (reasoning === undefined) return unproven();
    if (reasoning.effort !== undefined) {
      return typeof reasoning.effort === "string" &&
        (EFFORT_LEVELS as readonly string[]).includes(reasoning.effort)
        ? matched("native", [reasoning.effort as ThinkingLevel])
        : unproven();
    }
    if (reasoning.enabled === false) return matched("binary", OFF_LEVELS);
    return unproven();
  } catch {
    return unproven();
  }
}

function unproven(): OpenRouterAdmission {
  return {
    kind: "unproven-controls",
    unsupportedLevels: NO_UNSUPPORTED_LEVELS,
  };
}

function matched(
  transportKind: ContractProof["transportKind"],
  compatibleLevels: readonly ThinkingLevel[],
): OpenRouterAdmission {
  return {
    kind: "matched",
    unsupportedLevels: NO_UNSUPPORTED_LEVELS,
    proof: {
      sourceScope: "host-translation",
      transportKind,
      compatibleLevels,
      evidence: EVIDENCE,
    },
  };
}

type Identity =
  | { readonly kind: "outside-scope" }
  | { readonly kind: "unresolved" }
  | { readonly kind: "resolved"; readonly modelID: string };

function readIdentity(model: ThinkingModel): Identity {
  if (ownData(model, "package") !== OPENROUTER_PACKAGE) {
    return { kind: "outside-scope" };
  }
  const providerID = ownData(model, "providerID");
  const canonical = ownData(model, "canonical");
  if (
    providerID !== OPENROUTER_PROVIDER ||
    (canonical !== undefined && canonical !== providerID)
  ) {
    return { kind: "unresolved" };
  }
  const modelID = ownData(model, "modelID");
  const id = ownData(model, "id");
  const effectiveModelID = modelID ?? id;
  if (typeof effectiveModelID !== "string" || effectiveModelID.length === 0) {
    return { kind: "unresolved" };
  }
  return { kind: "resolved", modelID: effectiveModelID };
}

type Reasoning = {
  readonly effort: unknown;
  readonly enabled: unknown;
};

// The effective controls after both overlays. Undefined means the variant carries something this
// module cannot read as a level: a body or header overlay, a budget, `exclude`, an unknown key, or
// two controls at once. Those stay unmapped instead of being ignored.
function effectiveReasoning(
  model: ThinkingModel,
  variant: ThinkingVariant,
): Reasoning | undefined {
  if (
    ownData(variant, "headers") !== undefined ||
    ownData(variant, "body") !== undefined
  ) {
    return undefined;
  }
  const modelSettings = exactFields(ownData(model, "settings"), [
    "compaction",
    "reasoning",
  ]);
  const variantSettings = exactFields(ownData(variant, "settings"), [
    "reasoning",
  ]);
  if (modelSettings === undefined || variantSettings === undefined) {
    return undefined;
  }
  const modelReasoning = reasoningAt(ownData(modelSettings, "reasoning"));
  const variantReasoning = reasoningAt(ownData(variantSettings, "reasoning"));
  if (modelReasoning === undefined || variantReasoning === undefined) {
    return undefined;
  }
  const effort =
    variantReasoning.effort === undefined
      ? modelReasoning.effort
      : variantReasoning.effort;
  const enabled =
    variantReasoning.enabled === undefined
      ? modelReasoning.enabled
      : variantReasoning.enabled;
  if (effort !== undefined && enabled !== undefined) {
    return undefined;
  }
  if (effort !== undefined && typeof effort !== "string") return undefined;
  if (enabled !== undefined && typeof enabled !== "boolean") return undefined;
  return { effort, enabled };
}

// Only `effort` and `enabled` name a level. `max_tokens` is a budget, `exclude` is a response
// filter, and any other key is unknown here, so all of them leave the variant unmapped.
function reasoningAt(value: unknown): Reasoning | undefined {
  const record = exactFields(value, ["effort", "enabled"]);
  if (record === undefined) return undefined;
  return {
    effort: ownData(record, "effort"),
    enabled: ownData(record, "enabled"),
  };
}

// Undefined means present but not readable as a proof: not a plain record, or it carries an own
// field outside `allowed`. An absent value reads as an empty record.
function exactFields(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> | undefined {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) return undefined;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return undefined;
  }
  return value;
}

const UNREADABLE = Symbol("unreadable");

function ownData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  return "value" in descriptor ? descriptor.value : UNREADABLE;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

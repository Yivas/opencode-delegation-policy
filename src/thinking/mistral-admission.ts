import { MISTRAL_CATALOGUE, MISTRAL_SOURCE_SCOPE } from "./mistral.js";
import { declaredBodyModelMatches } from "./model-identity.js";
import type {
  ThinkingLevel,
  ThinkingModel,
  ThinkingVariant,
} from "./policies.js";
import type { ContractProof } from "./protocols.js";

const MISTRAL_PACKAGE = "@opencode/ai/providers/mistral";
const MISTRAL_PROVIDER = "mistral";
const EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

type MistralAdmission =
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

const NO_UNSUPPORTED_LEVELS: readonly ThinkingLevel[] = Object.freeze([]);
const SOURCE_UNSUPPORTED_LEVELS: readonly ThinkingLevel[] = Object.freeze([
  "xhigh",
  "max",
]);
const OFF_LEVELS: readonly ThinkingLevel[] = Object.freeze(["off"]);
const POSITIVE_LEVELS: readonly ThinkingLevel[] = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
]);

// This checks the frozen Pi row against the declared native route and the controls after
// model/variant overlays. It does not establish credentials, request ownership or final wire.
export function admitMistralVariant(
  model: ThinkingModel,
  variant: ThinkingVariant,
): MistralAdmission {
  try {
    const identity = readIdentity(model);
    if (identity.kind !== "resolved") return identity;
    const row = MISTRAL_CATALOGUE.find(
      (candidate) => candidate.protocolModelID === identity.modelID,
    );
    if (row === undefined) return { kind: "outside-scope" };
    if (!declaredBodyModelMatches(model, variant, identity.modelID)) {
      return { kind: "unresolved" };
    }

    const controls = effectiveControls(model, variant);
    if (controls === undefined) {
      return {
        kind: "unproven-controls",
        unsupportedLevels: NO_UNSUPPORTED_LEVELS,
      };
    }

    const off =
      controls.reasoningEffort === undefined &&
      controls.promptMode === undefined;
    const positive =
      row.channel === "reasoning_effort"
        ? controls.reasoningEffort === "high" &&
          controls.promptMode === undefined
        : controls.promptMode === "reasoning" &&
          controls.reasoningEffort === undefined;
    if (!off && !positive) {
      return {
        kind: "unproven-controls",
        unsupportedLevels: NO_UNSUPPORTED_LEVELS,
      };
    }

    return {
      kind: "matched",
      unsupportedLevels: SOURCE_UNSUPPORTED_LEVELS,
      proof: {
        sourceScope: "pi-model-recipe",
        transportKind: "native",
        compatibleLevels: off ? OFF_LEVELS : POSITIVE_LEVELS,
        evidence: `${MISTRAL_SOURCE_SCOPE}; providers/data/mistral.json ${row.protocolModelID}; opencode@8a8bd622 packages/ai/src/protocols/mistral-chat.ts (conditional source recipe, not final wire)`,
      },
    };
  } catch {
    return {
      kind: "unproven-controls",
      unsupportedLevels: NO_UNSUPPORTED_LEVELS,
    };
  }
}

type Identity =
  | { readonly kind: "outside-scope" }
  | { readonly kind: "unresolved" }
  | { readonly kind: "resolved"; readonly modelID: string };

type Controls = {
  readonly reasoningEffort: unknown;
  readonly promptMode: unknown;
};

function readIdentity(model: ThinkingModel): Identity {
  if (ownData(model, "package") !== MISTRAL_PACKAGE) {
    return { kind: "outside-scope" };
  }
  const providerID = ownData(model, "providerID");
  const canonical = ownData(model, "canonical");
  if (
    providerID !== MISTRAL_PROVIDER ||
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

function effectiveControls(
  model: ThinkingModel,
  variant: ThinkingVariant,
): Controls | undefined {
  const modelSettings = controlsAt(ownData(model, "settings"), [
    "reasoningEffort",
    "promptMode",
  ]);
  const variantSettings = controlsAt(ownData(variant, "settings"), [
    "reasoningEffort",
    "promptMode",
  ]);
  const modelBody = controlsAt(ownData(model, "body"), [
    "reasoning_effort",
    "prompt_mode",
  ]);
  const variantBody = controlsAt(ownData(variant, "body"), [
    "reasoning_effort",
    "prompt_mode",
  ]);
  if (
    modelSettings === undefined ||
    variantSettings === undefined ||
    modelBody === undefined ||
    variantBody === undefined
  ) {
    return undefined;
  }

  const reasoningEffortSetting = mergeOverlay(
    modelSettings.reasoningEffort,
    variantSettings.reasoningEffort,
  );
  const promptModeSetting = mergeOverlay(
    modelSettings.promptMode,
    variantSettings.promptMode,
  );
  if (
    !validSetting("reasoningEffort", reasoningEffortSetting) ||
    !validSetting("promptMode", promptModeSetting) ||
    (reasoningEffortSetting !== undefined && promptModeSetting !== undefined)
  ) {
    return undefined;
  }

  const reasoningEffortBody = mergeOverlay(
    modelBody.reasoning_effort,
    variantBody.reasoning_effort,
  );
  const promptModeBody = mergeOverlay(
    modelBody.prompt_mode,
    variantBody.prompt_mode,
  );
  if (
    !validBody("reasoning_effort", reasoningEffortBody) ||
    !validBody("prompt_mode", promptModeBody)
  ) {
    return undefined;
  }

  return {
    reasoningEffort: reasoningEffortBody ?? reasoningEffortSetting,
    promptMode: promptModeBody ?? promptModeSetting,
  };
}

function controlsAt(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const control = ownData(value, key);
    if (control === UNREADABLE) return undefined;
    result[key] = control;
  }
  return result;
}

function mergeOverlay(base: unknown, overlay: unknown): unknown {
  return overlay === undefined ? base : overlay;
}

function validSetting(
  key: "reasoningEffort" | "promptMode",
  value: unknown,
): boolean {
  if (value === undefined) return true;
  return key === "reasoningEffort"
    ? typeof value === "string" &&
        (EFFORT_VALUES as readonly string[]).includes(value)
    : value === "reasoning";
}

function validBody(
  key: "reasoning_effort" | "prompt_mode",
  value: unknown,
): boolean {
  return key === "reasoning_effort"
    ? validSetting("reasoningEffort", value)
    : validSetting("promptMode", value);
}

const UNREADABLE = Symbol("unreadable");

function ownData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return undefined;
    return "value" in descriptor ? descriptor.value : UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

function isPlainRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

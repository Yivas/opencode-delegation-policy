import type { ThinkingSetting } from "../state/schema.js";
import {
  type ProofSourceScope,
  recognizeVariantProof,
  type TransportKind,
} from "./protocols.js";
import { admitResponsesVariant } from "./responses-admission.js";

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

// "unmapped" means a variant's semantics are not proven here (a budget without a Pi translation,
// an unproven switch, or a contradiction). "unsupported" means every proven variant excludes the
// requirement, or there are none.
export type ThinkingIssueCode =
  | "thinking-level-invalid"
  | "thinking-range-invalid"
  | "thinking-variant-unproven"
  | "thinking-variant-mismatch"
  | "thinking-unmapped"
  | "thinking-unsupported"
  | "thinking-pi-level-unsupported"
  | "thinking-identity-unresolved"
  | "thinking-controls-unproven"
  | "thinking-construction-unproven";

// Structural subset of the host's model metadata (Model.Info from @opencode/schema 2.0.21).
// The catalogue port supplies these objects; this module only reads them.
export type ThinkingVariant = {
  readonly id: string;
  readonly settings?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
};

export type ThinkingModel = {
  readonly providerID: string;
  readonly id?: string;
  readonly modelID?: string;
  readonly canonical?: string;
  readonly package?: string;
  readonly limit?: { readonly output?: unknown };
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

// What one variant can mean, and what a requirement admits from it. `compatibleLevels` is the full
// set the serialized request is compatible with (a binary switch can cover several levels); it is
// never narrowed. `admittedLevels` is the non-empty intersection with the requirement. Neither is a
// chosen level: the launch picks one from the admitted set, outside this module.
export type ThinkingProof = {
  readonly transportKind: TransportKind;
  readonly compatibleLevels: readonly ThinkingLevel[];
  readonly admittedLevels: readonly ThinkingLevel[];
  readonly evidence: string;
};

export type ThinkingOption = { readonly variant: string } & ThinkingProof;

// "inline" keeps the variant written in the model reference. "options" lists every proven
// variant whose compatible set meets the requirement; choosing one is the caller's launch decision.
export type ThinkingSelection =
  | { readonly kind: "unset" }
  | ({ readonly kind: "inline"; readonly variant: string } & ThinkingProof)
  | { readonly kind: "options"; readonly options: readonly ThinkingOption[] };

export type ThinkingSelectionResult =
  | { readonly ok: true; readonly selection: ThinkingSelection }
  | { readonly ok: false; readonly code: ThinkingIssueCode };

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

// Inspect native-field facts or a model-specific Pi recipe. `sourceScope` distinguishes them;
// native-field recognition alone does not establish a model's logical thinking support.
export function knownThinkingProof(
  model: ThinkingModel,
  variant: ThinkingVariant,
):
  | (Omit<ThinkingProof, "admittedLevels"> & {
      readonly sourceScope: ProofSourceScope;
    })
  | undefined {
  return recognizeVariantProof(model, variant);
}

// Inspect the recognized level names in proof order. This does not apply the model-admission gate;
// callers validating a thinking requirement must use selectThinkingVariant instead.
export function knownThinkingLevels(
  model: ThinkingModel,
  variant: ThinkingVariant,
): readonly ThinkingLevel[] {
  return knownThinkingProof(model, variant)?.compatibleLevels ?? [];
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
    const selected = selectedProof(model, inlineVariant);
    if (!selected.ok) {
      if (
        requirementUnsupported(selected.unsupportedLevels ?? [], requirement)
      ) {
        return { ok: false, code: "thinking-pi-level-unsupported" };
      }
      if (
        selected.nativeLevels !== undefined &&
        selected.nativeLevels.length > 0 &&
        selected.nativeLevels.every((level) =>
          selected.unsupportedLevels?.includes(level),
        )
      ) {
        return { ok: false, code: "thinking-variant-mismatch" };
      }
      return { ok: false, code: selected.code };
    }
    const proof = selected.proof;
    const admittedLevels = admit(proof.compatibleLevels, requirement);
    if (admittedLevels.length === 0) {
      return {
        ok: false,
        code: requirementUnsupported(selected.unsupportedLevels, requirement)
          ? "thinking-pi-level-unsupported"
          : "thinking-variant-mismatch",
      };
    }
    return {
      ok: true,
      selection: {
        kind: "inline",
        variant: inlineVariant.id,
        ...withAdmitted(proof, admittedLevels),
      },
    };
  }

  const options: ThinkingOption[] = [];
  let unprovenVariant = false;
  let constructionUnproven = false;
  let unsupportedRequiredLevel = false;
  for (const variant of model.variants) {
    const selected = selectedProof(model, variant);
    if (!selected.ok) {
      if (selected.code === "thinking-identity-unresolved") return selected;
      unsupportedRequiredLevel ||= requirementUnsupported(
        selected.unsupportedLevels ?? [],
        requirement,
      );
      constructionUnproven ||=
        selected.code === "thinking-construction-unproven";
      unprovenVariant = true;
      continue;
    }
    const proof = selected.proof;
    const admittedLevels = admit(proof.compatibleLevels, requirement);
    if (admittedLevels.length === 0) {
      unsupportedRequiredLevel ||= requirementUnsupported(
        selected.unsupportedLevels,
        requirement,
      );
      continue;
    }
    if (admittedLevels.length > 0) {
      options.push({
        variant: variant.id,
        ...withAdmitted(proof, admittedLevels),
      });
    }
  }
  if (options.length === 0) {
    return {
      ok: false,
      code: unsupportedRequiredLevel
        ? "thinking-pi-level-unsupported"
        : constructionUnproven
          ? "thinking-construction-unproven"
          : unprovenVariant
            ? "thinking-unmapped"
            : "thinking-unsupported",
    };
  }
  return { ok: true, selection: { kind: "options", options } };
}

function selectedProof(
  model: ThinkingModel,
  variant: ThinkingVariant,
):
  | {
      readonly ok: true;
      readonly proof: Omit<ThinkingProof, "admittedLevels">;
      readonly unsupportedLevels: readonly ThinkingLevel[];
    }
  | {
      readonly ok: false;
      readonly code: ThinkingIssueCode;
      readonly unsupportedLevels?: readonly ThinkingLevel[];
      readonly nativeLevels?: readonly ThinkingLevel[];
    } {
  let nativeProof: ReturnType<typeof knownThinkingProof>;
  try {
    nativeProof = knownThinkingProof(model, variant);
  } catch {
    return { ok: false, code: "thinking-controls-unproven" };
  }
  const admission = admitResponsesVariant(model, variant);
  if (admission.kind === "unresolved") {
    return { ok: false, code: "thinking-identity-unresolved" };
  }
  if (admission.kind === "construction-unproven") {
    return {
      ok: false,
      code: "thinking-construction-unproven",
      unsupportedLevels: admission.unsupportedLevels,
    };
  }
  if (admission.kind === "unproven-controls") {
    return {
      ok: false,
      code: "thinking-controls-unproven",
      unsupportedLevels: admission.unsupportedLevels,
      nativeLevels: nativeProof?.compatibleLevels,
    };
  }
  if (admission.kind === "matched") {
    return {
      ok: true,
      proof: admission.proof,
      unsupportedLevels: admission.unsupportedLevels,
    };
  }
  if (
    nativeProof === undefined ||
    nativeProof.sourceScope !== "pi-model-recipe"
  ) {
    return { ok: false, code: "thinking-variant-unproven" };
  }
  return { ok: true, proof: nativeProof, unsupportedLevels: [] };
}

function withAdmitted(
  proof: Omit<ThinkingProof, "admittedLevels">,
  admittedLevels: readonly ThinkingLevel[],
): ThinkingProof {
  return {
    transportKind: proof.transportKind,
    compatibleLevels: proof.compatibleLevels,
    admittedLevels,
    evidence: proof.evidence,
  };
}

// A partially advertised range is not a model-level rejection: its remaining controls may be unproven.
function requirementUnsupported(
  unsupportedLevels: readonly ThinkingLevel[],
  requirement: ThinkingRequirement,
): boolean {
  return admit(THINKING_LEVELS, requirement).every((level) =>
    unsupportedLevels.includes(level),
  );
}

// The levels of a compatible set that fall inside the inclusive requirement, in canonical order.
function admit(
  compatibleLevels: readonly ThinkingLevel[],
  requirement: ThinkingRequirement,
): readonly ThinkingLevel[] {
  return THINKING_LEVELS.filter(
    (level) =>
      compatibleLevels.includes(level) &&
      levelRank(level) >= levelRank(requirement.from) &&
      levelRank(level) <= levelRank(requirement.to),
  );
}

function levelRank(level: ThinkingLevel): number {
  return THINKING_LEVELS.indexOf(level);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

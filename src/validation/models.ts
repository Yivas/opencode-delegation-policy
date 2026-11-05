import type { Plugin } from "@opencode/plugin";

import type { EffectivePreferences } from "../state/effective.js";
import {
  type Intensity,
  PreferenceStateError,
  type RoleKey,
  type ThinkingSetting,
} from "../state/schema.js";
import type { PreferenceStore } from "../state/store.js";
import {
  selectThinkingVariant,
  type ThinkingIssueCode,
  type ThinkingOption,
  type ThinkingRequirement,
  type ThinkingSelection,
  type ThinkingVariant,
  thinkingRequirement,
} from "../thinking/policies.js";
import { isPlainRecord } from "../thinking/protocols.js";

// The host's catalogue, read on each validation. Only `list` is used: its entries are
// Model.Info records and `enabled` says whether the model may run.
export type ModelCatalog = Pick<Plugin.Context["model"], "list">;

export type ModelReference = {
  readonly providerID: string;
  readonly id: string;
  readonly variant?: string;
};

export type RoleSelection = {
  readonly role: RoleKey;
  readonly model: ModelReference;
  readonly thinking: ThinkingSelection;
};

export type ValidationCode =
  | "preferences-unreadable"
  | "catalog-unavailable"
  | "no-ordinary-role"
  | "not-configured"
  | "invalid-reference"
  | "model-not-found"
  | "ambiguous-model"
  | "model-disabled"
  | "variant-not-found"
  | "ambiguous-variant"
  | ThinkingIssueCode;

// Carries no raw value, overlay, header or host message: only where the problem is and what kind.
// The subject is a role, an Advisor entry (numbered from 1) or neither, never both.
export type ValidationIssue = {
  readonly field:
    | "preferences"
    | "catalog"
    | "roles"
    | "advisors"
    | "model"
    | "variant"
    | "thinking";
  readonly code: ValidationCode;
} & (
  | { readonly role?: RoleKey; readonly advisor?: never }
  | { readonly advisor: number; readonly role?: never }
);

// `model.variant` is the user's default when the reference carries one. `variants` lists every
// proven variant the main agent may pass instead. When none can be listed, `variants` is empty,
// `unlisted` says why ("thinking-unsupported" when the model has no proven-capable variant at all,
// "thinking-unmapped" when some exist but none is proven, and so on), and the Advisor is launched
// without a variant, like an ordinary role with no thinking policy.
export type AdvisorSelection = {
  readonly advisor: number;
  readonly model: ModelReference;
  readonly variants: readonly ThinkingOption[];
  readonly unlisted?: ThinkingIssueCode;
};

export type DelegationAxis =
  | { readonly status: "off" }
  | {
      readonly status: "active";
      readonly intensity: Exclude<Intensity, "off">;
      readonly roles: readonly RoleSelection[];
    }
  | { readonly status: "error"; readonly issues: readonly ValidationIssue[] };

// "partial" keeps the valid Advisors usable and reports the rest; "active" never carries issues and
// "error" means no configured Advisor is usable.
export type AdvisorAxis =
  | { readonly status: "off" }
  | {
      readonly status: "active";
      readonly advisors: readonly AdvisorSelection[];
    }
  | {
      readonly status: "partial";
      readonly advisors: readonly AdvisorSelection[];
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly status: "error"; readonly issues: readonly ValidationIssue[] };

export type DelegationValidation = {
  readonly delegation: DelegationAxis;
  readonly advisor: AdvisorAxis;
};

// The fields the resolver reads from a Model.Info entry (packages/schema/src/model.ts, blob b52018f9).
type CatalogModel = {
  readonly providerID: string;
  readonly id: string;
  readonly modelID: string;
  readonly canonical?: string;
  readonly enabled: boolean;
  readonly package?: string;
  readonly limit: { readonly output: number };
  readonly settings?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
  readonly variants: readonly ThinkingVariant[];
};
type CatalogResult =
  | { readonly ok: true; readonly models: readonly CatalogModel[] }
  | { readonly ok: false };
type IssueSubject = { readonly role: RoleKey } | { readonly advisor: number };
type Resolved<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue };
type ResolvedModel = {
  readonly reference: ModelReference;
  readonly model: CatalogModel;
  readonly inlineVariant: ThinkingVariant | undefined;
};

const DELEGATION_ROLES: readonly RoleKey[] = [
  "small",
  "medium",
  "large",
  "visualDesign",
];
const ORDINARY_ROLES: readonly RoleKey[] = ["small", "medium", "large"];

// Listing an Advisor's variants asks which ones have any proven level at all.
const ANY_THINKING_LEVEL: ThinkingRequirement = { from: "off", to: "max" };

// The only failures that mean "no variant can be listed" for a model that is otherwise valid.
// Anything else, including a catalogue identity that contradicts the recipe and any code added
// later, invalidates the Advisor entry instead.
const NO_LISTABLE_VARIANT_CODES: readonly ThinkingIssueCode[] = [
  "thinking-unmapped",
  "thinking-unsupported",
  "thinking-construction-unproven",
  "thinking-pi-level-unsupported",
];

// Snapshot codes mean the stored document cannot be trusted. Other PreferenceStateError codes
// are caller errors, such as an invalid session identifier, and must not look like corruption.
const UNREADABLE_SNAPSHOT_CODES: readonly string[] = [
  "corrupt-document",
  "future-document",
  "storage-read-failed",
];

// Reads the session's effective preferences, then validates the axes that are active. A stored
// document that cannot be read fails both axes and never falls back to defaults. The catalogue
// is queried only when an active axis has a configured role, and at most once per call.
export async function validateDelegationAxes(input: {
  readonly store: PreferenceStore;
  readonly catalog: ModelCatalog;
  readonly sessionID: string;
}): Promise<DelegationValidation> {
  let preferences: EffectivePreferences;
  try {
    preferences = (await input.store.readSession(input.sessionID)).preferences;
  } catch (error) {
    if (!isUnreadableSnapshot(error)) {
      throw error;
    }
    return unreadableValidation();
  }

  const loadCatalog = onceAsync(() => readCatalog(input.catalog));
  return {
    delegation: await validateDelegation(preferences, loadCatalog),
    advisor: await validateAdvisor(preferences, loadCatalog),
  };
}

async function validateDelegation(
  preferences: EffectivePreferences,
  loadCatalog: () => Promise<CatalogResult>,
): Promise<DelegationAxis> {
  if (preferences.intensity === "off") {
    return { status: "off" };
  }

  const issues: ValidationIssue[] = [];
  const roles: RoleSelection[] = [];
  let validOrdinaryRoles = 0;
  for (const role of DELEGATION_ROLES) {
    const setting = preferences.roles[role];
    if (setting.kind !== "configured") {
      continue;
    }
    const result = await resolveConfiguredRole(
      role,
      setting.model,
      preferences.thinking[role],
      loadCatalog,
    );
    if (!result.ok) {
      issues.push(result.issue);
      continue;
    }
    roles.push(result.value);
    if (ORDINARY_ROLES.includes(role)) {
      validOrdinaryRoles += 1;
    }
  }

  if (validOrdinaryRoles === 0) {
    issues.push({ field: "roles", code: "no-ordinary-role" });
  }
  if (issues.length > 0) {
    return { status: "error", issues };
  }
  return { status: "active", intensity: preferences.intensity, roles };
}

async function validateAdvisor(
  preferences: EffectivePreferences,
  loadCatalog: () => Promise<CatalogResult>,
): Promise<AdvisorAxis> {
  if (preferences.advisorMode === "off") {
    return { status: "off" };
  }

  // "with-delegation" consults only while delegation is active and Advisors are configured, so
  // an unset or disabled list is off there. "on" requires at least one Advisor.
  const setting = preferences.advisors;
  if (setting.kind !== "configured") {
    if (preferences.advisorMode === "on") {
      return {
        status: "error",
        issues: [{ field: "advisors", code: "not-configured" }],
      };
    }
    return { status: "off" };
  }
  if (
    preferences.advisorMode === "with-delegation" &&
    preferences.intensity === "off"
  ) {
    return { status: "off" };
  }

  // Each entry stands alone: an invalid one is reported and never replaced by another model.
  const advisors: AdvisorSelection[] = [];
  const issues: ValidationIssue[] = [];
  for (const [index, reference] of setting.models.entries()) {
    const result = await resolveAdvisor(index + 1, reference, loadCatalog);
    if (result.ok) {
      advisors.push(result.value);
    } else {
      issues.push(result.issue);
    }
  }

  if (advisors.length === 0) {
    return { status: "error", issues };
  }
  if (issues.length > 0) {
    return { status: "partial", advisors, issues };
  }
  return { status: "active", advisors };
}

async function resolveConfiguredRole(
  role: RoleKey,
  reference: string,
  thinking: ThinkingSetting,
  loadCatalog: () => Promise<CatalogResult>,
): Promise<Resolved<RoleSelection>> {
  const subject = { role };
  const resolved = await resolveModel(subject, reference, loadCatalog);
  if (!resolved.ok) {
    return resolved;
  }
  const { model, inlineVariant } = resolved.value;

  const requirement = thinkingRequirement(thinking);
  if (!requirement.ok) {
    return failed(subject, "thinking", requirement.code);
  }
  const selected = selectThinkingVariant(
    model,
    requirement.requirement,
    inlineVariant,
  );
  if (!selected.ok) {
    return failed(subject, "thinking", selected.code);
  }

  return {
    ok: true,
    value: {
      role,
      model: resolved.value.reference,
      thinking: selected.selection,
    },
  };
}

async function resolveAdvisor(
  advisor: number,
  reference: string,
  loadCatalog: () => Promise<CatalogResult>,
): Promise<Resolved<AdvisorSelection>> {
  const subject = { advisor };
  const resolved = await resolveModel(subject, reference, loadCatalog);
  if (!resolved.ok) {
    return resolved;
  }
  const { model, inlineVariant } = resolved.value;

  // A default written by the user must be proven; it is never dropped to make the entry valid.
  if (inlineVariant !== undefined) {
    const selected = selectThinkingVariant(
      model,
      ANY_THINKING_LEVEL,
      inlineVariant,
    );
    if (!selected.ok) {
      return failed(subject, "thinking", selected.code);
    }
  }

  // The listing is a separate call: with an inline variant the selector returns only that one.
  const listed = selectThinkingVariant(model, ANY_THINKING_LEVEL, undefined);
  const base = { advisor, model: resolved.value.reference };
  if (listed.ok) {
    // A requirement without an inline variant yields options; anything else is not a listing.
    if (listed.selection.kind !== "options") {
      return failed(subject, "thinking", "thinking-unsupported");
    }
    return {
      ok: true,
      value: { ...base, variants: listed.selection.options },
    };
  }
  if (NO_LISTABLE_VARIANT_CODES.includes(listed.code)) {
    return {
      ok: true,
      value: { ...base, variants: [], unlisted: listed.code },
    };
  }
  return failed(subject, "thinking", listed.code);
}

// Reference grammar, catalogue lookup and inline variant shared by roles and Advisors.
async function resolveModel(
  subject: IssueSubject,
  reference: string,
  loadCatalog: () => Promise<CatalogResult>,
): Promise<Resolved<ResolvedModel>> {
  const parsed = parseModelReference(reference);
  if (parsed === undefined) {
    return failed(subject, "model", "invalid-reference");
  }

  const catalog = await loadCatalog();
  if (!catalog.ok) {
    return failed(subject, "catalog", "catalog-unavailable");
  }

  const match = findUniqueModel(catalog.models, parsed);
  if (match.kind === "missing") {
    return failed(subject, "model", "model-not-found");
  }
  if (match.kind === "ambiguous") {
    return failed(subject, "model", "ambiguous-model");
  }
  const { model } = match;
  if (!model.enabled) {
    return failed(subject, "model", "model-disabled");
  }
  if (hasDuplicateVariantIDs(model.variants)) {
    return failed(subject, "variant", "ambiguous-variant");
  }

  let inlineVariant: ThinkingVariant | undefined;
  if (parsed.variant !== undefined) {
    inlineVariant = model.variants.find(
      (candidate) => candidate.id === parsed.variant,
    );
    if (inlineVariant === undefined) {
      return failed(subject, "variant", "variant-not-found");
    }
  }

  return { ok: true, value: { reference: parsed, model, inlineVariant } };
}

// Mirrors the host's Model.Ref grammar (packages/schema/src/model.ts, blob b52018f9): the first
// slash ends a non-empty provider, the rest up to the first hash after it is the model id (it may
// contain slashes), and an optional non-empty variant follows that hash. No other normalisation.
function parseModelReference(text: string): ModelReference | undefined {
  const providerEnd = text.indexOf("/");
  if (providerEnd <= 0) {
    return undefined;
  }
  const providerID = text.slice(0, providerEnd);
  const variantStart = text.indexOf("#", providerEnd + 1);
  const id = text.slice(
    providerEnd + 1,
    variantStart === -1 ? undefined : variantStart,
  );
  const variant =
    variantStart === -1 ? undefined : text.slice(variantStart + 1);

  if (
    id === "" ||
    providerID.includes("#") ||
    (variant !== undefined && (variant === "" || variant.includes("#")))
  ) {
    return undefined;
  }
  return variant === undefined
    ? { providerID, id }
    : { providerID, id, variant };
}

function findUniqueModel(
  models: readonly CatalogModel[],
  reference: ModelReference,
):
  | { readonly kind: "found"; readonly model: CatalogModel }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous" } {
  // Matches the host id only. The protocol modelID and canonical alias are different fields
  // and provider or model-name fallbacks are not allowed.
  const matches = models.filter(
    (model) =>
      model.providerID === reference.providerID && model.id === reference.id,
  );
  const [first, second] = matches;
  if (first === undefined) {
    return { kind: "missing" };
  }
  if (second !== undefined) {
    return { kind: "ambiguous" };
  }
  return { kind: "found", model: first };
}

function hasDuplicateVariantIDs(variants: readonly ThinkingVariant[]): boolean {
  const ids = new Set(variants.map((variant) => variant.id));
  return ids.size !== variants.length;
}

// A malformed envelope or entry rejects the whole catalogue. The resolver must see every entry
// to tell an ambiguous match from a missing one, so an entry it cannot read leaves no safe answer.
// Only the fields the resolver reads are checked; the rest of Model.Info is not validated here.
async function readCatalog(catalog: ModelCatalog): Promise<CatalogResult> {
  let listed: unknown;
  try {
    listed = await catalog.list();
  } catch {
    // The host message is dropped on purpose: it can carry credentials or provider detail.
    return { ok: false };
  }
  try {
    const data = isPlainRecord(listed) ? ownData(listed, "data") : undefined;
    if (!Array.isArray(data)) return { ok: false };
    const models = Array.from(data, snapshotCatalogModel);
    if (models.some((model) => model === undefined)) return { ok: false };
    return { ok: true, models: models as CatalogModel[] };
  } catch {
    return { ok: false };
  }
}

function snapshotCatalogModel(value: unknown): CatalogModel | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (
    [
      "providerID",
      "id",
      "modelID",
      "canonical",
      "enabled",
      "package",
      "limit",
      "variants",
      "settings",
      "headers",
      "body",
    ].some((key) => hasOwnAccessor(value, key))
  )
    return undefined;
  const providerID = ownData(value, "providerID");
  const id = ownData(value, "id");
  const modelID = ownData(value, "modelID");
  const canonical = ownData(value, "canonical");
  const enabled = ownData(value, "enabled");
  const packageName = ownData(value, "package");
  const limit = ownData(value, "limit");
  const variants = ownData(value, "variants");
  if (
    typeof providerID !== "string" ||
    typeof id !== "string" ||
    typeof modelID !== "string" ||
    typeof enabled !== "boolean" ||
    (canonical !== undefined && typeof canonical !== "string") ||
    (packageName !== undefined && typeof packageName !== "string") ||
    !isCatalogLimit(limit) ||
    !Array.isArray(variants)
  )
    return undefined;
  const safeVariants = Array.from(variants, snapshotCatalogVariant);
  if (safeVariants.some((variant) => variant === undefined)) return undefined;
  const settings = ownData(value, "settings");
  const headers = ownData(value, "headers");
  const body = ownData(value, "body");
  return {
    providerID,
    id,
    modelID,
    canonical,
    enabled,
    package: packageName,
    limit,
    settings,
    headers,
    body,
    variants: safeVariants as ThinkingVariant[],
  };
}

// The output limit bounds the Pi budget translation. Only a finite positive number is read.
function isCatalogLimit(value: unknown): value is { output: number } {
  if (!isPlainRecord(value) || hasOwnAccessor(value, "output")) return false;
  const output = ownData(value, "output");
  return typeof output === "number" && Number.isFinite(output) && output > 0;
}

// An empty or hash-containing id cannot be written as a Model.Ref, so it cannot be a launch option.
function snapshotCatalogVariant(value: unknown): ThinkingVariant | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (
    ["id", "settings", "headers", "body"].some((key) =>
      hasOwnAccessor(value, key),
    )
  )
    return undefined;
  const id = ownData(value, "id");
  if (typeof id !== "string" || id === "" || id.includes("#")) return undefined;
  return {
    id,
    settings: ownData(value, "settings"),
    headers: ownData(value, "headers"),
    body: ownData(value, "body"),
  };
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function hasOwnAccessor(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && !("value" in descriptor);
}

function onceAsync<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load();
    return pending;
  };
}

function failed(
  subject: IssueSubject,
  field: ValidationIssue["field"],
  code: ValidationCode,
): { readonly ok: false; readonly issue: ValidationIssue } {
  return { ok: false, issue: { ...subject, field, code } };
}

function unreadableValidation(): DelegationValidation {
  return {
    delegation: {
      status: "error",
      issues: [{ field: "preferences", code: "preferences-unreadable" }],
    },
    advisor: {
      status: "error",
      issues: [{ field: "preferences", code: "preferences-unreadable" }],
    },
  };
}

function isUnreadableSnapshot(error: unknown): boolean {
  return (
    error instanceof PreferenceStateError &&
    UNREADABLE_SNAPSHOT_CODES.includes(error.code)
  );
}

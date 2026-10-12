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
  isPlainRecord,
  selectThinkingVariant,
  type ThinkingIssueCode,
  type ThinkingSelection,
  type ThinkingVariant,
  thinkingRequirement,
} from "../thinking/policies.js";

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
export type ValidationIssue = {
  readonly role?: RoleKey;
  readonly field:
    | "preferences"
    | "catalog"
    | "roles"
    | "model"
    | "variant"
    | "thinking";
  readonly code: ValidationCode;
};

export type DelegationAxis =
  | { readonly status: "off" }
  | {
      readonly status: "active";
      readonly intensity: Exclude<Intensity, "off">;
      readonly roles: readonly RoleSelection[];
    }
  | { readonly status: "error"; readonly issues: readonly ValidationIssue[] };

export type AdvisorAxis =
  | { readonly status: "off" }
  | { readonly status: "active"; readonly advisor: RoleSelection }
  | { readonly status: "error"; readonly issues: readonly ValidationIssue[] };

export type DelegationValidation = {
  readonly delegation: DelegationAxis;
  readonly advisor: AdvisorAxis;
};

// The fields the resolver reads from a Model.Info entry (packages/schema/src/model.ts, blob b52018f9).
type CatalogModel = {
  readonly providerID: string;
  readonly id: string;
  readonly enabled: boolean;
  readonly package?: string;
  readonly settings?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
  readonly variants: readonly ThinkingVariant[];
};
type CatalogResult =
  | { readonly ok: true; readonly models: readonly CatalogModel[] }
  | { readonly ok: false };
type RoleResult =
  | { readonly ok: true; readonly selection: RoleSelection }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const DELEGATION_ROLES: readonly RoleKey[] = [
  "small",
  "medium",
  "large",
  "visualDesign",
];
const ORDINARY_ROLES: readonly RoleKey[] = ["small", "medium", "large"];

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
      issues.push(...result.issues);
      continue;
    }
    roles.push(result.selection);
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

  // "with-delegation" consults only while delegation is active and an Advisor is configured, so
  // an unset or disabled Advisor is off there. "on" requires its Advisor.
  const setting = preferences.roles.advisor;
  if (setting.kind !== "configured") {
    if (preferences.advisorMode === "on") {
      return {
        status: "error",
        issues: [{ role: "advisor", field: "model", code: "not-configured" }],
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

  const result = await resolveConfiguredRole(
    "advisor",
    setting.model,
    preferences.thinking.advisor,
    loadCatalog,
  );
  if (!result.ok) {
    return { status: "error", issues: result.issues };
  }
  return { status: "active", advisor: result.selection };
}

async function resolveConfiguredRole(
  role: RoleKey,
  reference: string,
  thinking: ThinkingSetting,
  loadCatalog: () => Promise<CatalogResult>,
): Promise<RoleResult> {
  const parsed = parseModelReference(reference);
  if (parsed === undefined) {
    return failed(role, "model", "invalid-reference");
  }

  const catalog = await loadCatalog();
  if (!catalog.ok) {
    return failed(role, "catalog", "catalog-unavailable");
  }

  const match = findUniqueModel(catalog.models, parsed);
  if (match.kind === "missing") {
    return failed(role, "model", "model-not-found");
  }
  if (match.kind === "ambiguous") {
    return failed(role, "model", "ambiguous-model");
  }
  const { model } = match;
  if (!model.enabled) {
    return failed(role, "model", "model-disabled");
  }
  if (hasDuplicateVariantIDs(model.variants)) {
    return failed(role, "variant", "ambiguous-variant");
  }

  let inlineVariant: ThinkingVariant | undefined;
  if (parsed.variant !== undefined) {
    inlineVariant = model.variants.find(
      (candidate) => candidate.id === parsed.variant,
    );
    if (inlineVariant === undefined) {
      return failed(role, "variant", "variant-not-found");
    }
  }

  const requirement = thinkingRequirement(thinking);
  if (!requirement.ok) {
    return failed(role, "thinking", requirement.code);
  }
  const selected = selectThinkingVariant(
    model,
    requirement.requirement,
    inlineVariant,
  );
  if (!selected.ok) {
    return failed(role, "thinking", selected.code);
  }

  return {
    ok: true,
    selection: { role, model: parsed, thinking: selected.selection },
  };
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
  const data = isPlainRecord(listed) ? listed.data : undefined;
  if (!Array.isArray(data) || ![...data].every(isCatalogModel)) {
    return { ok: false };
  }
  return { ok: true, models: data };
}

function isCatalogModel(value: unknown): value is CatalogModel {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (
    typeof value.providerID === "string" &&
    typeof value.id === "string" &&
    typeof value.enabled === "boolean" &&
    (value.package === undefined || typeof value.package === "string") &&
    Array.isArray(value.variants) &&
    [...value.variants].every(isCatalogVariant)
  );
}

// An empty or hash-containing id cannot be written as a Model.Ref, so it cannot be a launch option.
function isCatalogVariant(value: unknown): value is ThinkingVariant {
  return (
    isPlainRecord(value) &&
    typeof value.id === "string" &&
    value.id !== "" &&
    !value.id.includes("#")
  );
}

function onceAsync<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load();
    return pending;
  };
}

function failed(
  role: RoleKey,
  field: ValidationIssue["field"],
  code: ValidationCode,
): RoleResult {
  return { ok: false, issues: [{ role, field, code }] };
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

import { isDeepStrictEqual } from "node:util";

import { THINKING_LEVELS, type ThinkingLevel } from "./policies.js";

// Pure Bedrock planner for Claude 4.6 adaptive thinking on the Converse route. Nothing here registers a family,
// promotes a ThinkingProof, reads an environment, a credential or AWS configuration, or calls a provider.
//
// Provenance is one snapshot: Pi @earendil-works/pi-ai 0.87.1 (git f07218c4d4bbc12bef056a7058c3dd49dfe41abe), api
// "bedrock-converse-stream". Files read as text: dist/providers/data/amazon-bedrock.json (key
// "bedrock-converse-stream"), dist/api/bedrock-converse-stream.js (streamSimple, buildAdditionalModelRequestFields,
// mapThinkingLevelToEffort, supportsAdaptiveThinking, isGovCloudBedrockTarget, getConfiguredBedrockRegion) and
// dist/models.js (getSupportedThinkingLevels). The 1.1.0 archive is not read, and no version is selected.
//
// Ids are exact catalogue keys. A prefix, alias, host id or chat: form is never normalised into a protocol id.
//
// The gate proves a fact about the thinking subtree of additionalModelRequestFields at the overlay: the candidate
// overlay merged over observed native fields, before SigV4 signs the final bytes. The merge mirrors mergeJsonRecords
// (OpenCode 8a8bd622, packages/ai/src/schema/options.ts, blob 88429a2d): recursive, skips undefined, cannot delete a
// key, and leaves a nested record that merges to nothing absent. The native reader (packages/ai/src/protocols/
// bedrock-converse.ts, blob 52a411e9) reads only providerOptions.thinking as an enabled budget. The native default
// block_binding (packages/ai/src/protocols/utils/claude-model.ts, blob 244b3bd8) applies only with a compatibility
// override or Claude 5.1 and later. No baseline id qualifies, and this module does not read compatibility, so the
// observed native input must already carry any such field. The verdict is "at-overlay" only. The final wire, the
// signature, the provider and later hooks are outside this module. Only thinking controls are compared; other
// output_config fields are outside scope. A verdict does not certify AWS region validity, actual resolved configuration,
// regional model availability or authentication: all region and native-field inputs are supplied by the caller.
//
// An own __proto__ key is rejected in every record. JSON.parse and defineProperty can create one, and a merge would
// then set a prototype instead of a key, so a thinking field could be read from a place the wire never sends.
//
// Standard regions send display summarized by default (bedrock-converse-stream.js, options.thinkingDisplay ?? "summarized").
// The target carries that default as a condition. On the raw stream route a caller may set thinkingDisplay, so the condition
// is needed there. On the streamSimple route the condition is conservative: buildBaseOptions does not forward the caller's
// thinkingDisplay, region, interleavedThinking, profile or bearerToken, so display is the source default there. It does
// forward apiKey, which the client may use as a bearer token. This comment makes no claim about how AWS resolves that
// value. GovCloud omits display.
//
// The request cap is not calculated. Pi's budget path, its context estimator and the caller's output limit are separate
// inputs, and this module never raises or rewrites a cap.

export const BEDROCK_PACKAGE = "@opencode/ai/providers/amazon-bedrock";
export const BEDROCK_API = "bedrock-converse-stream";

// The eleven 0.87.1 catalogue rows that carry Claude 4.6 adaptive thinking. Each row has api bedrock-converse-stream,
// reasoning true and thinkingLevelMap {"max":"max"}. The list is complete for this snapshot.
export const BEDROCK_BASELINE_IDS: readonly string[] = Object.freeze([
  "anthropic.claude-opus-4-6-v1",
  "anthropic.claude-sonnet-4-6",
  "au.anthropic.claude-opus-4-6-v1",
  "au.anthropic.claude-sonnet-4-6",
  "eu.anthropic.claude-opus-4-6-v1",
  "eu.anthropic.claude-sonnet-4-6",
  "global.anthropic.claude-opus-4-6-v1",
  "global.anthropic.claude-sonnet-4-6",
  "jp.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-opus-4-6-v1",
  "us.anthropic.claude-sonnet-4-6",
]);
const BASELINE: ReadonlySet<string> = new Set(BEDROCK_BASELINE_IDS);

export type BedrockEffort = "low" | "medium" | "high" | "max";
export type BedrockAbsence =
  | "thinking"
  | "output_config.effort"
  | "anthropic_beta"
  | "thinking.budget_tokens"
  | "thinking.block_binding";
export type BedrockCondition =
  | "caller-omits-reasoning-option"
  | "default-thinking-display";
export type BedrockInsufficient = "package" | "api" | "model";
export type BedrockRegionClass = "standard" | "govcloud" | "not-applicable";

export type BedrockCandidate = {
  readonly packageName: string;
  readonly api: string;
  readonly protocolModelID: string;
};

// `name` is the configured region string the caller supplies. It is checked only by the literal SDK predicate and is
// not validated as an AWS region. Empty is rejected as a local input precondition. The SDK would fall back to the
// environment for an empty value, and this module does not model that fallback. Nothing is trimmed.
export type BedrockRegion =
  | { readonly kind: "known"; readonly name: string }
  | { readonly kind: "unknown" };

export type BedrockTarget =
  | {
      readonly kind: "off";
      readonly absent: readonly BedrockAbsence[];
    }
  | {
      readonly kind: "adaptive";
      readonly thinking: {
        readonly type: "adaptive";
        readonly display?: "summarized";
      };
      readonly output_config: { readonly effort: BedrockEffort };
      readonly absent: readonly BedrockAbsence[];
    };

// The candidate, level and region class are kept so the gate can rebuild the canonical plan and compare it.
export type BedrockPlannedLevel = {
  readonly kind: "planned";
  readonly level: ThinkingLevel;
  readonly candidate: BedrockCandidate;
  readonly regionClass: BedrockRegionClass;
  readonly compatibleLevels: readonly ThinkingLevel[];
  readonly target: BedrockTarget;
  readonly conditions: readonly BedrockCondition[];
  readonly evidence: string;
};

export type BedrockLevelPlan =
  | BedrockPlannedLevel
  | {
      readonly kind: "pending-region";
      readonly level: ThinkingLevel;
      readonly evidence: string;
    }
  | { readonly kind: "unsupported-level"; readonly level: ThinkingLevel }
  | { readonly kind: "insufficient"; readonly reason: BedrockInsufficient }
  | {
      readonly kind: "invalid-input";
      readonly code: "candidate" | "level" | "region";
    };

export type BedrockRangeCandidate = {
  readonly compatibleLevels: readonly ThinkingLevel[];
  readonly admittedLevels: readonly ThinkingLevel[];
  readonly target: BedrockTarget;
  readonly conditions: readonly BedrockCondition[];
  readonly evidence: string;
};

// Every control whose range membership is non-empty. Nothing is selected: a caller chooses from these candidates.
export type BedrockRangePlan =
  | {
      readonly kind: "range";
      readonly candidates: readonly BedrockRangeCandidate[];
    }
  | { readonly kind: "none" }
  | { readonly kind: "pending-region" }
  | { readonly kind: "insufficient"; readonly reason: BedrockInsufficient }
  | {
      readonly kind: "invalid-input";
      readonly code: "candidate" | "level" | "region" | "range";
    };

export type BedrockNativeThinking =
  | { readonly kind: "unknown" }
  | {
      readonly kind: "observed";
      readonly additionalModelRequestFields: unknown;
    };

export type BedrockConflict =
  | "thinking-missing"
  | "thinking-type"
  | "thinking-extra-field"
  | "thinking-present"
  | "budget-tokens"
  | "block-binding"
  | "display"
  | "effort"
  | "effort-present"
  | "anthropic-beta";

export type BedrockOverlayVerdict =
  | {
      readonly kind: "proven";
      readonly scope: "at-overlay";
      readonly level: ThinkingLevel;
      readonly conditions: readonly BedrockCondition[];
      readonly evidence: string;
    }
  | { readonly kind: "unproven"; readonly reasons: readonly BedrockConflict[] }
  | { readonly kind: "conditional"; readonly reason: "native-unknown" }
  | { readonly kind: "not-planned"; readonly plan: BedrockLevelPlan["kind"] }
  | {
      readonly kind: "invalid-input";
      readonly code: "native" | "overlay" | "plan";
    };

type JsonRecord = Readonly<Record<string, unknown>>;
type AdaptiveTarget = Extract<BedrockTarget, { readonly kind: "adaptive" }>;
type Place =
  | { readonly kind: "unknown" }
  | { readonly kind: "standard" }
  | { readonly kind: "govcloud" };

// Canonical controls. Pi maps minimal and low both to effort low, so the low control carries both levels. off has
// no effort at all. xhigh is not in any control, because 4.6's thinkingLevelMap has no xhigh key.
type Control = {
  readonly effort: BedrockEffort | "off";
  readonly levels: readonly ThinkingLevel[];
};
const CONTROLS: readonly Control[] = Object.freeze([
  { effort: "off", levels: Object.freeze(["off"] as ThinkingLevel[]) },
  {
    effort: "low",
    levels: Object.freeze(["minimal", "low"] as ThinkingLevel[]),
  },
  { effort: "medium", levels: Object.freeze(["medium"] as ThinkingLevel[]) },
  { effort: "high", levels: Object.freeze(["high"] as ThinkingLevel[]) },
  { effort: "max", levels: Object.freeze(["max"] as ThinkingLevel[]) },
]);

const OFF_ABSENT: readonly BedrockAbsence[] = Object.freeze([
  "thinking",
  "output_config.effort",
  "anthropic_beta",
]);
const ADAPTIVE_ABSENT: readonly BedrockAbsence[] = Object.freeze([
  "thinking.budget_tokens",
  "thinking.block_binding",
  "anthropic_beta",
]);
const OFF_CONDITIONS: readonly BedrockCondition[] = Object.freeze([
  "caller-omits-reasoning-option",
]);
const DEFAULT_DISPLAY_CONDITIONS: readonly BedrockCondition[] = Object.freeze([
  "default-thinking-display",
]);
const NO_CONDITIONS: readonly BedrockCondition[] = Object.freeze([]);

const MAX_JSON_DEPTH = 32;
const PROTO_KEY = "__proto__";
const ADAPTIVE_KEYS: ReadonlySet<string> = new Set(["type", "display"]);
const NON_PLANNED_KINDS: readonly string[] = Object.freeze([
  "pending-region",
  "unsupported-level",
  "insufficient",
  "invalid-input",
]);

export function planBedrockLevel(
  candidate: unknown,
  level: unknown,
  region: unknown,
): BedrockLevelPlan {
  const read = readCandidate(candidate);
  if (read === undefined) {
    return { kind: "invalid-input", code: "candidate" };
  }
  if (!isThinkingLevel(level)) {
    return { kind: "invalid-input", code: "level" };
  }
  const place = readRegion(region);
  if (place === undefined) {
    return { kind: "invalid-input", code: "region" };
  }
  const insufficient = insufficiencyOf(read);
  if (insufficient !== undefined) {
    return { kind: "insufficient", reason: insufficient };
  }
  const control = controlFor(level);
  if (control === undefined) {
    return { kind: "unsupported-level", level };
  }
  const regionClass = regionClassFor(control.effort, place);
  if (regionClass === undefined) {
    return {
      kind: "pending-region",
      level,
      evidence: evidenceFor(read.protocolModelID, control.effort),
    };
  }
  return plannedLevel(read, level, control, regionClass);
}

// The admitted members of an inclusive range, per control. A range with no admitted level is "none", not success.
// Range candidates are not gate inputs. Once a caller explicitly chooses a member, replan that level with
// planBedrockLevel to obtain its verifiable provenance; this function makes no choice for the caller.
export function planBedrockRange(
  candidate: unknown,
  range: unknown,
  region: unknown,
): BedrockRangePlan {
  const read = readCandidate(candidate);
  if (read === undefined) {
    return { kind: "invalid-input", code: "candidate" };
  }
  if (!isRecord(range)) {
    return { kind: "invalid-input", code: "range" };
  }
  const from = ownDataValue(range, "from");
  const to = ownDataValue(range, "to");
  if (!isThinkingLevel(from) || !isThinkingLevel(to)) {
    return { kind: "invalid-input", code: "level" };
  }
  const place = readRegion(region);
  if (place === undefined) {
    return { kind: "invalid-input", code: "region" };
  }
  const insufficient = insufficiencyOf(read);
  if (insufficient !== undefined) {
    return { kind: "insufficient", reason: insufficient };
  }
  const low = THINKING_LEVELS.indexOf(from);
  const high = THINKING_LEVELS.indexOf(to);
  if (low > high) {
    return { kind: "invalid-input", code: "range" };
  }
  const admitted = CONTROLS.flatMap((control) => {
    const levels = control.levels.filter((member) => {
      const rank = THINKING_LEVELS.indexOf(member);
      return rank >= low && rank <= high;
    });
    return levels.length === 0 ? [] : [{ control, levels }];
  });
  if (admitted.length === 0) {
    return { kind: "none" };
  }
  const candidates: BedrockRangeCandidate[] = [];
  for (const { control, levels } of admitted) {
    const regionClass = regionClassFor(control.effort, place);
    if (regionClass === undefined) {
      return { kind: "pending-region" };
    }
    candidates.push(
      Object.freeze({
        compatibleLevels: control.levels,
        admittedLevels: Object.freeze([...levels]),
        target: targetFor(control.effort, regionClass === "govcloud"),
        conditions: conditionsFor(control.effort, regionClass),
        evidence: evidenceFor(read.protocolModelID, control.effort),
      }),
    );
  }
  return { kind: "range", candidates };
}

// Checks one plan against an observed native thinking field and the candidate overlay. The plan is trusted only when
// it equals the canonical plan rebuilt from its own candidate, level and region class. A native field that is unknown
// makes the result conditional. An overlay cannot remove a native key, so a conflict in the merged result is unproven.
export function verifyBedrockOverlay(
  plan: unknown,
  native: BedrockNativeThinking,
  overlay: unknown,
): BedrockOverlayVerdict {
  const planRecord = readPlanRecord(plan);
  if (planRecord === undefined) {
    return { kind: "invalid-input", code: "plan" };
  }
  const nativeFields = readNative(native);
  if (nativeFields === undefined) {
    return { kind: "invalid-input", code: "native" };
  }
  const overlayFields = readOverlay(overlay);
  if (overlayFields === undefined) {
    return { kind: "invalid-input", code: "overlay" };
  }
  const kind = ownDataValue(planRecord, "kind");
  if (kind !== "planned") {
    return isNonPlannedKind(kind)
      ? { kind: "not-planned", plan: kind }
      : { kind: "invalid-input", code: "plan" };
  }
  const canonical = canonicalPlanFor(planRecord);
  if (canonical === undefined || !isDeepStrictEqual(planRecord, canonical)) {
    return { kind: "invalid-input", code: "plan" };
  }
  if (nativeFields.kind === "unknown") {
    return { kind: "conditional", reason: "native-unknown" };
  }
  const merged = mergeOverlay(nativeFields.fields, overlayFields.fields);
  const reasons =
    canonical.target.kind === "off"
      ? offConflicts(merged)
      : adaptiveConflicts(merged, canonical.target);
  if (reasons.length > 0) {
    return { kind: "unproven", reasons };
  }
  return {
    kind: "proven",
    scope: "at-overlay",
    level: canonical.level,
    conditions: [...canonical.conditions],
    evidence: canonical.evidence,
  };
}

function plannedLevel(
  candidate: BedrockCandidate,
  level: ThinkingLevel,
  control: Control,
  regionClass: BedrockRegionClass,
): BedrockPlannedLevel {
  return Object.freeze({
    kind: "planned",
    level,
    candidate: Object.freeze({
      packageName: candidate.packageName,
      api: candidate.api,
      protocolModelID: candidate.protocolModelID,
    }),
    regionClass,
    compatibleLevels: control.levels,
    target: targetFor(control.effort, regionClass === "govcloud"),
    conditions: conditionsFor(control.effort, regionClass),
    evidence: evidenceFor(candidate.protocolModelID, control.effort),
  });
}

// The canonical plan a record must equal: its own candidate, level and region class, rebuilt from the controls.
// Off takes not-applicable, and every positive control takes standard or govcloud. Anything else is not a plan.
function canonicalPlanFor(plan: JsonRecord): BedrockPlannedLevel | undefined {
  const candidate = readCandidate(ownDataValue(plan, "candidate"));
  const level = ownDataValue(plan, "level");
  const regionClass = ownDataValue(plan, "regionClass");
  if (
    candidate === undefined ||
    insufficiencyOf(candidate) !== undefined ||
    !isThinkingLevel(level) ||
    !isRegionClass(regionClass)
  ) {
    return undefined;
  }
  const control = controlFor(level);
  if (
    control === undefined ||
    (control.effort === "off") !== (regionClass === "not-applicable")
  ) {
    return undefined;
  }
  return plannedLevel(candidate, level, control, regionClass);
}

// Pi sends display summarized in a standard region and omits it in GovCloud. Off sends no thinking fields at all.
function targetFor(
  effort: BedrockEffort | "off",
  govCloud: boolean,
): BedrockTarget {
  if (effort === "off") {
    return Object.freeze({ kind: "off", absent: OFF_ABSENT });
  }
  const thinking = govCloud
    ? Object.freeze({ type: "adaptive" as const })
    : Object.freeze({
        type: "adaptive" as const,
        display: "summarized" as const,
      });
  return Object.freeze({
    kind: "adaptive",
    thinking,
    output_config: Object.freeze({ effort }),
    absent: ADAPTIVE_ABSENT,
  });
}

// A standard adaptive target depends on the SDK default display. Off depends on a caller omitting the option. A
// GovCloud target has no display option to depend on.
function conditionsFor(
  effort: BedrockEffort | "off",
  regionClass: BedrockRegionClass,
): readonly BedrockCondition[] {
  if (effort === "off") {
    return OFF_CONDITIONS;
  }
  return regionClass === "standard"
    ? DEFAULT_DISPLAY_CONDITIONS
    : NO_CONDITIONS;
}

// Off does not read the region. A positive control needs a known region, so an unknown region returns undefined and
// the caller reports pending-region.
function regionClassFor(
  effort: BedrockEffort | "off",
  place: Place,
): BedrockRegionClass | undefined {
  if (effort === "off") {
    return "not-applicable";
  }
  if (place.kind === "unknown") {
    return undefined;
  }
  return place.kind === "govcloud" ? "govcloud" : "standard";
}

function evidenceFor(
  protocolModelID: string,
  effort: BedrockEffort | "off",
): string {
  if (effort === "off") {
    return "pi-ai@0.87.1 dist/api/bedrock-converse-stream.js buildAdditionalModelRequestFields returns no fields when options.reasoning is falsy; the caller mapping of off is outside the archive";
  }
  return `pi-ai@0.87.1 dist/providers/data/amazon-bedrock.json "bedrock-converse-stream"["${protocolModelID}"] (reasoning true, thinkingLevelMap {"max":"max"}); dist/api/bedrock-converse-stream.js buildAdditionalModelRequestFields adaptive branch and mapThinkingLevelToEffort`;
}

function controlFor(level: ThinkingLevel): Control | undefined {
  return CONTROLS.find((control) => control.levels.includes(level));
}

function readCandidate(value: unknown): BedrockCandidate | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const packageName = ownDataValue(value, "packageName");
  const api = ownDataValue(value, "api");
  const protocolModelID = ownDataValue(value, "protocolModelID");
  if (
    typeof packageName !== "string" ||
    typeof api !== "string" ||
    typeof protocolModelID !== "string"
  ) {
    return undefined;
  }
  return { packageName, api, protocolModelID };
}

function insufficiencyOf(
  candidate: BedrockCandidate,
): BedrockInsufficient | undefined {
  if (candidate.packageName !== BEDROCK_PACKAGE) {
    return "package";
  }
  if (candidate.api !== BEDROCK_API) {
    return "api";
  }
  if (!BASELINE.has(candidate.protocolModelID)) {
    return "model";
  }
  return undefined;
}

// The SDK literal: the lowercased name starts with "us-gov-". The name is neither trimmed nor validated, so a leading
// space is not GovCloud, and "us-gov" is not GovCloud either. The SDK also tests the model id against "us-gov." and
// "arn:aws-us-gov:", but no baseline id matches either prefix.
function readRegion(value: unknown): Place | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = ownDataValue(value, "kind");
  if (kind === "unknown") {
    return { kind: "unknown" };
  }
  const name = ownDataValue(value, "name");
  if (kind !== "known" || typeof name !== "string" || name === "") {
    return undefined;
  }
  return {
    kind: name.toLowerCase().startsWith("us-gov-") ? "govcloud" : "standard",
  };
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly unknown[]).includes(value);
}

function isRegionClass(value: unknown): value is BedrockRegionClass {
  return (
    value === "standard" || value === "govcloud" || value === "not-applicable"
  );
}

function isNonPlannedKind(
  value: unknown,
): value is Exclude<BedrockLevelPlan["kind"], "planned"> {
  return typeof value === "string" && NON_PLANNED_KINDS.includes(value);
}

// A plan must be a plain JSON record with own data properties. Anything else is refused before a field is read.
function readPlanRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) && isJsonValue(value, 0) ? value : undefined;
}

type NativeRead =
  | { readonly kind: "unknown" }
  | { readonly kind: "observed"; readonly fields: JsonRecord | undefined };

function readNative(value: unknown): NativeRead | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const kind = ownDataValue(value, "kind");
  if (kind === "unknown") {
    return { kind: "unknown" };
  }
  if (kind !== "observed") {
    return undefined;
  }
  const field = optionalOwnData(value, "additionalModelRequestFields");
  if (!field.ok) {
    return undefined;
  }
  if (field.value === undefined) {
    return { kind: "observed", fields: undefined };
  }
  return isRecord(field.value) && isJsonValue(field.value, 0)
    ? { kind: "observed", fields: field.value }
    : undefined;
}

function readOverlay(
  value: unknown,
): { readonly fields: JsonRecord | undefined } | undefined {
  if (value === undefined) {
    return { fields: undefined };
  }
  return isRecord(value) && isJsonValue(value, 0)
    ? { fields: value }
    : undefined;
}

// Mirrors mergeJsonRecords (see the header): an undefined overlay value keeps the base, nested records merge, and any
// other value replaces. A record that merges to nothing is left as undefined, so its key is absent, as on the wire. The
// result is new, so no input is copied back or mutated.
function mergeOverlay(
  base: JsonRecord | undefined,
  overlay: JsonRecord | undefined,
): JsonRecord | undefined {
  if (base === undefined) {
    return overlay;
  }
  if (overlay === undefined) {
    return base;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const value = ownDataValue(overlay, key);
    if (value === undefined) {
      continue;
    }
    const current = ownDataValue(merged, key);
    merged[key] =
      isRecord(current) && isRecord(value)
        ? mergeOverlay(current, value)
        : value;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

function adaptiveConflicts(
  merged: JsonRecord | undefined,
  target: AdaptiveTarget,
): readonly BedrockConflict[] {
  const reasons = new Set<BedrockConflict>();
  const thinking = present(merged, "thinking");
  if (thinking === undefined) {
    reasons.add("thinking-missing");
  } else if (!isRecord(thinking)) {
    reasons.add("thinking-type");
  } else {
    if (present(thinking, "type") !== "adaptive") {
      reasons.add("thinking-type");
    }
    for (const key of Object.keys(thinking)) {
      if (present(thinking, key) === undefined || ADAPTIVE_KEYS.has(key)) {
        continue;
      }
      if (key === "budget_tokens") {
        reasons.add("budget-tokens");
      } else if (key === "block_binding") {
        reasons.add("block-binding");
      } else {
        reasons.add("thinking-extra-field");
      }
    }
    const display = present(thinking, "display");
    const wanted = target.thinking.display;
    if (wanted === undefined ? display !== undefined : display !== wanted) {
      reasons.add("display");
    }
  }
  const outputConfig = present(merged, "output_config");
  if (
    !isRecord(outputConfig) ||
    present(outputConfig, "effort") !== target.output_config.effort
  ) {
    reasons.add("effort");
  }
  if (present(merged, "anthropic_beta") !== undefined) {
    reasons.add("anthropic-beta");
  }
  return [...reasons];
}

// Off means the absence of every Pi thinking field. Other output_config fields are unrelated and kept. A disabled
// block is still present, so it conflicts: absence is not the same as false, disabled or null.
function offConflicts(
  merged: JsonRecord | undefined,
): readonly BedrockConflict[] {
  const reasons = new Set<BedrockConflict>();
  if (present(merged, "thinking") !== undefined) {
    reasons.add("thinking-present");
  }
  const outputConfig = present(merged, "output_config");
  if (
    outputConfig !== undefined &&
    (!isRecord(outputConfig) || present(outputConfig, "effort") !== undefined)
  ) {
    reasons.add("effort-present");
  }
  if (present(merged, "anthropic_beta") !== undefined) {
    reasons.add("anthropic-beta");
  }
  return [...reasons];
}

// The own data value of a key, where undefined means absent. Inherited properties are never read as JSON fields.
function present(record: JsonRecord | undefined, key: string): unknown {
  return record === undefined ? undefined : ownDataValue(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Reads an own data property only. An accessor is never invoked, so a getter cannot run during planning.
function ownDataValue(record: object, key: string): unknown {
  const field = optionalOwnData(record, key);
  return field.ok ? field.value : undefined;
}

// Distinguishes an absent key (ok, undefined) from an accessor (not ok), which must fail closed when it is read.
function optionalOwnData(
  record: object,
  key: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    return { ok: true, value: undefined };
  }
  return "value" in descriptor
    ? { ok: true, value: descriptor.value }
    : { ok: false };
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_JSON_DEPTH) {
    return false;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return isJsonArray(value, depth);
  }
  return isRecord(value) && isJsonObject(value, depth);
}

function isJsonArray(value: readonly unknown[], depth: number): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      return false;
    }
    if (!isJsonValue(descriptor.value, depth + 1)) {
      return false;
    }
  }
  return true;
}

// A JSON object: every own key is an enumerable data property, and no key is __proto__. An undefined value is absent,
// as in the merge.
function isJsonObject(value: object, depth: number): boolean {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol" || key === PROTO_KEY) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return false;
    }
    if (
      descriptor.value !== undefined &&
      !isJsonValue(descriptor.value, depth + 1)
    ) {
      return false;
    }
  }
  return true;
}

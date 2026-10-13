import { BEDROCK_API, BEDROCK_PACKAGE } from "./bedrock.js";

// Pure arithmetic and target description for Bedrock Claude models that Pi 0.87.1 sends with manual (non-adaptive)
// thinking budgets through streamSimple. The arithmetic follows simple-options.js (clampMaxTokensToContext,
// thinkingBudgetForLevel, adjustMaxTokensForThinking) and bedrock-converse-stream.js (streamSimple, the non-adaptive
// branch of buildAdditionalModelRequestFields). The archive is read as text and is never imported or executed.
//
// This module computes arithmetic over explicit inputs. It does not prove that the caller's cap, the context estimate,
// the region, the client, the endpoint, the authentication, the serialized body or the provider behave as Pi does.
// Those remain unresolved conditions. Nothing here reads an environment, a credential or AWS configuration, calls a
// provider, or registers a family. The estimate, the caller cap, the native cap and the region are supplied by a caller
// that owns their provenance.
//
// The estimate is a supplied number. Pi computes it from messages (utils/estimate.js, estimateContextTokens); this module
// does not implement that estimator and never assumes zero for an unknown value.
//
// Local input preconditions, not Pi source requirements:
// - the custom budget record is undefined, or a plain object whose own enumerable data properties are exactly the
//   positive levels, each a finite non-negative number; a null or undefined entry, an accessor, an unknown key, an array
//   or a null record is invalid. Missing keys take the source defaults;
// - the model maximum is finite and positive; the context window is finite; a positive window needs a finite
//   non-negative estimate; a non-positive window does not read the estimate;
// - the caller cap is absent (undefined or null), or a finite non-negative number, or unknown.
// Fractions are not rounded, because the source does not round.
//
// Pi's source applies no rounding. Any non-finite derived value is reported as invalid, never replaced with zero or null.

export const BUDGET_LEVELS = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
] as const);
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export type ManualLevel = "off" | BudgetLevel;

// simple-options.js lines 38-43: the default budget for each positive level.
export const BUDGET_DEFAULTS: Readonly<Record<BudgetLevel, number>> =
  Object.freeze({
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
  });

const SNAPSHOT = "pi-ai@0.87.1";
const CONTEXT_SAFETY_TOKENS = 4096; // simple-options.js line 2
const MIN_MAX_TOKENS = 1; // simple-options.js line 3
const MIN_ANSWER_TOKENS = 1024; // simple-options.js line 37
const NATIVE_FIT_MINIMUM = 1024; // OpenCode bedrock-converse.ts MIN_THINKING_BUDGET, passed to fitThinkingBudget
const CONTEXT_WINDOW = 200000; // every scoped catalogue row has this window (0.87.1 amazon-bedrock.json)
const INTERLEAVED_BETA = "interleaved-thinking-2025-05-14";
const BUDGET_FORMULA =
  "pi-ai@0.87.1 simple-options.js adjustMaxTokensForThinking; bedrock-converse-stream.js streamSimple non-adaptive Claude branch";
const OFF_FORMULA = "pi-ai@0.87.1 streamSimple !options.reasoning branch";

type CanonicalLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
const CANONICAL_ORDER: readonly CanonicalLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// ----- Public input and result types -----

// Untrusted inputs are typed unknown; every one is validated before use.
export type BudgetFrameInput = {
  readonly modelMaxTokens: unknown;
  readonly contextWindow: unknown;
  readonly estimate: unknown;
  readonly callerCap: unknown;
};
export type BudgetInput = BudgetFrameInput & {
  readonly level: unknown;
  readonly custom?: unknown;
};

export type BudgetStages = {
  readonly base: number;
  readonly B0: number;
  readonly m1: number;
  readonly B: number;
  readonly M: number;
  readonly W: number;
  readonly room: number | null;
};
export type OffStages = { readonly M: number; readonly room: number | null };

export type BudgetInvalidCode =
  | "level"
  | "custom"
  | "model-max"
  | "context-window"
  | "estimate"
  | "caller-cap"
  | "derived";
export type BudgetFailure =
  | { readonly kind: "invalid-input"; readonly code: BudgetInvalidCode }
  | { readonly kind: "insufficient"; readonly reason: "estimate-unknown" }
  | { readonly kind: "conditional"; readonly unresolved: "caller-cap" };

export type BudgetResult =
  | {
      readonly kind: "calculated";
      readonly basis: "reference-calculation";
      readonly formula: string;
      readonly stages: BudgetStages;
    }
  | BudgetFailure;

export type OffResult =
  | {
      readonly kind: "calculated";
      readonly basis: "reference-calculation";
      readonly formula: string;
      readonly stages: OffStages;
    }
  | BudgetFailure;

// ----- Scoped catalogue (0.87.1, 22 non-adaptive Claude rows) -----

export type ManualRow = {
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
};

const MANUAL_ROWS: readonly ManualRow[] = [
  {
    protocolModelID: "anthropic.claude-haiku-4-5-20251001-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "anthropic.claude-opus-4-1-20250805-v1:0",
    modelMaxTokens: 32000,
  },
  {
    protocolModelID: "anthropic.claude-opus-4-5-20251101-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "apac.anthropic.claude-sonnet-4-20250514-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "au.anthropic.claude-haiku-4-5-20251001-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "au.anthropic.claude-sonnet-4-5-20250929-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "eu.anthropic.claude-opus-4-5-20251101-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "eu.anthropic.claude-sonnet-4-20250514-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "global.anthropic.claude-opus-4-5-20251101-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "global.anthropic.claude-sonnet-4-20250514-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "jp.anthropic.claude-sonnet-4-5-20250929-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "us.anthropic.claude-opus-4-1-20250805-v1:0",
    modelMaxTokens: 32000,
  },
  {
    protocolModelID: "us.anthropic.claude-opus-4-5-20251101-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "us.anthropic.claude-sonnet-4-20250514-v1:0",
    modelMaxTokens: 64000,
  },
  {
    protocolModelID: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    modelMaxTokens: 64000,
  },
];

// Each row is a fresh frozen copy made at construction, so no caller can change a row's cap or identity later.
export const MANUAL_CATALOGUE: readonly ManualRow[] = Object.freeze(
  MANUAL_ROWS.map((row) => Object.freeze({ ...row })),
);
const MANUAL_BY_ID: ReadonlyMap<string, ManualRow> = new Map(
  MANUAL_CATALOGUE.map((row) => [row.protocolModelID, row]),
);

// ----- Planner types -----

export type ConfiguredRegion =
  | {
      readonly kind: "configured";
      readonly name: string;
      readonly provenance: "pi-display-env";
    }
  | { readonly kind: "proven-absent"; readonly provenance: "pi-display-env" }
  | { readonly kind: "unknown" };

// The actual native cap is an observation supplied by the caller. A known value is any finite number, including zero
// and negatives, because the native body schema accepts any number. It is only compared with Pi's cap: it never
// changes Pi's cap and never fills the caller cap. A negative value is therefore reported as pi-exceeds-native.
export type NativeCap =
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly value: number }
  | { readonly kind: "unknown" };

export type DisplayField = "summarized" | "omitted" | "unresolved";

export type ManualCondition =
  | "estimate-supplied"
  | "caller-omits-reasoning-option"
  | "default-thinking-display"
  | "display-region-unresolved"
  | "provider-budget-unproven"
  | "native-thinking-unobserved"
  | "client-resolution-unresolved";

export type ManualTarget =
  | {
      readonly kind: "enabled";
      readonly thinking: {
        readonly type: "enabled";
        readonly budget_tokens: number;
      };
      readonly displayField: DisplayField;
      readonly anthropic_beta: readonly [typeof INTERLEAVED_BETA];
      readonly absent: readonly string[];
    }
  | {
      readonly kind: "omitted-reasoning";
      readonly absent: readonly string[];
    };

export type CapRelation =
  | "equal"
  | "pi-exceeds-native"
  | "pi-below-native"
  | "native-absent"
  | "native-unknown";
export type HostCap = {
  readonly relation: CapRelation;
  readonly capPreservation: "met" | "blocked" | "not-established";
};

export type NativeFit =
  | { readonly kind: "not-applicable" }
  | { readonly kind: "unknown" }
  | { readonly kind: "value"; readonly value: number };

export type ManualPlanned = {
  readonly kind: "planned";
  readonly basis: "pi-ai@0.87.1 catalogue row";
  readonly protocolModelID: string;
  readonly level: ManualLevel;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly stages: BudgetStages | OffStages;
  readonly target: ManualTarget;
  readonly compatibleLevels: readonly ManualLevel[];
  readonly piCap: number;
  readonly nativeFit: NativeFit;
  readonly hostCap: HostCap;
  readonly conditions: readonly ManualCondition[];
  readonly evidence: string;
};

export type ManualRangeCandidate = {
  readonly compatibleLevels: readonly ManualLevel[];
  readonly admittedLevels: readonly ManualLevel[];
  readonly piCap: number;
  readonly target: ManualTarget;
  readonly hostCap: HostCap;
  readonly conditions: readonly ManualCondition[];
};
export type ManualRangePlan = {
  readonly kind: "range";
  readonly protocolModelID: string;
  readonly candidates: readonly ManualRangeCandidate[];
};

export type ManualInvalidCode =
  | BudgetInvalidCode
  | "candidate"
  | "request"
  | "region"
  | "native-cap"
  | "range";
export type ManualFailure =
  | BudgetFailure
  | {
      readonly kind: "insufficient";
      readonly reason: "package" | "api" | "model";
    }
  | { readonly kind: "invalid-input"; readonly code: ManualInvalidCode }
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly level: "xhigh" | "max";
    };

export type ManualPlan = ManualPlanned | ManualRangePlan | ManualFailure;

// ----- Arithmetic helper -----

type Frame = {
  readonly modelMax: number;
  readonly room: number | null;
  readonly base: number;
  readonly ctx: (value: number) => number;
};

type CustomRead =
  | {
      readonly ok: true;
      readonly budgets: Partial<Record<BudgetLevel, number>>;
    }
  | { readonly ok: false };

// Computes the Pi virtual cap M and the budget W for one positive level. Every intermediate stage is returned.
export function calculateBudget(input: BudgetInput): BudgetResult {
  const level = input.level;
  if (!isBudgetLevel(level)) {
    return invalid("level");
  }
  const custom = readCustom(input.custom);
  if (!custom.ok) {
    return invalid("custom");
  }
  const frame = frameOf(input);
  if (!isFrame(frame)) {
    return frame;
  }
  // Validated budgets are finite numbers, so a present level always overrides the default and an absent one never does.
  const override = custom.budgets[level];
  const B0 = override === undefined ? BUDGET_DEFAULTS[level] : override;
  const m1 = Math.min(frame.base + B0, frame.modelMax);
  const B = m1 <= B0 ? Math.min(B0, Math.max(0, m1 - MIN_ANSWER_TOKENS)) : B0;
  const M = frame.ctx(m1);
  const W = Math.min(B, Math.max(0, M - MIN_ANSWER_TOKENS));
  const stages: BudgetStages = {
    base: frame.base,
    B0,
    m1,
    B,
    M,
    W,
    room: frame.room,
  };
  if (!allFinite([frame.base, B0, m1, B, M, W])) {
    return invalid("derived");
  }
  return {
    kind: "calculated",
    basis: "reference-calculation",
    formula: BUDGET_FORMULA,
    stages,
  };
}

// The canonical off cap: the same ctx applied to the caller cap or the model maximum. Off has no budget stages and does
// not read a level, so the string "off" never enters the budget calculator.
export function calculateOffCap(input: BudgetFrameInput): OffResult {
  const frame = frameOf(input);
  if (!isFrame(frame)) {
    return frame;
  }
  return {
    kind: "calculated",
    basis: "reference-calculation",
    formula: OFF_FORMULA,
    stages: { M: frame.base, room: frame.room },
  };
}

function frameOf(input: BudgetFrameInput): Frame | BudgetFailure {
  const modelMax = input.modelMaxTokens;
  if (!isFinitePositive(modelMax)) {
    return invalid("model-max");
  }
  const contextWindow = input.contextWindow;
  if (!isFiniteNumber(contextWindow)) {
    return invalid("context-window");
  }
  let room: number | null = null;
  if (contextWindow > 0) {
    const tokens = readEstimate(input.estimate);
    if (tokens === "unknown") {
      return { kind: "insufficient", reason: "estimate-unknown" };
    }
    if (tokens === undefined) {
      return invalid("estimate");
    }
    room = contextWindow - tokens - CONTEXT_SAFETY_TOKENS;
  }
  const callerCap = readCallerCap(input.callerCap);
  if (callerCap === undefined) {
    return invalid("caller-cap");
  }
  if (callerCap === "unknown") {
    return { kind: "conditional", unresolved: "caller-cap" };
  }
  const ctx = (value: number): number =>
    room === null
      ? Math.max(MIN_MAX_TOKENS, value)
      : Math.min(value, Math.max(MIN_MAX_TOKENS, room));
  const capSource = callerCap === "absent" ? modelMax : callerCap;
  return { modelMax, room, base: ctx(capSource), ctx };
}

// ----- Scoped planner -----

// Plans one canonical level for a scoped catalogue row. The row's maximum and window are fixed; a caller cannot edit them.
export function planBedrockManualLevel(
  candidate: unknown,
  level: unknown,
  request: unknown,
): ManualPlan {
  const row = rowOf(candidate);
  if (!("protocolModelID" in row)) {
    return row;
  }
  if (!isCanonicalLevel(level)) {
    return invalid("level");
  }
  if (level === "xhigh" || level === "max") {
    return { kind: "unsupported-in-snapshot", level };
  }
  const evaluated = evaluate(row, request, level !== "off");
  if (!("levels" in evaluated)) {
    return evaluated;
  }
  const data = evaluated.levels.find((entry) => entry.level === level);
  if (data === undefined) {
    return invalid("level");
  }
  return plannedOf(row, evaluated, data);
}

// Every admitted control of an inclusive range, each with its full compatible set. Nothing is selected.
export function planBedrockManualRange(
  candidate: unknown,
  range: unknown,
  request: unknown,
): ManualPlan {
  const row = rowOf(candidate);
  if (!("protocolModelID" in row)) {
    return row;
  }
  // A range is a plain object with its own fields. Anything else is a range error, not a guess at its endpoints.
  if (typeof range !== "object" || range === null || Array.isArray(range)) {
    return invalid("range");
  }
  const from = readOwn(range, "from");
  const to = readOwn(range, "to");
  if (!isCanonicalLevel(from) || !isCanonicalLevel(to)) {
    return invalid("level");
  }
  const low = CANONICAL_ORDER.indexOf(from);
  const high = CANONICAL_ORDER.indexOf(to);
  if (low > high) {
    return invalid("range");
  }
  const span = CANONICAL_ORDER.slice(low, high + 1);
  const unsupported = span.find(isUnsupportedLevel);
  if (unsupported !== undefined) {
    return { kind: "unsupported-in-snapshot", level: unsupported };
  }
  const inRange = (value: ManualLevel): boolean => {
    const rank = CANONICAL_ORDER.indexOf(value);
    return rank >= low && rank <= high;
  };
  const evaluated = evaluate(
    row,
    request,
    span.some((entry) => entry !== "off"),
  );
  if (!("levels" in evaluated)) {
    return evaluated;
  }
  const candidates: ManualRangeCandidate[] = [];
  const seen = new Set<string>();
  for (const data of evaluated.levels) {
    if (!inRange(data.level)) {
      continue;
    }
    const key = data.groupKey ?? data.level;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const group = groupOf(evaluated.levels, data);
    candidates.push({
      compatibleLevels: group.map((entry) => entry.level),
      admittedLevels: group
        .filter((entry) => inRange(entry.level))
        .map((entry) => entry.level),
      piCap: data.piCap,
      target: targetOf(data),
      hostCap: hostCapOf(data.piCap, evaluated.native),
      conditions: conditionsOf(data),
    });
  }
  return { kind: "range", protocolModelID: row.protocolModelID, candidates };
}

// Off carries no budget and no display: it never reads custom or region.
type OffLevel = {
  readonly level: "off";
  readonly piCap: number;
  readonly budgetTokens: undefined;
  readonly stages: OffStages;
  readonly groupKey: undefined;
};
// A positive level carries the display its region resolved to, so only positive targets depend on it.
type PositiveLevel = {
  readonly level: BudgetLevel;
  readonly piCap: number;
  readonly budgetTokens: number;
  readonly stages: BudgetStages;
  readonly groupKey: string;
  readonly displayField: DisplayField;
};
type LevelData = OffLevel | PositiveLevel;

type Evaluated = {
  readonly levels: readonly LevelData[];
  readonly native: NativeCap;
};

// Computes off always, and the four positive levels only when a budget is needed. Off never reads custom budgets.
function evaluate(
  row: ManualRow,
  request: unknown,
  needsBudgets: boolean,
): Evaluated | ManualFailure {
  if (typeof request !== "object" || request === null) {
    return invalid("request");
  }
  const estimate = readOwn(request, "estimate");
  const callerCap = readOwn(request, "callerCap");
  if (estimate === UNREADABLE || callerCap === UNREADABLE) {
    return invalid(estimate === UNREADABLE ? "estimate" : "caller-cap");
  }
  const native = nativeOf(readOwn(request, "nativeCap"));
  if (native === undefined) {
    return invalid("native-cap");
  }
  const frameInput: BudgetFrameInput = {
    modelMaxTokens: row.modelMaxTokens,
    contextWindow: CONTEXT_WINDOW,
    estimate,
    callerCap,
  };
  const off = calculateOffCap(frameInput);
  if (off.kind !== "calculated") {
    return off;
  }
  const levels: LevelData[] = [
    {
      level: "off",
      piCap: off.stages.M,
      budgetTokens: undefined,
      stages: off.stages,
      groupKey: undefined,
    },
  ];
  if (!needsBudgets) {
    return { levels, native };
  }
  // Custom and region are read only when a positive level is planned, so off never depends on them.
  const custom = readOwn(request, "custom");
  if (custom === UNREADABLE) {
    return invalid("custom");
  }
  const place = placeOf(readOwn(request, "region"));
  if (place === undefined) {
    return invalid("region");
  }
  for (const level of BUDGET_LEVELS) {
    const result = calculateBudget({ ...frameInput, level, custom });
    if (result.kind !== "calculated") {
      return result;
    }
    levels.push({
      level,
      piCap: result.stages.M,
      budgetTokens: result.stages.W,
      stages: result.stages,
      groupKey: `${result.stages.W}|${result.stages.M}`,
      displayField: displayOf(place),
    });
  }
  return { levels, native };
}

// Levels with the same target controls and the same Pi cap under the same inputs. B0 is not a wire control, so it is
// not part of the key. Off is never grouped with a positive level.
function groupOf(
  levels: readonly LevelData[],
  data: LevelData,
): readonly LevelData[] {
  return levels.filter(
    (other) =>
      other === data ||
      (data.groupKey !== undefined && other.groupKey === data.groupKey),
  );
}

function plannedOf(
  row: ManualRow,
  evaluated: Evaluated,
  data: LevelData,
): ManualPlanned {
  const group = groupOf(evaluated.levels, data);
  return {
    kind: "planned",
    basis: "pi-ai@0.87.1 catalogue row",
    protocolModelID: row.protocolModelID,
    level: data.level,
    modelMaxTokens: row.modelMaxTokens,
    contextWindow: CONTEXT_WINDOW,
    stages: data.stages,
    target: targetOf(data),
    compatibleLevels: group.map((entry) => entry.level),
    piCap: data.piCap,
    nativeFit: nativeFitOf(data.budgetTokens, evaluated.native),
    hostCap: hostCapOf(data.piCap, evaluated.native),
    conditions: conditionsOf(data),
    evidence: evidenceOf(row.protocolModelID, data.level),
  };
}

function targetOf(data: LevelData): ManualTarget {
  if (data.level === "off") {
    return {
      kind: "omitted-reasoning",
      absent: ["thinking", "anthropic_beta", "output_config.effort"],
    };
  }
  return {
    kind: "enabled",
    thinking: { type: "enabled", budget_tokens: data.budgetTokens },
    displayField: data.displayField,
    anthropic_beta: [INTERLEAVED_BETA],
    absent: ["output_config.effort", "thinking.block_binding"],
  };
}

function conditionsOf(data: LevelData): readonly ManualCondition[] {
  const conditions: ManualCondition[] = [
    "estimate-supplied",
    "native-thinking-unobserved",
    "client-resolution-unresolved",
  ];
  if (data.level === "off") {
    conditions.push("caller-omits-reasoning-option");
    return conditions;
  }
  if (data.displayField === "summarized") {
    conditions.push("default-thinking-display");
  }
  if (data.displayField === "unresolved") {
    conditions.push("display-region-unresolved");
  }
  if (data.budgetTokens < MIN_ANSWER_TOKENS) {
    conditions.push("provider-budget-unproven");
  }
  return conditions;
}

function hostCapOf(piCap: number, native: NativeCap): HostCap {
  if (native.kind === "absent") {
    return { relation: "native-absent", capPreservation: "not-established" };
  }
  if (native.kind === "unknown") {
    return { relation: "native-unknown", capPreservation: "not-established" };
  }
  if (piCap === native.value) {
    return { relation: "equal", capPreservation: "met" };
  }
  if (piCap > native.value) {
    return { relation: "pi-exceeds-native", capPreservation: "blocked" };
  }
  return { relation: "pi-below-native", capPreservation: "blocked" };
}

// The native fit that OpenCode would apply to the same budget at the same native cap (shared.ts fitThinkingBudget).
// Informational only: it is not compared with the Pi budget as a verdict.
function nativeFitOf(budget: number | undefined, native: NativeCap): NativeFit {
  if (budget === undefined) {
    return { kind: "not-applicable" };
  }
  if (native.kind === "unknown") {
    return { kind: "unknown" };
  }
  if (native.kind === "absent") {
    return { kind: "value", value: budget };
  }
  const fitted =
    budget <= native.value / 2
      ? budget
      : Math.max(NATIVE_FIT_MINIMUM, Math.floor(native.value / 2));
  return { kind: "value", value: fitted };
}

function evidenceOf(protocolModelID: string, level: ManualLevel): string {
  if (level === "off") {
    return `${SNAPSHOT} dist/api/bedrock-converse-stream.js streamSimple !options.reasoning branch; the caller mapping of off is outside the archive`;
  }
  return `${SNAPSHOT} dist/providers/data/amazon-bedrock.json "bedrock-converse-stream"["${protocolModelID}"] (reasoning true, no thinkingLevelMap, contextWindow 200000); dist/api/bedrock-converse-stream.js streamSimple and non-adaptive branch; dist/api/simple-options.js clampMaxTokensToContext and adjustMaxTokensForThinking; dist/models.js getSupportedThinkingLevels`;
}

// ----- Input readers: own data only, accessors and missing containers fail closed -----

const UNREADABLE: unique symbol = Symbol("unreadable");

function readOwn(record: unknown, key: string): unknown {
  if (typeof record !== "object" || record === null) {
    return UNREADABLE;
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    return undefined;
  }
  return "value" in descriptor ? descriptor.value : UNREADABLE;
}

function rowOf(candidate: unknown): ManualRow | ManualFailure {
  const packageName = readOwn(candidate, "packageName");
  const api = readOwn(candidate, "api");
  const protocolModelID = readOwn(candidate, "protocolModelID");
  if (
    typeof packageName !== "string" ||
    typeof api !== "string" ||
    typeof protocolModelID !== "string"
  ) {
    return invalid("candidate");
  }
  if (packageName !== BEDROCK_PACKAGE) {
    return { kind: "insufficient", reason: "package" };
  }
  if (api !== BEDROCK_API) {
    return { kind: "insufficient", reason: "api" };
  }
  const row = MANUAL_BY_ID.get(protocolModelID);
  if (row === undefined) {
    return { kind: "insufficient", reason: "model" };
  }
  return row;
}

// The caller cap: undefined or null is absent (as Pi's ?? treats them); unknown stays unknown.
function readCallerCap(
  value: unknown,
): "absent" | "unknown" | number | undefined {
  if (value === undefined || value === null) {
    return "absent";
  }
  const kind = readOwn(value, "kind");
  if (kind === "absent") {
    return "absent";
  }
  if (kind === "unknown") {
    return "unknown";
  }
  if (kind === "known") {
    const cap = readOwn(value, "value");
    return isNonNegativeFinite(cap) ? cap : undefined;
  }
  return undefined;
}

function readEstimate(value: unknown): "unknown" | number | undefined {
  const kind = readOwn(value, "kind");
  if (kind === "unknown") {
    return "unknown";
  }
  if (kind !== "supplied") {
    return undefined;
  }
  const tokens = readOwn(value, "tokens");
  return isNonNegativeFinite(tokens) ? tokens : undefined;
}

function readCustom(value: unknown): CustomRead {
  if (value === undefined) {
    return { ok: true, budgets: {} };
  }
  if (!isPlainRecord(value)) {
    return { ok: false };
  }
  const budgets: Partial<Record<BudgetLevel, number>> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !isBudgetLevel(key)) {
      return { ok: false };
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return { ok: false };
    }
    const entry = descriptor.value;
    if (!isNonNegativeFinite(entry)) {
      return { ok: false };
    }
    budgets[key] = entry;
  }
  return { ok: true, budgets };
}

type Place =
  | { readonly kind: "configured"; readonly govCloud: boolean }
  | { readonly kind: "proven-absent" }
  | { readonly kind: "unknown" };

// The SDK literal: the lowercased configured name starts with "us-gov-". The name is neither trimmed nor validated.
function placeOf(value: unknown): Place | undefined {
  const kind = readOwn(value, "kind");
  if (kind === "unknown") {
    return { kind: "unknown" };
  }
  if (kind === "proven-absent") {
    return readOwn(value, "provenance") === "pi-display-env"
      ? { kind: "proven-absent" }
      : undefined;
  }
  if (kind === "configured") {
    const name = readOwn(value, "name");
    if (
      typeof name !== "string" ||
      name === "" ||
      readOwn(value, "provenance") !== "pi-display-env"
    ) {
      return undefined;
    }
    return {
      kind: "configured",
      govCloud: name.toLowerCase().startsWith("us-gov-"),
    };
  }
  return undefined;
}

function displayOf(place: Place): DisplayField {
  if (place.kind === "configured") {
    return place.govCloud ? "omitted" : "summarized";
  }
  return place.kind === "proven-absent" ? "summarized" : "unresolved";
}

function nativeOf(value: unknown): NativeCap | undefined {
  const kind = readOwn(value, "kind");
  if (kind === "absent") {
    return { kind: "absent" };
  }
  if (kind === "unknown") {
    return { kind: "unknown" };
  }
  if (kind === "known") {
    const cap = readOwn(value, "value");
    return isFiniteNumber(cap) ? { kind: "known", value: cap } : undefined;
  }
  return undefined;
}

// ----- Guards and small helpers -----

function invalid<Code extends ManualInvalidCode>(
  code: Code,
): { readonly kind: "invalid-input"; readonly code: Code } {
  return { kind: "invalid-input", code };
}

function isFrame(value: Frame | BudgetFailure): value is Frame {
  return "ctx" in value;
}

function isBudgetLevel(value: unknown): value is BudgetLevel {
  return (BUDGET_LEVELS as readonly unknown[]).includes(value);
}

function isCanonicalLevel(value: unknown): value is CanonicalLevel {
  return (CANONICAL_ORDER as readonly unknown[]).includes(value);
}

function isUnsupportedLevel(value: CanonicalLevel): value is "xhigh" | "max" {
  return value === "xhigh" || value === "max";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFinitePositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allFinite(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

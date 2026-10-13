import { BEDROCK_API, BEDROCK_PACKAGE } from "./bedrock.js";

// Pure source planner for the 54 non-Claude Bedrock reasoning rows of Pi 0.87.1 (amazon-bedrock.json, reasoning true,
// no Claude id). For these rows Pi's request builder returns no thinking field for any logical level:
// buildAdditionalModelRequestFields (bedrock-converse-stream.js) returns undefined for every non-Claude model. The planner
// records that builder fact as the target "pi-builder-emits-no-thinking-control". It does not claim that the request has
// no thinking control. A caller overlay on http.body, native thinking settings, a host compatibility flag, an onPayload
// hook and a module override can each add one, so every result lists those conditions.
//
// The cap follows two Pi source paths. The simple path (streamSimple, then buildBaseOptions and clampMaxTokensToContext in
// simple-options.js) defaults to the catalogue maximum and clamps to the window. The raw path (stream, inferenceMaxTokens)
// sends only the caller's cap and has no default and no clamp. Neither path reads the logical level. The arithmetic is
// written here as a neutral formula. It does not reuse the Claude budget module, whose off-branch label does not describe
// these rows.
//
// Local input contract, not Pi source requirements and not an emulation of how the SDK treats malformed numbers:
// - the caller cap is an explicit { kind: "absent" }, { kind: "known", value } or { kind: "unknown" }; a missing or null
//   caller cap is invalid, never absence by default;
// - the estimate is { kind: "supplied", tokens } or { kind: "unknown" }; it is read only on the simple path with a
//   positive window; a non-positive window ignores it;
// - numbers are finite and are not rounded. Caller caps and estimates are non-negative; a caller cap may exceed the
//   catalogue maximum, as Pi's source does not clamp it there.
//
// Nothing here reads an environment, a credential or AWS configuration, calls a provider, or proves a role. Results never
// echo rejected inputs in failures; invalid input yields a fixed code.

export const NO_CONTROL_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);
export type NoControlLevel = (typeof NO_CONTROL_LEVELS)[number];

export const NO_CONTROL_TARGET =
  "pi-builder-emits-no-thinking-control" as const;

export const NO_CONTROL_CONDITIONS = Object.freeze([
  "pi-on-payload-replacement",
  "lazy-module-override",
  "native-thinking-settings",
  "host-compatibility-binding",
  "body-overlay-control-fields",
  "body-overlay-cap",
  "caller-cap-provenance",
  "estimate-provenance",
  "effective-cap-unobserved",
  "later-stage-and-peer-rewrites",
] as const);
export type NoControlCondition = (typeof NO_CONTROL_CONDITIONS)[number];

export type NoControlPath = "simple" | "raw";

export type CallerCap =
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly value: number }
  | { readonly kind: "unknown" };

export type EstimateInput =
  | { readonly kind: "supplied"; readonly tokens: number }
  | { readonly kind: "unknown" };

export type NoControlRow = {
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly supportedLevels: readonly NoControlLevel[];
};

export type NoControlInvalidCode =
  | "candidate"
  | "level"
  | "range"
  | "request"
  | "caller-cap"
  | "estimate"
  | "model-max"
  | "context-window"
  | "derived";

export type NoControlCap =
  | {
      readonly kind: "calculated";
      readonly path: NoControlPath;
      readonly value: number;
      readonly basis: "source-path";
      readonly source: string;
    }
  | {
      readonly kind: "absent";
      readonly path: "raw";
      readonly basis: "source-path";
    }
  | {
      readonly kind: "unresolved";
      readonly unresolved: "caller-cap" | "estimate";
    };

export type NoControlCapResult =
  | NoControlCap
  | { readonly kind: "invalid-input"; readonly code: NoControlInvalidCode };

export type NoControlPlanned = {
  readonly kind: "planned";
  readonly target: typeof NO_CONTROL_TARGET;
  readonly path: NoControlPath;
  // The requested levels that the row advertises. A range is intersected; nothing is selected.
  readonly admittedLevels: readonly NoControlLevel[];
  // The row's advertised levels. Every one of them shares the builder result, so this is also the compatible set.
  readonly supportedLevels: readonly NoControlLevel[];
  readonly compatibleLevels: readonly NoControlLevel[];
  // Pi's builder gives the same result for all seven canonical levels, including those not advertised. Kept as evidence.
  readonly serializerEquivalentLevels: readonly NoControlLevel[];
  readonly cap: NoControlCap;
  readonly conditions: readonly NoControlCondition[];
};

export type NoControlPlan =
  | NoControlPlanned
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly scope: "level" | "range";
    }
  | {
      readonly kind: "insufficient";
      readonly reason: "package" | "api" | "model";
    }
  | { readonly kind: "invalid-input"; readonly code: NoControlInvalidCode };

// ----- Catalogue -----

const UNMAPPED_LEVELS: readonly NoControlLevel[] = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
]);
const XHIGH_MAPPED_LEVELS: readonly NoControlLevel[] = Object.freeze([
  ...UNMAPPED_LEVELS,
  "xhigh",
]);

type CatalogueSeed = {
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly supported: "unmapped" | "xhigh-mapped";
};

// Pi 0.87.1 amazon-bedrock.json: the 54 non-Claude reasoning rows, sorted by id. No thinkingLevelMap gives "unmapped"
// (five advertised levels); {"xhigh":"xhigh"} gives "xhigh-mapped" (six advertised levels).
const CATALOGUE_SEED: readonly CatalogueSeed[] = [
  {
    protocolModelID: "amazon.nova-2-lite-v1:0",
    modelMaxTokens: 65535,
    contextWindow: 1000000,
    supported: "unmapped",
  },
  {
    protocolModelID: "deepseek.v3-v1:0",
    modelMaxTokens: 81920,
    contextWindow: 163840,
    supported: "unmapped",
  },
  {
    protocolModelID: "deepseek.v3.2",
    modelMaxTokens: 81920,
    contextWindow: 163840,
    supported: "unmapped",
  },
  {
    protocolModelID: "eu.amazon.nova-2-lite-v1:0",
    modelMaxTokens: 65535,
    contextWindow: 1000000,
    supported: "unmapped",
  },
  {
    protocolModelID: "global.amazon.nova-2-lite-v1:0",
    modelMaxTokens: 65535,
    contextWindow: 1000000,
    supported: "unmapped",
  },
  {
    protocolModelID: "global.openai.gpt-5.6-luna",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "global.openai.gpt-5.6-sol",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "global.openai.gpt-5.6-terra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "global.openai.gpt-6-astra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "global.xai.grok-4.6",
    modelMaxTokens: 500000,
    contextWindow: 500000,
    supported: "unmapped",
  },
  {
    protocolModelID: "google.gemma-4-26b-a4b",
    modelMaxTokens: 32768,
    contextWindow: 262144,
    supported: "unmapped",
  },
  {
    protocolModelID: "google.gemma-4-31b",
    modelMaxTokens: 32768,
    contextWindow: 262144,
    supported: "unmapped",
  },
  {
    protocolModelID: "google.gemma-4-e2b",
    modelMaxTokens: 8192,
    contextWindow: 131072,
    supported: "unmapped",
  },
  {
    protocolModelID: "in.openai.gpt-5.6-luna",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "in.openai.gpt-5.6-terra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "jp.amazon.nova-2-lite-v1:0",
    modelMaxTokens: 65535,
    contextWindow: 1000000,
    supported: "unmapped",
  },
  {
    protocolModelID: "minimax.minimax-m2",
    modelMaxTokens: 128000,
    contextWindow: 204608,
    supported: "unmapped",
  },
  {
    protocolModelID: "minimax.minimax-m2.1",
    modelMaxTokens: 131072,
    contextWindow: 204800,
    supported: "unmapped",
  },
  {
    protocolModelID: "minimax.minimax-m2.5",
    modelMaxTokens: 98304,
    contextWindow: 196608,
    supported: "unmapped",
  },
  {
    protocolModelID: "mistral.magistral-small-2509",
    modelMaxTokens: 40000,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "moonshot.kimi-k2-thinking",
    modelMaxTokens: 16000,
    contextWindow: 262143,
    supported: "unmapped",
  },
  {
    protocolModelID: "moonshotai.kimi-k2.5",
    modelMaxTokens: 16384,
    contextWindow: 262143,
    supported: "unmapped",
  },
  {
    protocolModelID: "nvidia.nemotron-nano-3-30b",
    modelMaxTokens: 8192,
    contextWindow: 262144,
    supported: "unmapped",
  },
  {
    protocolModelID: "nvidia.nemotron-super-3-120b",
    modelMaxTokens: 131072,
    contextWindow: 262144,
    supported: "unmapped",
  },
  {
    protocolModelID: "openai.gpt-5.4",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "openai.gpt-5.5",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "openai.gpt-5.6-luna",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "openai.gpt-5.6-sol",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "openai.gpt-5.6-terra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "openai.gpt-6-astra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "openai.gpt-oss-120b",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "openai.gpt-oss-120b-1:0",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "openai.gpt-oss-20b",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "openai.gpt-oss-20b-1:0",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "openai.gpt-oss-safeguard-120b",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "openai.gpt-oss-safeguard-20b",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "qwen.qwen3-32b-v1:0",
    modelMaxTokens: 16384,
    contextWindow: 32768,
    supported: "unmapped",
  },
  {
    protocolModelID: "us-gov.openai.gpt-oss-120b-1:0",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "us-gov.openai.gpt-oss-20b-1:0",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    supported: "unmapped",
  },
  {
    protocolModelID: "us.amazon.nova-2-lite-v1:0",
    modelMaxTokens: 65535,
    contextWindow: 1000000,
    supported: "unmapped",
  },
  {
    protocolModelID: "us.openai.gpt-5.6-luna",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "us.openai.gpt-5.6-sol",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "us.openai.gpt-5.6-terra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "us.openai.gpt-6-astra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    supported: "xhigh-mapped",
  },
  {
    protocolModelID: "us.writer.palmyra-x4-v1:0",
    modelMaxTokens: 8192,
    contextWindow: 122880,
    supported: "unmapped",
  },
  {
    protocolModelID: "us.writer.palmyra-x5-v1:0",
    modelMaxTokens: 8192,
    contextWindow: 1040000,
    supported: "unmapped",
  },
  {
    protocolModelID: "us.xai.grok-4.6",
    modelMaxTokens: 500000,
    contextWindow: 500000,
    supported: "unmapped",
  },
  {
    protocolModelID: "writer.palmyra-x4-v1:0",
    modelMaxTokens: 8192,
    contextWindow: 122880,
    supported: "unmapped",
  },
  {
    protocolModelID: "writer.palmyra-x5-v1:0",
    modelMaxTokens: 8192,
    contextWindow: 1040000,
    supported: "unmapped",
  },
  {
    protocolModelID: "xai.grok-4.3",
    modelMaxTokens: 131072,
    contextWindow: 1000000,
    supported: "unmapped",
  },
  {
    protocolModelID: "xai.grok-4.6",
    modelMaxTokens: 500000,
    contextWindow: 500000,
    supported: "unmapped",
  },
  {
    protocolModelID: "zai.glm-4.7",
    modelMaxTokens: 131072,
    contextWindow: 204800,
    supported: "unmapped",
  },
  {
    protocolModelID: "zai.glm-4.7-flash",
    modelMaxTokens: 131072,
    contextWindow: 200000,
    supported: "unmapped",
  },
  {
    protocolModelID: "zai.glm-5",
    modelMaxTokens: 131072,
    contextWindow: 202752,
    supported: "unmapped",
  },
];

function rowFrom(seed: CatalogueSeed): NoControlRow {
  return Object.freeze({
    protocolModelID: seed.protocolModelID,
    modelMaxTokens: seed.modelMaxTokens,
    contextWindow: seed.contextWindow,
    supportedLevels: Object.freeze(
      seed.supported === "unmapped"
        ? [...UNMAPPED_LEVELS]
        : [...XHIGH_MAPPED_LEVELS],
    ),
  });
}

export const NO_CONTROL_CATALOGUE: readonly NoControlRow[] = Object.freeze(
  CATALOGUE_SEED.map(rowFrom),
);
// Lookup rows are built apart from the exported ones, so no exported object can change a lookup.
const ROW_BY_ID: ReadonlyMap<string, NoControlRow> = new Map(
  CATALOGUE_SEED.map((seed): [string, NoControlRow] => [
    seed.protocolModelID,
    rowFrom(seed),
  ]),
);

// ----- Constants from the source -----

const CONTEXT_SAFETY_TOKENS = 4096; // simple-options.js line 2
const MIN_MAX_TOKENS = 1; // simple-options.js line 3
const SIMPLE_SOURCE =
  "pi-ai@0.87.1 streamSimple, buildBaseOptions, clampMaxTokensToContext (reasoning-independent)";
const RAW_SOURCE =
  "pi-ai@0.87.1 stream, inferenceMaxTokens = options.maxTokens (no catalogue default, no clamp)";

// ----- Public planners and calculator -----

// Plans one canonical level for a catalogue row. The request path is explicit and has no default.
export function planBedrockNoControlLevel(
  candidate: unknown,
  level: unknown,
  request: unknown,
): NoControlPlan {
  const row = rowOf(candidate);
  if (!("protocolModelID" in row)) {
    return row;
  }
  if (!isNoControlLevel(level)) {
    return invalid("level");
  }
  const path = pathOf(request);
  if (path === undefined) {
    return invalid("request");
  }
  if (!row.supportedLevels.includes(level)) {
    return Object.freeze({ kind: "unsupported-in-snapshot", scope: "level" });
  }
  const cap = capFor(row, path, request);
  if (cap.kind === "invalid-input") {
    return cap;
  }
  return plannedOf(row, path, [level], cap);
}

// Plans an inclusive range of canonical levels. The admitted levels are the range intersected with the row's advertised
// levels; a range that admits nothing is unsupported, and no level is chosen from it.
export function planBedrockNoControlRange(
  candidate: unknown,
  range: unknown,
  request: unknown,
): NoControlPlan {
  const row = rowOf(candidate);
  if (!("protocolModelID" in row)) {
    return row;
  }
  const bounds = boundsOf(range);
  if (bounds === undefined) {
    return invalid("range");
  }
  const path = pathOf(request);
  if (path === undefined) {
    return invalid("request");
  }
  const admitted = NO_CONTROL_LEVELS.slice(bounds.low, bounds.high + 1).filter(
    (level) => row.supportedLevels.includes(level),
  );
  if (admitted.length === 0) {
    return Object.freeze({ kind: "unsupported-in-snapshot", scope: "range" });
  }
  const cap = capFor(row, path, request);
  if (cap.kind === "invalid-input") {
    return cap;
  }
  return plannedOf(row, path, admitted, cap);
}

// The neutral cap calculator over an explicit frame. It is not the Claude budget path and reads no catalogue row.
// The raw path reads only the caller cap. The simple path reads the model maximum and the window, and reads the
// estimate only when the window is positive.
export function calculateBedrockNoControlCap(
  input: unknown,
): NoControlCapResult {
  const path = pathOf(input);
  if (path === undefined) {
    return invalid("request");
  }
  const callerCap = callerCapOf(readOwn(input, "callerCap"));
  if (callerCap === undefined) {
    return invalid("caller-cap");
  }
  if (path === "raw") {
    return capOf({ path, callerCap });
  }
  const modelMaxTokens = readOwn(input, "modelMaxTokens");
  if (!isFinitePositive(modelMaxTokens)) {
    return invalid("model-max");
  }
  const contextWindow = readOwn(input, "contextWindow");
  if (!isFiniteNumber(contextWindow)) {
    return invalid("context-window");
  }
  let estimate: EstimateInput | undefined;
  if (contextWindow > 0) {
    const read = estimateOf(readOwn(input, "estimate"));
    if (read === undefined) {
      return invalid("estimate");
    }
    estimate = read;
  }
  return capOf({ path, callerCap, modelMaxTokens, contextWindow, estimate });
}

// ----- Planning helpers -----

type CapFrame =
  | { readonly path: "raw"; readonly callerCap: CallerCap }
  | {
      readonly path: "simple";
      readonly callerCap: CallerCap;
      readonly modelMaxTokens: number;
      readonly contextWindow: number;
      // Undefined only when the window is not positive, where the estimate is not used.
      readonly estimate: EstimateInput | undefined;
    };

function capFor(
  row: NoControlRow,
  path: NoControlPath,
  request: unknown,
): NoControlCapResult {
  const callerCap = callerCapOf(readOwn(request, "callerCap"));
  if (callerCap === undefined) {
    return invalid("caller-cap");
  }
  if (path === "raw") {
    return capOf({ path, callerCap });
  }
  let estimate: EstimateInput | undefined;
  if (row.contextWindow > 0) {
    const read = estimateOf(readOwn(request, "estimate"));
    if (read === undefined) {
      return invalid("estimate");
    }
    estimate = read;
  }
  return capOf({
    path,
    callerCap,
    modelMaxTokens: row.modelMaxTokens,
    contextWindow: row.contextWindow,
    estimate,
  });
}

function capOf(frame: CapFrame): NoControlCapResult {
  if (frame.callerCap.kind === "unknown") {
    return Object.freeze({ kind: "unresolved", unresolved: "caller-cap" });
  }
  if (frame.path === "raw") {
    if (frame.callerCap.kind === "absent") {
      return Object.freeze({
        kind: "absent",
        path: "raw",
        basis: "source-path",
      });
    }
    return calculatedOf("raw", frame.callerCap.value, RAW_SOURCE);
  }
  // Pi's ?? gives the caller cap precedence, and the catalogue maximum is the default.
  const requested =
    frame.callerCap.kind === "known"
      ? frame.callerCap.value
      : frame.modelMaxTokens;
  if (frame.contextWindow <= 0) {
    return calculatedOf(
      "simple",
      Math.max(MIN_MAX_TOKENS, requested),
      SIMPLE_SOURCE,
    );
  }
  if (frame.estimate === undefined || frame.estimate.kind === "unknown") {
    return Object.freeze({ kind: "unresolved", unresolved: "estimate" });
  }
  const room =
    frame.contextWindow - frame.estimate.tokens - CONTEXT_SAFETY_TOKENS;
  if (!Number.isFinite(room)) {
    return invalid("derived");
  }
  return calculatedOf(
    "simple",
    Math.min(requested, Math.max(MIN_MAX_TOKENS, room)),
    SIMPLE_SOURCE,
  );
}

function calculatedOf(
  path: NoControlPath,
  value: number,
  source: string,
): NoControlCap {
  return Object.freeze({
    kind: "calculated",
    path,
    value,
    basis: "source-path",
    source,
  });
}

function plannedOf(
  row: NoControlRow,
  path: NoControlPath,
  admitted: readonly NoControlLevel[],
  cap: NoControlCap,
): NoControlPlanned {
  return Object.freeze({
    kind: "planned",
    target: NO_CONTROL_TARGET,
    path,
    admittedLevels: Object.freeze([...admitted]),
    supportedLevels: Object.freeze([...row.supportedLevels]),
    compatibleLevels: Object.freeze([...row.supportedLevels]),
    serializerEquivalentLevels: NO_CONTROL_LEVELS,
    cap,
    conditions: NO_CONTROL_CONDITIONS,
  });
}

// ----- Input readers: own data properties only, accessors are never invoked -----

const UNREADABLE = Symbol("unreadable");

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

function rowOf(candidate: unknown): NoControlRow | NoControlFailure {
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
    return Object.freeze({ kind: "insufficient", reason: "package" });
  }
  if (api !== BEDROCK_API) {
    return Object.freeze({ kind: "insufficient", reason: "api" });
  }
  const row = ROW_BY_ID.get(protocolModelID);
  if (row === undefined) {
    return Object.freeze({ kind: "insufficient", reason: "model" });
  }
  return row;
}

type NoControlFailure = Exclude<NoControlPlan, NoControlPlanned>;

function boundsOf(
  range: unknown,
): { readonly low: number; readonly high: number } | undefined {
  if (typeof range !== "object" || range === null || Array.isArray(range)) {
    return undefined;
  }
  const from = readOwn(range, "from");
  const to = readOwn(range, "to");
  if (!isNoControlLevel(from) || !isNoControlLevel(to)) {
    return undefined;
  }
  const low = NO_CONTROL_LEVELS.indexOf(from);
  const high = NO_CONTROL_LEVELS.indexOf(to);
  return low > high ? undefined : { low, high };
}

function pathOf(request: unknown): NoControlPath | undefined {
  const path = readOwn(request, "path");
  return path === "simple" || path === "raw" ? path : undefined;
}

// Undefined, null or an unrecognised shape is invalid. Unknown is a value, not an absence.
function callerCapOf(value: unknown): CallerCap | undefined {
  const kind = readOwn(value, "kind");
  if (kind === "absent") {
    return Object.freeze({ kind: "absent" });
  }
  if (kind === "unknown") {
    return Object.freeze({ kind: "unknown" });
  }
  if (kind === "known") {
    const cap = readOwn(value, "value");
    return isNonNegativeFinite(cap)
      ? Object.freeze({ kind: "known", value: cap })
      : undefined;
  }
  return undefined;
}

function estimateOf(value: unknown): EstimateInput | undefined {
  const kind = readOwn(value, "kind");
  if (kind === "unknown") {
    return Object.freeze({ kind: "unknown" });
  }
  if (kind !== "supplied") {
    return undefined;
  }
  const tokens = readOwn(value, "tokens");
  return isNonNegativeFinite(tokens)
    ? Object.freeze({ kind: "supplied", tokens })
    : undefined;
}

// ----- Guards and small helpers -----

function invalid<Code extends NoControlInvalidCode>(
  code: Code,
): { readonly kind: "invalid-input"; readonly code: Code } {
  return Object.freeze({ kind: "invalid-input", code });
}

function isNoControlLevel(value: unknown): value is NoControlLevel {
  return (NO_CONTROL_LEVELS as readonly unknown[]).includes(value);
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

// Pure source planner for the 29 reasoning rows of the azure-openai-responses API in Pi AI 0.87.1 (provider
// "azure-openai-responses", API "azure-openai-responses"). It reads no archive, calls no SDK and makes no request. Each
// planned result describes what the Azure builder derives from Pi's streamSimple inputs for one row: the reasoning
// object, the constant include entry where the builder sets one, and a cap target. It is not a native request, not a
// provider acceptance and not a role proof.
//
// Pi's streamSimple (api/azure-openai-responses.js l. 122-137) throws unless the apiKey is truthy, even for off. It then
// clamps the requested level with clampThinkingLevel (models.js l. 566-584) and turns a clamped "off" into an undefined
// effort. This planner keeps the key check as a retained condition. It never receives or checks a key.
//
// Advertised admission follows getSupportedThinkingLevels (models.js l. 553-565), evaluated per level: a null mapping
// rejects the level; xhigh and max also need an own mapping; any other level, off included, is admitted when it is not
// null. A rejected level is unsupported in this snapshot. The SDK clamp that would map it to a neighbour is recorded as
// source evidence only.
//
// The builder (buildParams, l. 238-254) writes, for an admitted positive level L, reasoning {effort: map[L] ?? L,
// summary: "auto"} and include ["reasoning.encrypted_content"]. For an admitted off level it writes reasoning
// {effort: map.off ?? "none"} with neither summary nor include. An absent thinkingLevelMap and an empty one are
// equivalent for every read the builder makes, so the catalogue copies an absent map as an empty one.
//
// The Simple cap is M = min(Pc ?? modelMax, max(1, cw - E - 4096)) from simple-options.js l. 4-9 and buildBaseOptions
// l. 17. The Azure builder (l. 223-225) then writes max_output_tokens = max(M, 16) whenever M is truthy. The planner keeps
// the caller cap Pc, the Simple cap M and the target T as separate values. Pc is never reported as preserved, and T is
// never reported as a native cap. The target is a source description, before samplingParams and onPayload. It is not the
// final wire. A positive finite supplied Pc is a local planner precondition, not a source rule: with a positive window,
// Pi also accepts Pc = 0, yielding M = 0 and no max_output_tokens field. That source case is not modelled here.
//
// Inputs are read through own data properties only. Field accessors are not invoked. Descriptor traps can execute;
// their errors and revoked proxies are caught and returned as fixed codes that never echo caller values. Inherited
// fields are rejected. Every result is deeply frozen and no input is modified.

export const AZURE_PROVIDER = "azure-openai-responses" as const;
export const AZURE_API = "azure-openai-responses" as const;

export const AZURE_CANONICAL_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);
export type AzureLevel = (typeof AZURE_CANONICAL_LEVELS)[number];

export type AzureThinkingLevelMap = Readonly<
  Partial<Record<AzureLevel, string | null>>
>;

export type AzureRow = {
  readonly provider: typeof AZURE_PROVIDER;
  readonly api: typeof AZURE_API;
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly thinkingLevelMap: AzureThinkingLevelMap;
  readonly supportedLevels: readonly AzureLevel[];
};

// The twenty-nine reasoning records of providers/data/azure-openai-responses.json, in catalogue order. Each map is copied
// as written. An empty map stands for a record without a thinkingLevelMap key (see the header).
type CatalogueSeed = {
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly thinkingLevelMap: AzureThinkingLevelMap;
};

const CATALOGUE_SEED: readonly CatalogueSeed[] = [
  {
    protocolModelID: "gpt-5",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null },
  },
  {
    protocolModelID: "gpt-5-mini",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null },
  },
  {
    protocolModelID: "gpt-5-nano",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null },
  },
  {
    protocolModelID: "gpt-5-pro",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null },
  },
  {
    protocolModelID: "gpt-5.1",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null },
  },
  {
    protocolModelID: "gpt-5.2",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.2-chat-latest",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.2-pro",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.3-codex",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.3-codex-spark",
    modelMaxTokens: 32000,
    contextWindow: 128000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.4",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.4-mini",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.4-nano",
    modelMaxTokens: 128000,
    contextWindow: 400000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.4-pro",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.5",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  },
  {
    protocolModelID: "gpt-5.5-pro",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    thinkingLevelMap: { off: null, xhigh: "xhigh", minimal: null, low: null },
  },
  {
    protocolModelID: "gpt-5.6-luna",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
  },
  {
    protocolModelID: "gpt-5.6-sol",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
  },
  {
    protocolModelID: "gpt-5.6-terra",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
  },
  {
    protocolModelID: "gpt-6-astra",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  },
  {
    protocolModelID: "gpt-6-luna",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  },
  {
    protocolModelID: "gpt-6-sol",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  },
  {
    protocolModelID: "gpt-realtime-2.1",
    modelMaxTokens: 32000,
    contextWindow: 128000,
    thinkingLevelMap: {},
  },
  {
    protocolModelID: "o1",
    modelMaxTokens: 100000,
    contextWindow: 200000,
    thinkingLevelMap: {},
  },
  {
    protocolModelID: "o1-pro",
    modelMaxTokens: 100000,
    contextWindow: 200000,
    thinkingLevelMap: {},
  },
  {
    protocolModelID: "o3",
    modelMaxTokens: 100000,
    contextWindow: 200000,
    thinkingLevelMap: {},
  },
  {
    protocolModelID: "o3-mini",
    modelMaxTokens: 100000,
    contextWindow: 200000,
    thinkingLevelMap: {},
  },
  {
    protocolModelID: "o3-pro",
    modelMaxTokens: 100000,
    contextWindow: 200000,
    thinkingLevelMap: {},
  },
  {
    protocolModelID: "o4-mini",
    modelMaxTokens: 100000,
    contextWindow: 200000,
    thinkingLevelMap: {},
  },
];

// Admission follows getSupportedThinkingLevels (models.js l. 557-564), evaluated per level.
function advertisedOf(map: AzureThinkingLevelMap): readonly AzureLevel[] {
  return AZURE_CANONICAL_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) {
      return false;
    }
    if (level === "xhigh" || level === "max") {
      return mapped !== undefined;
    }
    return true;
  });
}

function rowFrom(seed: CatalogueSeed): AzureRow {
  const thinkingLevelMap = Object.freeze({ ...seed.thinkingLevelMap });
  return Object.freeze({
    provider: AZURE_PROVIDER,
    api: AZURE_API,
    protocolModelID: seed.protocolModelID,
    modelMaxTokens: seed.modelMaxTokens,
    contextWindow: seed.contextWindow,
    thinkingLevelMap,
    supportedLevels: Object.freeze([...advertisedOf(thinkingLevelMap)]),
  });
}

export const AZURE_CATALOGUE: readonly AzureRow[] = Object.freeze(
  CATALOGUE_SEED.map(rowFrom),
);
// Lookup rows are built apart from the exported rows, so no exported object can change a lookup.
const ROW_BY_ID: ReadonlyMap<string, AzureRow> = new Map(
  CATALOGUE_SEED.map((seed): [string, AzureRow] => [
    seed.protocolModelID,
    rowFrom(seed),
  ]),
);

export const AZURE_SOURCE_SCOPE =
  "pi-ai@0.87.1 api/azure-openai-responses.js streamSimple l. 122-137 and buildParams l. 238-254";

export const AZURE_CAP_SOURCE =
  "pi-ai@0.87.1 api/simple-options.js clampMaxTokensToContext l. 4-9 via buildBaseOptions l. 17; api/azure-openai-responses.js buildParams l. 223-225";

export const AZURE_SDK_CLAMP_EVIDENCE =
  "pi-ai@0.87.1 models.js clampThinkingLevel l. 566-584 and api/azure-openai-responses.js streamSimple l. 131-136: the SDK clamp maps an unadvertised level to a neighbour. Source evidence, not policy admission";

export const AZURE_SOURCE_HASHES: Readonly<Record<string, string>> =
  Object.freeze({
    "api/azure-openai-responses.js":
      "2cce830528a0d063cd76e9f234632637ed9782e12c687d3c5bc79f10483a7ff2",
    "providers/data/azure-openai-responses.json":
      "c351c6af1882660ffa8a8598594b86671b45817106e45ac920535aaeac59fc96",
    "api/simple-options.js":
      "1caf860e028e22639578aba3ec8b79e5be9650c27bd3f19471c78502976555f3",
    "models.js":
      "75fa33149fb608bc4a7b7a0586c8ca8f0024465d580091b0c426c0baf3fbc80a",
  });

// The builder's target stage for the cap, not the wire: it is written before samplingParams and onPayload act.
export const AZURE_CAP_TARGET_STAGE =
  "before-sampling-params-and-on-payload" as const;

// The positive floor that the Azure builder applies to max_output_tokens (l. 16-17, 224).
export const AZURE_CAP_FLOOR = 16 as const;

const CONTEXT_SAFETY_TOKENS = 4096; // simple-options.js l. 2
const MIN_MAX_TOKENS = 1; // simple-options.js l. 3
const INCLUDE = Object.freeze(["reasoning.encrypted_content"] as const);

// Conditions every planned or unsupported result keeps. None is discharged by this module.
export const AZURE_CONDITIONS = Object.freeze([
  "pi-api-key-truthy-prerequisite",
  "azure-client-and-deployment-resolution-unobserved",
  "simple-forwards-no-azure-overrides",
  "context-estimate-caller-supplied",
  "sampling-params-overlay-after-builder",
  "on-payload-whole-params-replacement",
  "retry-reuses-built-params",
  "compat-tool-and-transcript-conditions",
  "native-correspondence-unknown",
  "provider-acceptance-unknown",
  "auth-runtime-unexecuted",
  "source-recipe-not-final-wire",
  "later-writers-and-peers",
] as const);
export type AzureCondition = (typeof AZURE_CONDITIONS)[number];

// ----- Public result types -----

export type AzureRecipe = {
  readonly reasoning: {
    readonly effort: string;
    readonly summary?: "auto";
  };
  readonly include?: typeof INCLUDE;
};

export type AzureCandidate = {
  readonly controlClass: "off" | "positive";
  readonly recipe: AzureRecipe;
  // Every advertised level that writes this exact recipe, in canonical order. Never narrowed.
  readonly compatibleLevels: readonly AzureLevel[];
  // The requested levels that fall in this class, in canonical order. Nothing is selected.
  readonly admittedLevels: readonly AzureLevel[];
};

export type AzureIdentity = {
  readonly provider: typeof AZURE_PROVIDER;
  readonly api: typeof AZURE_API;
  readonly protocolModelID: string;
};

export type AzureCallerCap =
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly value: number };

export type AzureCap =
  | {
      readonly kind: "resolved";
      readonly callerCap: AzureCallerCap;
      readonly modelMaxTokens: number;
      readonly contextWindow: number;
      readonly estimate: { readonly kind: "supplied"; readonly tokens: number };
      // M: Simple's cap from simple-options.js. It is not a native or preserved cap.
      readonly simpleMaxTokens: number;
      // T: the max_output_tokens value the builder writes, max(M, 16). It is a source description.
      readonly maxOutputTokensTarget: number;
      readonly targetStage: typeof AZURE_CAP_TARGET_STAGE;
      readonly source: typeof AZURE_CAP_SOURCE;
    }
  | {
      readonly kind: "unresolved";
      readonly unresolved: "caller-cap" | "estimate";
      readonly source: typeof AZURE_CAP_SOURCE;
    };

export type AzureRange = { readonly from: AzureLevel; readonly to: AzureLevel };

export type AzurePlanned = {
  readonly kind: "planned";
  readonly scope: "level" | "range";
  readonly source: typeof AZURE_SOURCE_SCOPE;
  readonly identity: AzureIdentity;
  readonly requested: AzureRange;
  readonly supportedLevels: readonly AzureLevel[];
  readonly admittedLevels: readonly AzureLevel[];
  // Canonical levels inside a range that the row does not advertise. Empty for a fixed level.
  readonly excludedLevels: readonly AzureLevel[];
  readonly candidates: readonly AzureCandidate[];
  readonly cap: AzureCap;
  readonly conditions: readonly AzureCondition[];
};

export type AzureUnsupported =
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly scope: "level";
      readonly level: AzureLevel;
      readonly sourceEvidence: typeof AZURE_SDK_CLAMP_EVIDENCE;
      readonly source: typeof AZURE_SOURCE_SCOPE;
      readonly conditions: readonly AzureCondition[];
    }
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly scope: "range";
      readonly source: typeof AZURE_SOURCE_SCOPE;
      readonly conditions: readonly AzureCondition[];
    };

export type AzureInvalidCode =
  | "candidate"
  | "level"
  | "range"
  | "request"
  | "caller-cap"
  | "estimate";

export type AzureInvalid = {
  readonly kind: "invalid-input";
  readonly code: AzureInvalidCode;
};

export type AzureInsufficient = {
  readonly kind: "insufficient";
  readonly reason: "provider" | "api" | "model";
};

export type AzurePlan =
  | AzurePlanned
  | AzureUnsupported
  | AzureInsufficient
  | AzureInvalid;

// ----- Planners -----

// Plans one canonical level for one exact row. Identity and level are checked first. An unadvertised level is
// unsupported and reads no request state. An admitted level then reads the caller cap and the estimate.
export function planAzureLevel(
  candidate: unknown,
  level: unknown,
  request: unknown,
): AzurePlan {
  const row = rowOf(candidate);
  if (!isRow(row)) {
    return row;
  }
  if (!isCanonicalLevel(level)) {
    return invalid("level");
  }
  if (!row.supportedLevels.includes(level)) {
    return Object.freeze({
      kind: "unsupported-in-snapshot",
      scope: "level",
      level,
      sourceEvidence: AZURE_SDK_CLAMP_EVIDENCE,
      source: AZURE_SOURCE_SCOPE,
      conditions: AZURE_CONDITIONS,
    });
  }
  const inputs = requestOf(request);
  if (inputs.kind === "invalid-input") {
    return inputs;
  }
  return plannedOf(
    row,
    "level",
    { from: level, to: level },
    [level],
    [],
    inputs,
  );
}

// Plans an inclusive canonical range. The admitted levels are the range intersected with the advertised levels, and
// unadvertised levels inside the range are reported as excluded. A range with no advertised member is unsupported and
// reads no request state. Each class keeps its full compatible set, and nothing is selected.
export function planAzureRange(
  candidate: unknown,
  range: unknown,
  request: unknown,
): AzurePlan {
  const row = rowOf(candidate);
  if (!isRow(row)) {
    return row;
  }
  const bounds = boundsOf(range);
  if (bounds === undefined) {
    return invalid("range");
  }
  const span = AZURE_CANONICAL_LEVELS.slice(bounds.low, bounds.high + 1);
  const admitted = span.filter((level) => row.supportedLevels.includes(level));
  const excluded = span.filter((level) => !row.supportedLevels.includes(level));
  if (admitted.length === 0) {
    return Object.freeze({
      kind: "unsupported-in-snapshot",
      scope: "range",
      source: AZURE_SOURCE_SCOPE,
      conditions: AZURE_CONDITIONS,
    });
  }
  const inputs = requestOf(request);
  if (inputs.kind === "invalid-input") {
    return inputs;
  }
  return plannedOf(
    row,
    "range",
    { from: bounds.from, to: bounds.to },
    admitted,
    excluded,
    inputs,
  );
}

// ----- Recipes and classes -----

// Pi's builder output for one admitted level. The positive recipe carries include, the off recipe carries neither
// summary nor include.
function recipeOf(row: AzureRow, level: AzureLevel): AzureRecipe {
  const mapped = row.thinkingLevelMap[level];
  if (level === "off") {
    return Object.freeze({
      reasoning: Object.freeze({ effort: mapped ?? "none" }),
    });
  }
  return Object.freeze({
    reasoning: Object.freeze({
      effort: mapped ?? level,
      summary: "auto" as const,
    }),
    include: INCLUDE,
  });
}

function keyOf(recipe: AzureRecipe): string {
  return JSON.stringify(recipe);
}

// Groups advertised levels by their exact recipe, then reports one candidate for each class that holds an admitted
// level. The compatible set is the full advertised class, so a narrower requirement never shrinks it.
function candidatesFor(
  row: AzureRow,
  admitted: readonly AzureLevel[],
): AzureCandidate[] {
  const advertisedByKey = new Map<string, AzureLevel[]>();
  for (const level of row.supportedLevels) {
    const key = keyOf(recipeOf(row, level));
    advertisedByKey.set(key, [...(advertisedByKey.get(key) ?? []), level]);
  }
  const result: AzureCandidate[] = [];
  const seen = new Set<string>();
  for (const level of admitted) {
    const recipe = recipeOf(row, level);
    const key = keyOf(recipe);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(
      Object.freeze({
        controlClass: level === "off" ? "off" : "positive",
        recipe,
        compatibleLevels: Object.freeze([...(advertisedByKey.get(key) ?? [])]),
        admittedLevels: Object.freeze(
          admitted.filter((entry) => keyOf(recipeOf(row, entry)) === key),
        ),
      }),
    );
  }
  return result;
}

function plannedOf(
  row: AzureRow,
  scope: "level" | "range",
  requested: AzureRange,
  admitted: readonly AzureLevel[],
  excluded: readonly AzureLevel[],
  inputs: RequestInputs,
): AzurePlanned {
  return Object.freeze({
    kind: "planned",
    scope,
    source: AZURE_SOURCE_SCOPE,
    identity: identityOf(row),
    requested: Object.freeze({ ...requested }),
    supportedLevels: row.supportedLevels,
    admittedLevels: Object.freeze([...admitted]),
    excludedLevels: Object.freeze([...excluded]),
    candidates: Object.freeze(candidatesFor(row, admitted)),
    cap: capOf(row, inputs),
    conditions: AZURE_CONDITIONS,
  });
}

// ----- Simple cap -----

// M = min(Pc ?? modelMax, max(1, cw - E - 4096)) for a positive window. Every catalogue row has a positive window, so the
// non-positive branch of clampMaxTokensToContext is not represented. An unknown caller cap or estimate is unresolved and
// is never treated as zero. The target T is max(M, 16), which is positive because M is positive.
function capOf(row: AzureRow, inputs: RequestInputs): AzureCap {
  if (inputs.callerCap.kind === "unknown") {
    return Object.freeze({
      kind: "unresolved",
      unresolved: "caller-cap",
      source: AZURE_CAP_SOURCE,
    });
  }
  if (inputs.estimate.kind === "unknown") {
    return Object.freeze({
      kind: "unresolved",
      unresolved: "estimate",
      source: AZURE_CAP_SOURCE,
    });
  }
  const requested =
    inputs.callerCap.kind === "known"
      ? inputs.callerCap.value
      : row.modelMaxTokens;
  const room =
    row.contextWindow - inputs.estimate.tokens - CONTEXT_SAFETY_TOKENS;
  const simpleMaxTokens = Math.min(requested, Math.max(MIN_MAX_TOKENS, room));
  return Object.freeze({
    kind: "resolved",
    callerCap: inputs.callerCap,
    modelMaxTokens: row.modelMaxTokens,
    contextWindow: row.contextWindow,
    estimate: inputs.estimate,
    simpleMaxTokens,
    maxOutputTokensTarget: Math.max(simpleMaxTokens, AZURE_CAP_FLOOR),
    targetStage: AZURE_CAP_TARGET_STAGE,
    source: AZURE_CAP_SOURCE,
  });
}

// ----- Input readers: own data properties only; accessors are not invoked, descriptor trap failures are caught -----

type CapState =
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly value: number }
  | { readonly kind: "unknown" };

type EstimateState =
  | { readonly kind: "supplied"; readonly tokens: number }
  | { readonly kind: "unknown" };

type RequestInputs = {
  readonly kind: "ok";
  readonly callerCap: CapState;
  readonly estimate: EstimateState;
};

const UNREADABLE = Symbol("unreadable");

function readOwn(record: unknown, key: string): unknown {
  if (typeof record !== "object" || record === null) {
    return UNREADABLE;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) {
      return undefined;
    }
    return "value" in descriptor ? descriptor.value : UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

type AzureFailure = AzureInvalid | AzureInsufficient;

function rowOf(candidate: unknown): AzureRow | AzureFailure {
  const provider = readOwn(candidate, "provider");
  const api = readOwn(candidate, "api");
  const protocolModelID = readOwn(candidate, "protocolModelID");
  if (
    typeof provider !== "string" ||
    typeof api !== "string" ||
    typeof protocolModelID !== "string"
  ) {
    return invalid("candidate");
  }
  if (provider !== AZURE_PROVIDER) {
    return Object.freeze({ kind: "insufficient", reason: "provider" });
  }
  if (api !== AZURE_API) {
    return Object.freeze({ kind: "insufficient", reason: "api" });
  }
  const row = ROW_BY_ID.get(protocolModelID);
  if (row === undefined) {
    return Object.freeze({ kind: "insufficient", reason: "model" });
  }
  return row;
}

function isRow(value: AzureRow | AzureFailure): value is AzureRow {
  return "protocolModelID" in value;
}

// Reads the request as a non-array object with own callerCap and estimate. Undefined, null, arrays, revoked proxies and
// trapping descriptors are invalid. Missing or unrecognised states are invalid, never absence by default.
function requestOf(request: unknown): RequestInputs | AzureInvalid {
  if (typeof request !== "object" || request === null) {
    return invalid("request");
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(request);
  } catch {
    return invalid("request");
  }
  if (isArray) {
    return invalid("request");
  }
  const callerCap = callerCapOf(readOwn(request, "callerCap"));
  if (callerCap === undefined) {
    return invalid("caller-cap");
  }
  const estimate = estimateOf(readOwn(request, "estimate"));
  if (estimate === undefined) {
    return invalid("estimate");
  }
  return Object.freeze({ kind: "ok", callerCap, estimate });
}

// Positive finite known caps are the local input domain. Source Pc = 0 would omit max_output_tokens; it is not planned.
function callerCapOf(value: unknown): CapState | undefined {
  const kind = readOwn(value, "kind");
  if (kind === "absent") {
    return Object.freeze({ kind: "absent" });
  }
  if (kind === "unknown") {
    return Object.freeze({ kind: "unknown" });
  }
  if (kind === "known") {
    const cap = readOwn(value, "value");
    return isPositiveFinite(cap)
      ? Object.freeze({ kind: "known", value: cap })
      : undefined;
  }
  return undefined;
}

function estimateOf(value: unknown): EstimateState | undefined {
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

// Reads the range as a non-array object with own from and to. Arrays, sparse arrays, revoked proxies, unknown bounds and
// reversed pairs are rejected with the same code.
function boundsOf(range: unknown):
  | {
      readonly from: AzureLevel;
      readonly to: AzureLevel;
      readonly low: number;
      readonly high: number;
    }
  | undefined {
  if (typeof range !== "object" || range === null) {
    return undefined;
  }
  try {
    if (Array.isArray(range)) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const from = readOwn(range, "from");
  const to = readOwn(range, "to");
  if (!isCanonicalLevel(from) || !isCanonicalLevel(to)) {
    return undefined;
  }
  const low = AZURE_CANONICAL_LEVELS.indexOf(from);
  const high = AZURE_CANONICAL_LEVELS.indexOf(to);
  return low > high ? undefined : { from, to, low, high };
}

// ----- Guards and small helpers -----

function invalid<Code extends AzureInvalidCode>(
  code: Code,
): { readonly kind: "invalid-input"; readonly code: Code } {
  return Object.freeze({ kind: "invalid-input", code });
}

function identityOf(row: AzureRow): AzureIdentity {
  return Object.freeze({
    provider: row.provider,
    api: row.api,
    protocolModelID: row.protocolModelID,
  });
}

function isCanonicalLevel(value: unknown): value is AzureLevel {
  return (AZURE_CANONICAL_LEVELS as readonly unknown[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

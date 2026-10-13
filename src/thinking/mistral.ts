// Pure source planner for the nine exact Mistral Simple-path rows of Pi AI 0.87.1 (provider "mistral", API
// "mistral-conversations"). It reads no archive, calls no SDK and makes no request. Each result describes the source
// fields that Pi's streamSimple would set for one row. It is not a native request, a provider acceptance or a role proof.
//
// Pi's streamSimple (api/mistral-conversations.js l. 66-82) throws before any level handling unless the apiKey is truthy,
// for off as well. The planner keeps that as a retained condition. It never receives or checks a key, and a truthy key
// is not an authentication claim.
//
// A positive level sets one field per row: reasoningEffort "high" on six effort rows, promptMode "reasoning" on three
// prompt rows. Off sets neither field. That is the absence of a source field, not a disabled thinking mode. Advertised
// policy admits off, minimal, low, medium and high. Pi's clampThinkingLevel (models.js l. 566-584) turns xhigh and max
// into high; that is recorded as source evidence and is never admission.
//
// The Simple cap follows clampMaxTokensToContext (simple-options.js l. 4-9): min(Pc, max(1, cw - E - 4096)), where Pc is
// the caller cap or the catalogue maximum, and E is the context estimate. An unknown estimate or caller cap is unresolved,
// never zero. A supplied caller cap is not clipped to the catalogue maximum. The result is Pi's virtual cap, not a cap
// observed on the wire.
//
// Inputs are read through own data properties only. Accessors and inherited fields are rejected without being invoked.
// No input is modified, and every result is deeply frozen.

export const MISTRAL_PROVIDER = "mistral" as const;
export const MISTRAL_API = "mistral-conversations" as const;

export const MISTRAL_CANONICAL_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);
export type MistralLevel = (typeof MISTRAL_CANONICAL_LEVELS)[number];

export const MISTRAL_SUPPORTED_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
] as const);
export type MistralSupportedLevel = (typeof MISTRAL_SUPPORTED_LEVELS)[number];

export const MISTRAL_POSITIVE_LEVELS = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
] as const);
export type MistralPositiveLevel = (typeof MISTRAL_POSITIVE_LEVELS)[number];

export type MistralChannel = "reasoning_effort" | "prompt_mode";

// Describes Pi streamSimple options (l. 80-81), remapped to wire names at l. 233-234. "absent" is a description of
// omission, not an option value: this control object must not be copied into request settings or a body overlay.
export type MistralControl = {
  readonly reasoningEffort: "high" | "absent";
  readonly promptMode: "reasoning" | "absent";
};

const OFF_CONTROL: MistralControl = Object.freeze({
  reasoningEffort: "absent",
  promptMode: "absent",
});
const EFFORT_CONTROL: MistralControl = Object.freeze({
  reasoningEffort: "high",
  promptMode: "absent",
});
const PROMPT_CONTROL: MistralControl = Object.freeze({
  reasoningEffort: "absent",
  promptMode: "reasoning",
});
const OFF_LEVELS: readonly MistralSupportedLevel[] = Object.freeze([
  "off" as const,
]);

export type MistralRow = {
  readonly provider: typeof MISTRAL_PROVIDER;
  readonly api: typeof MISTRAL_API;
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly channel: MistralChannel;
  readonly supportedLevels: readonly MistralSupportedLevel[];
};

// The nine exact rows of providers/data/mistral.json under "mistral-conversations", sorted as in the catalogue.
// Effort rows: mistral-small-latest, mistral-small-2603, mistral-medium-latest, mistral-medium-2604, mistral-medium-3.5,
// zai-glm-5-2. Prompt rows: magistral-small, magistral-medium-latest, zai-glm-5-3. No row has a thinkingLevelMap or compat.
type CatalogueSeed = {
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly channel: MistralChannel;
};
const CATALOGUE_SEED: readonly CatalogueSeed[] = [
  {
    protocolModelID: "mistral-small-latest",
    modelMaxTokens: 256000,
    contextWindow: 256000,
    channel: "reasoning_effort",
  },
  {
    protocolModelID: "mistral-small-2603",
    modelMaxTokens: 256000,
    contextWindow: 256000,
    channel: "reasoning_effort",
  },
  {
    protocolModelID: "mistral-medium-latest",
    modelMaxTokens: 262144,
    contextWindow: 262144,
    channel: "reasoning_effort",
  },
  {
    protocolModelID: "mistral-medium-2604",
    modelMaxTokens: 262144,
    contextWindow: 262144,
    channel: "reasoning_effort",
  },
  {
    protocolModelID: "mistral-medium-3.5",
    modelMaxTokens: 262144,
    contextWindow: 262144,
    channel: "reasoning_effort",
  },
  {
    protocolModelID: "zai-glm-5-2",
    modelMaxTokens: 131072,
    contextWindow: 1000000,
    channel: "reasoning_effort",
  },
  {
    protocolModelID: "magistral-small",
    modelMaxTokens: 128000,
    contextWindow: 128000,
    channel: "prompt_mode",
  },
  {
    protocolModelID: "magistral-medium-latest",
    modelMaxTokens: 16384,
    contextWindow: 128000,
    channel: "prompt_mode",
  },
  {
    protocolModelID: "zai-glm-5-3",
    modelMaxTokens: 131072,
    contextWindow: 1000000,
    channel: "prompt_mode",
  },
];

function rowFrom(seed: CatalogueSeed): MistralRow {
  return Object.freeze({
    provider: MISTRAL_PROVIDER,
    api: MISTRAL_API,
    protocolModelID: seed.protocolModelID,
    modelMaxTokens: seed.modelMaxTokens,
    contextWindow: seed.contextWindow,
    channel: seed.channel,
    supportedLevels: Object.freeze([...MISTRAL_SUPPORTED_LEVELS]),
  });
}

export const MISTRAL_CATALOGUE: readonly MistralRow[] = Object.freeze(
  CATALOGUE_SEED.map(rowFrom),
);
// Lookup rows are built apart from the exported rows, so no exported object can change a lookup.
const ROW_BY_ID: ReadonlyMap<string, MistralRow> = new Map(
  CATALOGUE_SEED.map((seed): [string, MistralRow] => [
    seed.protocolModelID,
    rowFrom(seed),
  ]),
);

export const MISTRAL_SOURCE_SCOPE =
  "pi-ai@0.87.1 api/mistral-conversations.js streamSimple l. 66-82";
export const MISTRAL_CAP_SOURCE =
  "pi-ai@0.87.1 api/simple-options.js clampMaxTokensToContext l. 4-9 via buildBaseOptions l. 17";
export const MISTRAL_SDK_CLAMP_EVIDENCE =
  "pi-ai@0.87.1 models.js clampThinkingLevel l. 566-584: xhigh and max resolve to high; source evidence, not policy admission";

export const MISTRAL_SOURCE_HASHES: Readonly<Record<string, string>> =
  Object.freeze({
    "api/mistral-conversations.js":
      "beea0b191eaf33f0b412fb0c10219fac89a599fba9c4f215a1fcfd5ea8c3f46e",
    "api/mistral-conversations.lazy.js":
      "df0028011c26593830914429185f22bc60fa942e86ac871faa361abd2eaaf83e",
    "api/simple-options.js":
      "1caf860e028e22639578aba3ec8b79e5be9650c27bd3f19471c78502976555f3",
    "models.js":
      "75fa33149fb608bc4a7b7a0586c8ca8f0024465d580091b0c426c0baf3fbc80a",
    "providers/data/mistral.json":
      "df70e9066f39ffd93734895530653d642e9491bf66dd4b6ab1138f0cb400ae65",
    "utils/estimate.js":
      "ad08d86f790f6113d82610d9b0d5007eb8ebd27245409cc7262aed0b43613ced",
  });

// Conditions that every planned result keeps. None is discharged by this module.
export const MISTRAL_CONDITIONS = Object.freeze([
  "pi-api-key-truthy-prerequisite",
  "sdk-clamp-not-admission",
  "caller-cap-provenance",
  "estimate-provenance",
  "catalogue-identity-source-scoped",
  "pi-on-payload-replacement",
  "native-provider-options-forwarded-settings",
  "body-overlay-control-and-cap-fields",
  "virtual-pi-cap-not-native-cap",
  "provider-acceptance-unverified",
  "auth-transport-runtime-unverified",
  "later-serializers-and-writers",
] as const);
export type MistralCondition = (typeof MISTRAL_CONDITIONS)[number];

const CONTEXT_SAFETY_TOKENS = 4096; // simple-options.js l. 2
const MIN_MAX_TOKENS = 1; // simple-options.js l. 3

// ----- Public result types -----

export type MistralCandidate = {
  readonly controlClass: "off" | "positive";
  readonly admittedLevels: readonly MistralSupportedLevel[];
  readonly compatibleLevels: readonly MistralSupportedLevel[];
  readonly control: MistralControl;
};

export type MistralIdentity = {
  readonly provider: typeof MISTRAL_PROVIDER;
  readonly api: typeof MISTRAL_API;
  readonly protocolModelID: string;
};

export type MistralCap =
  | {
      readonly kind: "calculated";
      readonly value: number;
      readonly source: string;
    }
  | {
      readonly kind: "unresolved";
      readonly unresolved: "caller-cap" | "estimate";
    };

export type MistralInvalidCode =
  | "candidate"
  | "level"
  | "range"
  | "request"
  | "caller-cap"
  | "estimate"
  | "model-max"
  | "context-window";

export type MistralInvalid = {
  readonly kind: "invalid-input";
  readonly code: MistralInvalidCode;
};

export type MistralPlanned = {
  readonly kind: "planned";
  readonly scope: "level" | "range";
  readonly requested: {
    readonly from: MistralLevel;
    readonly to: MistralLevel;
  };
  readonly source: string;
  readonly identity: MistralIdentity;
  readonly channel: MistralChannel;
  readonly supportedLevels: readonly MistralSupportedLevel[];
  readonly admittedLevels: readonly MistralSupportedLevel[];
  readonly candidates: readonly MistralCandidate[];
  readonly cap: MistralCap;
  readonly conditions: readonly MistralCondition[];
};

export type MistralUnsupported =
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly scope: "level";
      readonly level: "xhigh" | "max";
      readonly sourceEvidence: typeof MISTRAL_SDK_CLAMP_EVIDENCE;
      readonly source: string;
      readonly conditions: readonly MistralCondition[];
    }
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly scope: "range";
      readonly source: string;
      readonly conditions: readonly MistralCondition[];
    };

export type MistralInsufficient = {
  readonly kind: "insufficient";
  readonly reason: "provider" | "api" | "model";
};

export type MistralPlan =
  | MistralPlanned
  | MistralUnsupported
  | MistralInsufficient
  | MistralInvalid;

// ----- Simple cap calculator -----

export type MistralCapResult = MistralCap | MistralInvalid;

// Pi's Simple path with a positive window. A non-positive window is outside this contract: all nine catalogue rows
// have a positive window, and the calculator rejects any other value with context-window.
// The caller cap is absent, known or unknown. Absent uses the catalogue maximum, as Pi's ?? does.
export function calculateMistralSimpleCap(input: unknown): MistralCapResult {
  if (typeof input !== "object" || input === null) {
    return invalid("request");
  }
  const modelMaxTokens = readOwn(input, "modelMaxTokens");
  if (!isFinitePositive(modelMaxTokens)) {
    return invalid("model-max");
  }
  const contextWindow = readOwn(input, "contextWindow");
  if (!isFinitePositive(contextWindow)) {
    return invalid("context-window");
  }
  const callerCap = callerCapOf(readOwn(input, "callerCap"));
  if (callerCap === undefined) {
    return invalid("caller-cap");
  }
  const estimate = estimateOf(readOwn(input, "estimate"));
  if (estimate === undefined) {
    return invalid("estimate");
  }
  if (callerCap.kind === "unknown") {
    return Object.freeze({ kind: "unresolved", unresolved: "caller-cap" });
  }
  if (estimate.kind === "unknown") {
    return Object.freeze({ kind: "unresolved", unresolved: "estimate" });
  }
  const requested =
    callerCap.kind === "known" ? callerCap.value : modelMaxTokens;
  const room = contextWindow - estimate.tokens - CONTEXT_SAFETY_TOKENS;
  return Object.freeze({
    kind: "calculated",
    value: Math.min(requested, Math.max(MIN_MAX_TOKENS, room)),
    source: MISTRAL_CAP_SOURCE,
  });
}

// ----- Planners -----

// Plans one canonical level for one exact row. Off and the four positive levels are admitted; xhigh and max are
// unsupported in the snapshot; any other value is invalid. Nothing is selected and no default level exists.
export function planMistralLevel(
  candidate: unknown,
  level: unknown,
  request: unknown,
): MistralPlan {
  const row = rowOf(candidate);
  if (!isRow(row)) {
    return row;
  }
  if (!isCanonicalLevel(level)) {
    return invalid("level");
  }
  if (!isSupportedLevel(level)) {
    return Object.freeze({
      kind: "unsupported-in-snapshot",
      scope: "level",
      level,
      sourceEvidence: MISTRAL_SDK_CLAMP_EVIDENCE,
      source: MISTRAL_SOURCE_SCOPE,
      conditions: MISTRAL_CONDITIONS,
    });
  }
  return plannedOf(
    row,
    "level",
    { from: level, to: level },
    [level],
    candidatesFor(row, [level]),
    request,
  );
}

// Plans an inclusive range over the canonical order. The admitted levels are the range intersected with the advertised
// levels. A range that admits nothing is unsupported. A range that admits off and positive levels returns one candidate
// per control class, and no candidate is chosen.
export function planMistralRange(
  candidate: unknown,
  range: unknown,
  request: unknown,
): MistralPlan {
  const row = rowOf(candidate);
  if (!isRow(row)) {
    return row;
  }
  const bounds = boundsOf(range);
  if (bounds === undefined) {
    return invalid("range");
  }
  const admitted = MISTRAL_CANONICAL_LEVELS.slice(
    bounds.low,
    bounds.high + 1,
  ).filter(isSupportedLevel);
  if (admitted.length === 0) {
    return Object.freeze({
      kind: "unsupported-in-snapshot",
      scope: "range",
      source: MISTRAL_SOURCE_SCOPE,
      conditions: MISTRAL_CONDITIONS,
    });
  }
  return plannedOf(
    row,
    "range",
    { from: bounds.from, to: bounds.to },
    admitted,
    candidatesFor(row, admitted),
    request,
  );
}

// ----- Planning helpers -----

function plannedOf(
  row: MistralRow,
  scope: "level" | "range",
  requested: { readonly from: MistralLevel; readonly to: MistralLevel },
  admitted: readonly MistralSupportedLevel[],
  candidates: readonly MistralCandidate[],
  request: unknown,
): MistralPlan {
  const cap = capOf(row, request);
  if (cap.kind === "invalid-input") {
    return cap;
  }
  return Object.freeze({
    kind: "planned",
    scope,
    requested: Object.freeze({ ...requested }),
    source: MISTRAL_SOURCE_SCOPE,
    identity: identityOf(row),
    channel: row.channel,
    supportedLevels: row.supportedLevels,
    admittedLevels: Object.freeze([...admitted]),
    candidates: Object.freeze([...candidates]),
    cap,
    conditions: MISTRAL_CONDITIONS,
  });
}

// The off class and the positive class are separate candidates. The positive class is compatible with all four
// positive levels, so an admitted subset never shrinks the compatible set.
function candidatesFor(
  row: MistralRow,
  admitted: readonly MistralSupportedLevel[],
): MistralCandidate[] {
  const result: MistralCandidate[] = [];
  if (admitted.includes("off")) {
    result.push(
      Object.freeze({
        controlClass: "off",
        admittedLevels: OFF_LEVELS,
        compatibleLevels: OFF_LEVELS,
        control: OFF_CONTROL,
      }),
    );
  }
  const positives = admitted.filter(isPositiveLevel);
  if (positives.length > 0) {
    result.push(
      Object.freeze({
        controlClass: "positive",
        admittedLevels: Object.freeze([...positives]),
        compatibleLevels: Object.freeze([...MISTRAL_POSITIVE_LEVELS]),
        control:
          row.channel === "reasoning_effort" ? EFFORT_CONTROL : PROMPT_CONTROL,
      }),
    );
  }
  return result;
}

function capOf(row: MistralRow, request: unknown): MistralCapResult {
  if (typeof request !== "object" || request === null) {
    return invalid("request");
  }
  return calculateMistralSimpleCap({
    modelMaxTokens: row.modelMaxTokens,
    contextWindow: row.contextWindow,
    callerCap: readOwn(request, "callerCap"),
    estimate: readOwn(request, "estimate"),
  });
}

function identityOf(row: MistralRow): MistralIdentity {
  return Object.freeze({
    provider: row.provider,
    api: row.api,
    protocolModelID: row.protocolModelID,
  });
}

// ----- Input readers: own data properties only, accessors are never invoked -----

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

type MistralFailure = MistralInvalid | MistralInsufficient;

function rowOf(candidate: unknown): MistralRow | MistralFailure {
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
  if (provider !== MISTRAL_PROVIDER) {
    return Object.freeze({ kind: "insufficient", reason: "provider" });
  }
  if (api !== MISTRAL_API) {
    return Object.freeze({ kind: "insufficient", reason: "api" });
  }
  const row = ROW_BY_ID.get(protocolModelID);
  if (row === undefined) {
    return Object.freeze({ kind: "insufficient", reason: "model" });
  }
  return row;
}

function isRow(value: MistralRow | MistralFailure): value is MistralRow {
  return "protocolModelID" in value;
}

// Reads the range as a plain record with own from and to. Anything else, or any reversed pair, is undefined.
function boundsOf(range: unknown):
  | {
      readonly from: MistralLevel;
      readonly to: MistralLevel;
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
  const low = MISTRAL_CANONICAL_LEVELS.indexOf(from);
  const high = MISTRAL_CANONICAL_LEVELS.indexOf(to);
  return low > high ? undefined : { from, to, low, high };
}

type CallerCap =
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly value: number }
  | { readonly kind: "unknown" };

// The explicit kind is required: undefined and null are invalid, never absence by default.
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

type Estimate =
  | { readonly kind: "supplied"; readonly tokens: number }
  | { readonly kind: "unknown" };

function estimateOf(value: unknown): Estimate | undefined {
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

function invalid<Code extends MistralInvalidCode>(
  code: Code,
): { readonly kind: "invalid-input"; readonly code: Code } {
  return Object.freeze({ kind: "invalid-input", code });
}

function isCanonicalLevel(value: unknown): value is MistralLevel {
  return (MISTRAL_CANONICAL_LEVELS as readonly unknown[]).includes(value);
}

function isSupportedLevel(value: unknown): value is MistralSupportedLevel {
  return (MISTRAL_SUPPORTED_LEVELS as readonly unknown[]).includes(value);
}

function isPositiveLevel(value: unknown): value is MistralPositiveLevel {
  return (MISTRAL_POSITIVE_LEVELS as readonly unknown[]).includes(value);
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

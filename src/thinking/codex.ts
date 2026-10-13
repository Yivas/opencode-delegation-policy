// Pure source planner for the eight openai-codex-responses records of Pi AI 0.87.1 (provider "openai-codex", API
// "openai-codex-responses"). It reads no archive, calls no SDK and makes no request. Each result describes the
// `reasoning` object and the constant `include` entry that Pi's Simple path writes into the Codex request body
// (api/openai-codex-responses.js l. 354-369 and buildRequestBody l. 414-429). It is not the whole body, not a native
// request, not a provider acceptance and not a role proof.
// Other body fields are outside these recipes: text.verbosity is always present (default low), tool_choice defaults to
// auto and parallel_tool_calls is true. Raw options can override verbosity or add service_tier; Simple forwards neither
// textVerbosity nor serviceTier. These facts do not make the recipes a full request serializer.
//
// Advertised support follows models.js getSupportedThinkingLevels, which Pi's clamp uses. A level outside the advertised
// set is unsupported in this snapshot, even where the SDK clamp would map it to a neighbour. That clamp is recorded as
// source evidence only. Strings outside the canonical list are invalid; they are never clamped or defaulted.
//
// A positive level writes `{effort: map[level] ?? level, summary: "auto"}`. Off writes `{effort: map.off ?? "none"}` with no
// summary field; it is only advertised on rows whose map does not set off to null. Every recipe keeps
// `include: ["reasoning.encrypted_content"]`.
//
// The Simple cap is computed by buildBaseOptions and never reaches the body. The planner does not compute it, and it
// takes no context estimate or caller cap. Each result carries the descriptor CODEX_CAP_OMISSION, which states what the
// builder emits before onPayload. It is not an observation of the wire and not an instruction to remove a caller cap.
//
// Inputs are read through own data properties only; accessors are not invoked and inherited fields are rejected.
// Property-descriptor traps may execute; their errors and revoked-proxy failures return fixed codes without echoing
// the caller's values. Every result is deeply frozen and no input is modified.

export const CODEX_PROVIDER = "openai-codex" as const;
export const CODEX_API = "openai-codex-responses" as const;

export const CODEX_CANONICAL_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);
export type CodexLevel = (typeof CODEX_CANONICAL_LEVELS)[number];

export type CodexThinkingLevelMap = Readonly<
  Partial<Record<CodexLevel, string | null>>
>;

export type CodexRow = {
  readonly provider: typeof CODEX_PROVIDER;
  readonly api: typeof CODEX_API;
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly thinkingLevelMap: CodexThinkingLevelMap;
  readonly supportedLevels: readonly CodexLevel[];
};

// The eight exact records of providers/data/openai-codex.json under "openai-codex-responses". Maps are copied in JSON
// order. Advertised sets are the output of getSupportedThinkingLevels for each map. Reference limits are catalogue
// values, not observed caps.
type CatalogueSeed = {
  readonly protocolModelID: string;
  readonly modelMaxTokens: number;
  readonly contextWindow: number;
  readonly thinkingLevelMap: CodexThinkingLevelMap;
  readonly supportedLevels: readonly CodexLevel[];
};

const SIX_LEVELS: readonly CodexLevel[] = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
const SEVEN_LEVELS: readonly CodexLevel[] = Object.freeze([
  ...SIX_LEVELS,
  "max",
]);
const ASTRA_LEVELS: readonly CodexLevel[] = Object.freeze([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const CATALOGUE_SEED: readonly CatalogueSeed[] = [
  {
    protocolModelID: "gpt-5.3-codex-spark",
    modelMaxTokens: 128000,
    contextWindow: 128000,
    thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
    supportedLevels: SIX_LEVELS,
  },
  {
    protocolModelID: "gpt-5.5",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
    supportedLevels: SIX_LEVELS,
  },
  {
    protocolModelID: "gpt-5.6-luna",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" },
    supportedLevels: SEVEN_LEVELS,
  },
  {
    protocolModelID: "gpt-5.6-sol",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" },
    supportedLevels: SEVEN_LEVELS,
  },
  {
    protocolModelID: "gpt-5.6-terra",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" },
    supportedLevels: SEVEN_LEVELS,
  },
  {
    protocolModelID: "gpt-6-astra",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: {
      off: null,
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    supportedLevels: ASTRA_LEVELS,
  },
  {
    protocolModelID: "gpt-6-luna",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: {
      off: "none",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    supportedLevels: SEVEN_LEVELS,
  },
  {
    protocolModelID: "gpt-6-sol",
    modelMaxTokens: 128000,
    contextWindow: 272000,
    thinkingLevelMap: {
      off: "none",
      minimal: "low",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    supportedLevels: SEVEN_LEVELS,
  },
];

function rowFrom(seed: CatalogueSeed): CodexRow {
  return Object.freeze({
    provider: CODEX_PROVIDER,
    api: CODEX_API,
    protocolModelID: seed.protocolModelID,
    modelMaxTokens: seed.modelMaxTokens,
    contextWindow: seed.contextWindow,
    thinkingLevelMap: Object.freeze({ ...seed.thinkingLevelMap }),
    supportedLevels: Object.freeze([...seed.supportedLevels]),
  });
}

export const CODEX_CATALOGUE: readonly CodexRow[] = Object.freeze(
  CATALOGUE_SEED.map(rowFrom),
);
// Lookup rows are built apart from the exported rows, so no exported object can change a lookup.
const ROW_BY_ID: ReadonlyMap<string, CodexRow> = new Map(
  CATALOGUE_SEED.map((seed): [string, CodexRow] => [
    seed.protocolModelID,
    rowFrom(seed),
  ]),
);

export const CODEX_SOURCE_SCOPE =
  "pi-ai@0.87.1 api/openai-codex-responses.js streamSimple l. 354-369 and buildRequestBody l. 414-429";

export const CODEX_SDK_CLAMP_EVIDENCE =
  "pi-ai@0.87.1 models.js clampThinkingLevel l. 566-584 and api/openai-codex-responses.js l. 363-364: the SDK clamp maps an unadvertised level to a neighbour (max to xhigh where max is not advertised; the string off to minimal on gpt-6-astra). Source evidence, not policy admission";

export const CODEX_SOURCE_HASHES: Readonly<Record<string, string>> =
  Object.freeze({
    "api/openai-codex-responses.js":
      "6e69310d77278231cfc87d7f03ee815d4a0f2ff273e6c43fcee6835e7df2b0c7",
    "providers/data/openai-codex.json":
      "4bb30a26d1b40e1f67c9f24891fca0ce25b030bc4cbbb529be78608cd4466fdf",
    "models.js":
      "75fa33149fb608bc4a7b7a0586c8ca8f0024465d580091b0c426c0baf3fbc80a",
  });

// Descriptor for the builder's cap, scoped to the planner's source. It states what Pi's builder emits before onPayload.
// It is neither a wire observation nor an instruction to remove a caller's cap.
export const CODEX_CAP_OMISSION =
  "pi-builder-emits-no-cap-field-before-on-payload" as const;

// Conditions every planned or unsupported result keeps. None is discharged by this module.
export const CODEX_CONDITIONS = Object.freeze([
  "truthy-api-key-prerequisite-simple-and-raw",
  "account-id-token-claim-prerequisite",
  "successful-simple-preprocessing",
  "source-identity-catalogue-provenance",
  "on-payload-full-body-replacement",
  "native-provider-model-transport-correspondence-unknown",
  "native-control-defaults-not-asserted",
  "body-overlays-and-settings-unobserved",
  "provider-effort-and-summary-acceptance-unknown",
  "auth-runtime-unexecuted",
  "later-writers-and-peers",
] as const);
export type CodexCondition = (typeof CODEX_CONDITIONS)[number];

const INCLUDE = Object.freeze(["reasoning.encrypted_content"] as const);

// ----- Public result types -----

export type CodexRecipe = {
  readonly reasoning: {
    readonly effort: string;
    readonly summary?: "auto";
  };
  readonly include: typeof INCLUDE;
};

export type CodexCandidate = {
  readonly recipe: CodexRecipe;
  // "absent" is the off recipe: the builder writes no summary field for it.
  readonly summary: "auto" | "absent";
  // Every advertised level that writes this exact reasoning object, in canonical order. Never narrowed.
  readonly compatibleLevels: readonly CodexLevel[];
  // The requested levels that fall in this class, in canonical order. Nothing is selected.
  readonly admittedLevels: readonly CodexLevel[];
};

export type CodexIdentity = {
  readonly provider: typeof CODEX_PROVIDER;
  readonly api: typeof CODEX_API;
  readonly protocolModelID: string;
};

export type CodexPlanned = {
  readonly kind: "planned";
  readonly scope: "level" | "range";
  readonly source: typeof CODEX_SOURCE_SCOPE;
  readonly identity: CodexIdentity;
  readonly requested: { readonly from: CodexLevel; readonly to: CodexLevel };
  readonly supportedLevels: readonly CodexLevel[];
  readonly admittedLevels: readonly CodexLevel[];
  // Canonical levels inside a range that the row does not advertise. Empty for a fixed level.
  readonly excludedLevels: readonly CodexLevel[];
  readonly candidates: readonly CodexCandidate[];
  readonly capOmission: typeof CODEX_CAP_OMISSION;
  readonly conditions: readonly CodexCondition[];
};

export type CodexUnsupported =
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly scope: "level";
      readonly level: CodexLevel;
      readonly sourceEvidence: typeof CODEX_SDK_CLAMP_EVIDENCE;
      readonly source: typeof CODEX_SOURCE_SCOPE;
      readonly capOmission: typeof CODEX_CAP_OMISSION;
      readonly conditions: readonly CodexCondition[];
    }
  | {
      readonly kind: "unsupported-in-snapshot";
      readonly scope: "range";
      readonly source: typeof CODEX_SOURCE_SCOPE;
      readonly capOmission: typeof CODEX_CAP_OMISSION;
      readonly conditions: readonly CodexCondition[];
    };

export type CodexInvalidCode = "candidate" | "level" | "range";

export type CodexInvalid = {
  readonly kind: "invalid-input";
  readonly code: CodexInvalidCode;
};

export type CodexInsufficient = {
  readonly kind: "insufficient";
  readonly reason: "provider" | "api" | "model";
};

export type CodexPlan =
  | CodexPlanned
  | CodexUnsupported
  | CodexInsufficient
  | CodexInvalid;

// ----- Planners -----

// Plans one canonical level for one exact record. Advertised levels plan; an unadvertised canonical level is
// unsupported in the snapshot. Any other value is invalid. Nothing is selected and no default level exists.
export function planCodexLevel(candidate: unknown, level: unknown): CodexPlan {
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
      sourceEvidence: CODEX_SDK_CLAMP_EVIDENCE,
      source: CODEX_SOURCE_SCOPE,
      capOmission: CODEX_CAP_OMISSION,
      conditions: CODEX_CONDITIONS,
    });
  }
  return plannedOf(row, "level", { from: level, to: level }, [level], []);
}

// Plans an inclusive canonical range. The admitted levels are the range intersected with the advertised levels, and
// unadvertised levels inside the range are reported as excluded. A range with no advertised member is unsupported.
// Each class keeps its full compatible set, and nothing is selected.
export function planCodexRange(candidate: unknown, range: unknown): CodexPlan {
  const row = rowOf(candidate);
  if (!isRow(row)) {
    return row;
  }
  const bounds = boundsOf(range);
  if (bounds === undefined) {
    return invalid("range");
  }
  const span = CODEX_CANONICAL_LEVELS.slice(bounds.low, bounds.high + 1);
  const admitted = span.filter((level) => row.supportedLevels.includes(level));
  const excluded = span.filter((level) => !row.supportedLevels.includes(level));
  if (admitted.length === 0) {
    return Object.freeze({
      kind: "unsupported-in-snapshot",
      scope: "range",
      source: CODEX_SOURCE_SCOPE,
      capOmission: CODEX_CAP_OMISSION,
      conditions: CODEX_CONDITIONS,
    });
  }
  return plannedOf(
    row,
    "range",
    { from: bounds.from, to: bounds.to },
    admitted,
    excluded,
  );
}

// ----- Recipes and classes -----

function recipeOf(row: CodexRow, level: CodexLevel): CodexRecipe {
  // Off is only reached when it is advertised, which excludes a null map value. Pi's off branch then writes `map.off ?? "none"`.
  if (level === "off") {
    return Object.freeze({
      reasoning: Object.freeze({ effort: row.thinkingLevelMap.off ?? "none" }),
      include: INCLUDE,
    });
  }
  return Object.freeze({
    reasoning: Object.freeze({
      effort: row.thinkingLevelMap[level] ?? level,
      summary: "auto" as const,
    }),
    include: INCLUDE,
  });
}

function keyOf(recipe: CodexRecipe): string {
  return JSON.stringify(recipe.reasoning);
}

// Groups the row's advertised levels by their exact reasoning object, then reports the classes that contain an admitted
// level. The compatible set is the full advertised class, so a narrower requirement never shrinks it.
function candidatesFor(
  row: CodexRow,
  admitted: readonly CodexLevel[],
): CodexCandidate[] {
  const advertisedByKey = new Map<string, CodexLevel[]>();
  for (const level of row.supportedLevels) {
    const key = keyOf(recipeOf(row, level));
    advertisedByKey.set(key, [...(advertisedByKey.get(key) ?? []), level]);
  }
  const result: CodexCandidate[] = [];
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
        recipe,
        summary: recipe.reasoning.summary === "auto" ? "auto" : "absent",
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
  row: CodexRow,
  scope: "level" | "range",
  requested: { readonly from: CodexLevel; readonly to: CodexLevel },
  admitted: readonly CodexLevel[],
  excluded: readonly CodexLevel[],
): CodexPlanned {
  return Object.freeze({
    kind: "planned",
    scope,
    source: CODEX_SOURCE_SCOPE,
    identity: identityOf(row),
    requested: Object.freeze({ ...requested }),
    supportedLevels: row.supportedLevels,
    admittedLevels: Object.freeze([...admitted]),
    excludedLevels: Object.freeze([...excluded]),
    candidates: Object.freeze(candidatesFor(row, admitted)),
    capOmission: CODEX_CAP_OMISSION,
    conditions: CODEX_CONDITIONS,
  });
}

function identityOf(row: CodexRow): CodexIdentity {
  return Object.freeze({
    provider: row.provider,
    api: row.api,
    protocolModelID: row.protocolModelID,
  });
}

// ----- Input readers: own data properties only, no accessors; descriptor failures are opaque -----

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

type CodexFailure = CodexInvalid | CodexInsufficient;

function rowOf(candidate: unknown): CodexRow | CodexFailure {
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
  if (provider !== CODEX_PROVIDER) {
    return Object.freeze({ kind: "insufficient", reason: "provider" });
  }
  if (api !== CODEX_API) {
    return Object.freeze({ kind: "insufficient", reason: "api" });
  }
  const row = ROW_BY_ID.get(protocolModelID);
  if (row === undefined) {
    return Object.freeze({ kind: "insufficient", reason: "model" });
  }
  return row;
}

function isRow(value: CodexRow | CodexFailure): value is CodexRow {
  return "protocolModelID" in value;
}

// Reads the range as a plain record with own from and to. Anything else, including a revoked proxy, is undefined.
function boundsOf(range: unknown):
  | {
      readonly from: CodexLevel;
      readonly to: CodexLevel;
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
  const low = CODEX_CANONICAL_LEVELS.indexOf(from);
  const high = CODEX_CANONICAL_LEVELS.indexOf(to);
  return low > high ? undefined : { from, to, low, high };
}

// ----- Guards and small helpers -----

function invalid(code: CodexInvalidCode): CodexInvalid {
  return Object.freeze({ kind: "invalid-input", code });
}

function isCanonicalLevel(value: unknown): value is CodexLevel {
  return (CODEX_CANONICAL_LEVELS as readonly unknown[]).includes(value);
}

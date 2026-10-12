import type { ThinkingLevel } from "./policies.js";

// Pure facts about Google models: which exact model id Pi maps to which request control, and the SDK
// value that control serializes to. Nothing here calls a provider, the SDK or the host.
//
// Sources, all read-only. Pi is @earendil-works/pi-ai 0.87.1 (git f07218c4d4bbc12bef056a7058c3dd49dfe41abe):
// dist/api/google-generative-ai.js and google-vertex.js (getGoogleBudget, buildParams, streamSimple),
// dist/api/google-shared.js (usesGoogleThinkingLevel, resolveGoogleThinkingLevel, toGoogleThinkingLevel,
// getDisabledGoogleThinkingConfig), dist/models.js (getSupportedThinkingLevels, clampThinkingLevel), and
// dist/providers/data/google.json and google-vertex.json for the per-id thinkingLevelMap. The 1.1.0 archive
// carries the same maps and the same budget and level code for these ids. The SDK is @google/genai 2.21.0:
// dist/genai.d.ts ThinkingConfig and ThinkingLevel. OpenCode's native gemini reader is
// packages/ai/src/protocols/gemini.ts (blob 8c02f11c) with fitThinkingBudget in shared.ts (blob bd8d2538).
//
// Pending is not unsupported. A budget control (positive, -1 or 0) depends on the final request cap and on
// includeThoughts, which this module cannot know; it stays a conditional candidate until a public runtime
// gate proves them. A level control has no budget dependence and stays unconditional.

export type GoogleApi = "google-generative-ai" | "google-vertex";

// Values of the ThinkingLevel enum in @google/genai 2.21.0. Pi serializes these exact strings.
export type GoogleThinkingLevelWire = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

// The request fields Pi sends for one level. `includeThoughts` is present only where Pi sends it; the
// disabled budget config omits it, and that gap is an explicit condition, not an equality.
export type GoogleControl = {
  readonly includeThoughts?: true;
  readonly thinkingLevel?: GoogleThinkingLevelWire;
  readonly thinkingBudget?: number;
};

export type GoogleCondition =
  | { readonly kind: "request-cap"; readonly budget: number }
  | { readonly kind: "include-thoughts-unproven" };

export type GoogleIncompatibleReason =
  | "scope"
  | "null-level"
  | "unsupported-level"
  | "inline-control-conflict"
  | "unknown-wire";

// `compatibleLevels` lists every canonical level whose request Pi serializes to this same control. It is a
// set of logical equivalences: a level in it is not a claim about how much effort the model spends. A
// requirement never narrows it; the caller picks from an admitted set outside this module.
export type GoogleCompatibility =
  | {
      readonly kind: "incompatible";
      readonly reason: GoogleIncompatibleReason;
      readonly requestedLevel?: ThinkingLevel;
    }
  | {
      readonly kind: "compatible-unconditional";
      readonly compatibleLevels: readonly ThinkingLevel[];
      readonly control: GoogleControl;
      readonly evidence: string;
    }
  | {
      readonly kind: "compatible-conditional";
      readonly compatibleLevels: readonly ThinkingLevel[];
      readonly control: GoogleControl;
      readonly condition: GoogleCondition;
      readonly evidence: string;
    };

// One admitted level with its own compatibility. A level is never selected here.
export type GoogleRangeCandidate = {
  readonly level: ThinkingLevel;
  readonly compatibility: GoogleCompatibility;
};

export type GoogleRangePlan =
  | {
      readonly kind: "incompatible";
      readonly reason: "scope" | "no-admitted-level";
    }
  | {
      readonly kind: "planned";
      // Every level the recipe serves, across its controls. Each candidate's own set is in its compatibility.
      readonly compatibleLevels: readonly ThinkingLevel[];
      readonly admittedLevels: readonly ThinkingLevel[];
      readonly candidates: readonly GoogleRangeCandidate[];
    };

// The output limit the request actually sends. `unknown` means the value is not known here and must never be
// read as absent or defaulted. `absent` means the request sends no output limit. `known` must be a finite
// positive number: a host or hook can change it, so this module does not invent a default.
export type GoogleRequestCap =
  | { readonly kind: "unknown" }
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly maxTokens: number };

export type GoogleGateFailure =
  | "incompatible"
  | "cap-unknown"
  | "cap-invalid"
  | "budget-changed"
  | "include-thoughts-unproven";

export type GoogleGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: GoogleGateFailure };

export type GoogleRangeRejection = {
  readonly level: ThinkingLevel;
  readonly reason: GoogleGateFailure;
};

// `none-passing` is not success: it means every admitted candidate was refused for this cap.
export type GoogleRangeVerdict =
  | {
      readonly kind: "incompatible";
      readonly reason: "scope" | "no-admitted-level";
    }
  | {
      readonly kind: "passing";
      readonly levels: readonly ThinkingLevel[];
      readonly candidates: readonly GoogleRangeCandidate[];
      readonly rejected: readonly GoogleRangeRejection[];
    }
  | {
      readonly kind: "none-passing";
      readonly rejected: readonly GoogleRangeRejection[];
    };

export type GoogleThinkingConfigInput = {
  readonly thinkingLevel?: unknown;
  readonly thinkingBudget?: unknown;
  readonly includeThoughts?: unknown;
};

// Pi's canonical order. `off` sorts first, `xhigh` and `max` last, so ranges read in one direction.
const LEVEL_ORDER: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const POSITIVE_LEVELS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
];
const WIRE_LEVELS: readonly GoogleThinkingLevelWire[] = [
  "MINIMAL",
  "LOW",
  "MEDIUM",
  "HIGH",
];

// @google/genai 2.21.0 documents thinkingBudget -1 as AUTOMATIC. Pi's fallback sends -1 for these ids. The same
// number is sent for every positive level, so it is one wire serving four logical levels, not four efforts.
const DYNAMIC_FALLBACK_BUDGET = -1;
// OpenCode's gemini reader caps a budget with fitThinkingBudget(budget, maxTokens, 512) (gemini.ts; shared.ts).
const GOOGLE_BUDGET_FIT_MINIMUM = 512;

type LevelRecipe = {
  readonly transport: "level";
  readonly wire: Readonly<
    Partial<Record<ThinkingLevel, GoogleThinkingLevelWire>>
  >;
};
type BudgetRecipe = {
  readonly transport: "budget";
  readonly budgets: Readonly<Partial<Record<ThinkingLevel, number>>>;
};
type DynamicRecipe = { readonly transport: "dynamic" };
type Recipe = LevelRecipe | BudgetRecipe | DynamicRecipe;

type RecipeEntry = {
  readonly level: ThinkingLevel;
  readonly control: GoogleControl;
  readonly condition?: GoogleCondition;
};

const FLASH_LEVEL: LevelRecipe = Object.freeze({
  transport: "level",
  wire: Object.freeze({
    minimal: "MINIMAL",
    low: "LOW",
    medium: "MEDIUM",
    high: "HIGH",
  }),
});
// Pro-class levels: getSupportedThinkingLevels excludes minimal because its map entry is null.
const PRO_LEVEL: LevelRecipe = Object.freeze({
  transport: "level",
  wire: Object.freeze({ low: "LOW", medium: "MEDIUM", high: "HIGH" }),
});
// Gemma and the flash-lite image id: low and medium are null, so Pi clamps them upward to high.
const MINIMAL_HIGH_LEVEL: LevelRecipe = Object.freeze({
  transport: "level",
  wire: Object.freeze({ minimal: "MINIMAL", high: "HIGH" }),
});
const PRO_BUDGET: BudgetRecipe = Object.freeze({
  transport: "budget",
  budgets: Object.freeze({
    minimal: 128,
    low: 2048,
    medium: 8192,
    high: 32768,
  }),
});
const FLASH_BUDGET: BudgetRecipe = Object.freeze({
  transport: "budget",
  budgets: Object.freeze({
    minimal: 128,
    low: 2048,
    medium: 8192,
    high: 24576,
  }),
});
// Only the genai package has a flash-lite branch. Vertex falls through to the flash table.
const GENAI_FLASH_LITE_BUDGET: BudgetRecipe = Object.freeze({
  transport: "budget",
  budgets: Object.freeze({
    minimal: 512,
    low: 2048,
    medium: 8192,
    high: 24576,
  }),
});
const DYNAMIC: DynamicRecipe = Object.freeze({ transport: "dynamic" });

const RECIPES = new Map<string, Recipe>();

function recipeKey(api: GoogleApi, modelID: string): string {
  return JSON.stringify([api, modelID]);
}

// Exact ids only. An alias, a dated variant or a prefix is not registered, so it gets no recipe.
function register(
  api: GoogleApi,
  modelIDs: readonly string[],
  recipe: Recipe,
): void {
  for (const modelID of modelIDs) {
    RECIPES.set(recipeKey(api, modelID), recipe);
  }
}

register(
  "google-generative-ai",
  [
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-live-preview",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
  ],
  FLASH_LEVEL,
);
register(
  "google-generative-ai",
  [
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
  ],
  PRO_LEVEL,
);
register(
  "google-generative-ai",
  ["gemini-3.1-flash-lite-image", "gemma-4-26b-a4b-it", "gemma-4-31b-it"],
  MINIMAL_HIGH_LEVEL,
);
register(
  "google-vertex",
  [
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
  ],
  FLASH_LEVEL,
);
register(
  "google-vertex",
  [
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
  ],
  PRO_LEVEL,
);
register("google-generative-ai", ["gemini-2.5-pro"], PRO_BUDGET);
register("google-generative-ai", ["gemini-2.5-flash"], FLASH_BUDGET);
register(
  "google-generative-ai",
  ["gemini-2.5-flash-lite"],
  GENAI_FLASH_LITE_BUDGET,
);
register("google-vertex", ["gemini-2.5-pro"], PRO_BUDGET);
register(
  "google-vertex",
  ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
  FLASH_BUDGET,
);
// Pi's getGoogleBudget has no branch for these ids and falls back to -1; disabled is still the budget-0 config.
register(
  "google-generative-ai",
  [
    "gemini-2.5-computer-use-preview-10-2025",
    "deep-research-preview-04-2026",
    "deep-research-max-preview-04-2026",
  ],
  DYNAMIC,
);

// The package names are OpenCode's public provider packages (packages/core/src/variant.ts, blob c07fcf13,
// PROTOCOLS); providerIDs "google" and "google-vertex" are the provider.ts ids (blob e21d087e). Dispatch is by
// package only; the host's model id is never canonicalized here.
export function googleApiForPackage(
  packageName: unknown,
): GoogleApi | undefined {
  if (packageName === "@opencode/ai/providers/google") {
    return "google-generative-ai";
  }
  if (packageName === "@opencode/ai/providers/google-vertex") {
    return "google-vertex";
  }
  return undefined;
}

function recipeFor(api: GoogleApi, modelID: string): Recipe | undefined {
  return RECIPES.get(recipeKey(api, modelID));
}

// Pi's disabled config for every budget-style recipe, including the dynamic ones: budget 0 with no
// includeThoughts field. Whether that field changes the output is unproven, so the entry stays conditional.
function disabledEntry(): RecipeEntry {
  return {
    level: "off",
    control: { thinkingBudget: 0 },
    condition: { kind: "include-thoughts-unproven" },
  };
}

// Every request Pi can send for this recipe, with the canonical level that asks for it.
function entriesOf(recipe: Recipe): readonly RecipeEntry[] {
  if (recipe.transport === "level") {
    return POSITIVE_LEVELS.flatMap((level) => {
      const wire = recipe.wire[level];
      return wire === undefined
        ? []
        : [{ level, control: { includeThoughts: true, thinkingLevel: wire } }];
    });
  }
  if (recipe.transport === "dynamic") {
    return [
      disabledEntry(),
      ...POSITIVE_LEVELS.map(
        (level): RecipeEntry => ({
          level,
          control: {
            includeThoughts: true,
            thinkingBudget: DYNAMIC_FALLBACK_BUDGET,
          },
          condition: { kind: "request-cap", budget: DYNAMIC_FALLBACK_BUDGET },
        }),
      ),
    ];
  }
  const positive = POSITIVE_LEVELS.flatMap((level): RecipeEntry[] => {
    const budget = recipe.budgets[level];
    return budget === undefined
      ? []
      : [
          {
            level,
            control: { includeThoughts: true, thinkingBudget: budget },
            condition: { kind: "request-cap", budget },
          },
        ];
  });
  return [disabledEntry(), ...positive];
}

function sameControl(left: GoogleControl, right: GoogleControl): boolean {
  return (
    left.thinkingLevel === right.thinkingLevel &&
    left.thinkingBudget === right.thinkingBudget
  );
}

function evidenceFor(
  api: GoogleApi,
  modelID: string,
  recipe: Recipe,
  entry: RecipeEntry,
): string {
  const source = `pi-ai@0.87.1 ${api} ${modelID}`;
  if (recipe.transport === "level") {
    return `${source} thinkingLevelMap ${entry.level}; @google/genai@2.21.0 ThinkingLevel`;
  }
  if (recipe.transport === "dynamic") {
    return entry.level === "off"
      ? `${source} getDisabledGoogleThinkingConfig; @google/genai@2.21.0 thinkingBudget 0`
      : `${source} getGoogleBudget fallback -1; @google/genai@2.21.0 thinkingBudget -1 (AUTOMATIC, same wire for every positive level)`;
  }
  const descriptor =
    entry.level === "off"
      ? "getDisabledGoogleThinkingConfig"
      : `getGoogleBudget ${entry.level}`;
  return `${source} ${descriptor}; @google/genai@2.21.0 thinkingBudget`;
}

function incompatible(
  reason: GoogleIncompatibleReason,
  requestedLevel?: ThinkingLevel,
): GoogleCompatibility {
  return requestedLevel === undefined
    ? { kind: "incompatible", reason }
    : { kind: "incompatible", reason, requestedLevel };
}

function compatibleFrom(
  api: GoogleApi,
  modelID: string,
  recipe: Recipe,
  entry: RecipeEntry,
): GoogleCompatibility {
  const compatibleLevels = entriesOf(recipe)
    .filter((other) => sameControl(other.control, entry.control))
    .map((other) => other.level);
  const evidence = evidenceFor(api, modelID, recipe, entry);
  if (entry.condition === undefined) {
    return {
      kind: "compatible-unconditional",
      compatibleLevels,
      control: entry.control,
      evidence,
    };
  }
  return {
    kind: "compatible-conditional",
    compatibleLevels,
    control: entry.control,
    condition: entry.condition,
    evidence,
  };
}

// Plans the control Pi sends for one requested canonical level. No alias, clamp or largest-budget
// inheritance: a level Pi does not serialize for this exact id is incompatible.
export function planGoogleLevel(
  api: GoogleApi,
  modelID: string,
  requested: ThinkingLevel,
): GoogleCompatibility {
  const recipe = recipeFor(api, modelID);
  if (recipe === undefined) {
    return incompatible("scope", requested);
  }
  if (requested === "xhigh" || requested === "max") {
    return incompatible("unsupported-level", requested);
  }
  const entry = entriesOf(recipe).find(
    (candidate) => candidate.level === requested,
  );
  if (entry !== undefined) {
    return compatibleFrom(api, modelID, recipe, entry);
  }
  // A null map entry (for example off or minimal on pro) has no control of its own. Pi's clamp would
  // send a different level, which is not a proof for the requested one.
  return incompatible("null-level", requested);
}

// Plans a native thinkingConfig, one field family at a time. Exactly one of thinkingLevel or thinkingBudget
// must be present. The native reader treats an omitted includeThoughts as true (gemini.ts), so only an
// explicit false conflicts. The planner never reads a requested level, so the result has no level field.
export function planGoogleThinkingConfig(
  api: GoogleApi,
  modelID: string,
  config: GoogleThinkingConfigInput,
): GoogleCompatibility {
  const recipe = recipeFor(api, modelID);
  if (recipe === undefined) {
    return incompatible("scope");
  }
  if (config.includeThoughts !== undefined && config.includeThoughts !== true) {
    return incompatible("inline-control-conflict");
  }
  const level = config.thinkingLevel;
  const budget = config.thinkingBudget;
  if ((level === undefined) === (budget === undefined)) {
    return incompatible("inline-control-conflict");
  }
  if (level !== undefined) {
    if (!isWireLevel(level)) {
      return incompatible("unknown-wire");
    }
    if (recipe.transport !== "level") {
      return incompatible("scope");
    }
    const entry = entriesOf(recipe).find(
      (candidate) => candidate.control.thinkingLevel === level,
    );
    return entry === undefined
      ? incompatible("null-level")
      : compatibleFrom(api, modelID, recipe, entry);
  }
  if (typeof budget !== "number" || !Number.isFinite(budget)) {
    return incompatible("unknown-wire");
  }
  if (recipe.transport === "level") {
    return incompatible("scope");
  }
  const entry = entriesOf(recipe).find(
    (candidate) => candidate.control.thinkingBudget === budget,
  );
  return entry === undefined
    ? incompatible("null-level")
    : compatibleFrom(api, modelID, recipe, entry);
}

// Admitted canonical levels inside an inclusive range. Each admitted level keeps its own candidate, so a
// caller sees every option and chooses none here.
export function planGoogleRange(
  api: GoogleApi,
  modelID: string,
  range: { readonly from: ThinkingLevel; readonly to: ThinkingLevel },
): GoogleRangePlan {
  const recipe = recipeFor(api, modelID);
  if (recipe === undefined) {
    return { kind: "incompatible", reason: "scope" };
  }
  const low = LEVEL_ORDER.indexOf(range.from);
  const high = LEVEL_ORDER.indexOf(range.to);
  const candidates: GoogleRangeCandidate[] = [];
  for (const level of LEVEL_ORDER) {
    const rank = LEVEL_ORDER.indexOf(level);
    if (rank < low || rank > high) {
      continue;
    }
    const compatibility = planGoogleLevel(api, modelID, level);
    if (compatibility.kind === "incompatible") {
      continue;
    }
    candidates.push({ level, compatibility });
  }
  if (candidates.length === 0) {
    return { kind: "incompatible", reason: "no-admitted-level" };
  }
  return {
    kind: "planned",
    compatibleLevels: entriesOf(recipe).map((entry) => entry.level),
    admittedLevels: candidates.map((candidate) => candidate.level),
    candidates,
  };
}

// OpenCode's native fit (shared.ts fitThinkingBudget) for a known, valid output limit. It never runs without
// a limit: an absent limit leaves the budget unchanged, and an unknown one is refused by the verifier.
function fitGoogleBudget(budget: number, maxTokens: number): number {
  return budget <= maxTokens / 2
    ? budget
    : Math.max(GOOGLE_BUDGET_FIT_MINIMUM, Math.floor(maxTokens / 2));
}

function isValidKnownCap(maxTokens: number): boolean {
  return Number.isFinite(maxTokens) && maxTokens > 0;
}

// Decides whether one planned candidate may be sent for this request. A candidate is not authority by
// itself. A known cap that is not a finite positive number is refused for every candidate, before any early
// return. A level control has no budget dependence and passes with any valid or unknown cap. A budget
// control (including -1 and budget 0) passes only when its cap is absent or proves the native fit; an
// unknown cap is refused, because a hook can change the output limit. include-thoughts-unproven is refused
// for budget 0 regardless of the cap. Nothing here connects this check to a production gate.
export function verifyGoogleCandidate(
  candidate: GoogleCompatibility,
  cap: GoogleRequestCap,
): GoogleGate {
  if (candidate.kind === "incompatible") {
    return { ok: false, reason: "incompatible" };
  }
  if (cap.kind === "known" && !isValidKnownCap(cap.maxTokens)) {
    return { ok: false, reason: "cap-invalid" };
  }
  if (candidate.kind === "compatible-unconditional") {
    return { ok: true };
  }
  const condition = candidate.condition;
  if (condition.kind === "include-thoughts-unproven") {
    return { ok: false, reason: "include-thoughts-unproven" };
  }
  if (cap.kind === "unknown") {
    return { ok: false, reason: "cap-unknown" };
  }
  if (cap.kind === "absent") {
    return { ok: true };
  }
  return fitGoogleBudget(condition.budget, cap.maxTokens) === condition.budget
    ? { ok: true }
    : { ok: false, reason: "budget-changed" };
}

// Filters the admitted candidates of a range plan by their own gate, and returns only those that pass. The
// result keeps every refused level with its reason, so nothing is hidden. It never selects a first level or
// a variant, and an empty passing set is `none-passing`, not success.
//
// Not connected to any production gate now. The role validator in validation/models.ts still accepts only
// unconditional proofs and keeps rejecting conditional candidates. A future per-request launch path may call
// this with its final cap; wiring it in is a separate decision.
export function verifyGoogleRange(
  plan: GoogleRangePlan,
  cap: GoogleRequestCap,
): GoogleRangeVerdict {
  if (plan.kind === "incompatible") {
    return plan;
  }
  const candidates: GoogleRangeCandidate[] = [];
  const rejected: GoogleRangeRejection[] = [];
  for (const candidate of plan.candidates) {
    const gate = verifyGoogleCandidate(candidate.compatibility, cap);
    if (gate.ok) {
      candidates.push(candidate);
    } else {
      rejected.push({ level: candidate.level, reason: gate.reason });
    }
  }
  if (candidates.length === 0) {
    return { kind: "none-passing", rejected };
  }
  return {
    kind: "passing",
    levels: candidates.map((candidate) => candidate.level),
    candidates,
    rejected,
  };
}

function isWireLevel(value: unknown): value is GoogleThinkingLevelWire {
  return (
    typeof value === "string" &&
    (WIRE_LEVELS as readonly string[]).includes(value)
  );
}

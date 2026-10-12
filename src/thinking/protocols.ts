import type { ThinkingLevel } from "./policies.js";

// Recognizes what a variant proves. The variant id is never read: a proof comes from the overlay
// that a public reader sends. Every proof names one transport and the contract it rests on:
//
// - "native": an effort field is serialized (reasoning_effort, output_config.effort, ...).
// - "budget": a token budget is serialized (Anthropic budget_tokens).
// - "binary": a thinking switch is serialized (enabled or disabled), with no effort.
//
// The compatible set is every canonical level that the same serialized request also means under
// Pi's translation for that exact model. A binary switch can be compatible with several levels; the
// proof keeps all of them, and only the caller's requirement narrows what is admitted.
//
// Evidence strings name the source and the exact scope:
// - "pi-ai@<version> <file> <model>": Pi's generated catalogue for that model (npm archive, read-only).
//   The model's thinkingLevelMap, reasoning flag, and compat decide the set. Pi archives used:
//   0.87.1 (git f07218c4d4bbc12bef056a7058c3dd49dfe41abe) and 1.1.0 (npm, sha512 verified).
// - "opencode@8a8bd622 <file>": OpenCode's own reader for that overlay. It proves the field is valid and
//   that the wire names the level. It does not prove Pi's translation, so it is never Pi parity.
//
// A family returns undefined when its overlay or model is outside the proof. Undefined means
// unmapped, never unsupported.

type Overlay = Readonly<Record<string, unknown>>;

export type TransportKind = "native" | "budget" | "binary";

export type ContractProof = {
  readonly transportKind: TransportKind;
  readonly compatibleLevels: readonly ThinkingLevel[];
  readonly evidence: string;
};

export type ProtocolModel = {
  readonly providerID: string;
  readonly modelID?: string;
  readonly package?: string;
  readonly limit?: { readonly output?: unknown };
  readonly settings?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
};

export type ProtocolVariant = {
  readonly id: string;
  readonly settings?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
};

type Family = (
  variant: ProtocolVariant,
  model: ProtocolModel,
) => ContractProof | undefined;

// OpenCode's generic wrappers name these three efforts as the host's documented defaults.
// Nothing here claims minimal, xhigh, or max for a wrapper: no Pi translation covers them.
const GENERIC_EFFORTS: readonly ThinkingLevel[] = ["low", "medium", "high"];

const OPENCODE_RESPONSES =
  "opencode@8a8bd622 packages/ai/src/protocols/utils/open-responses-options.ts";
const OPENCODE_CHAT =
  "opencode@8a8bd622 packages/ai/src/protocols/openai-chat.ts";
const OPENCODE_ALIBABA_CHAT =
  "opencode@8a8bd622 packages/ai/src/protocols/alibaba-chat.ts";
const OPENCODE_ZAI_MESSAGES =
  "opencode@8a8bd622 packages/ai/src/protocols/zai-messages.ts";
const OPENCODE_GEMINI = "opencode@8a8bd622 packages/ai/src/protocols/gemini.ts";
const OPENCODE_OPENROUTER =
  "opencode@8a8bd622 packages/ai/src/providers/openrouter.ts";
const OPENCODE_BEDROCK =
  "opencode@8a8bd622 packages/ai/src/protocols/bedrock-converse.ts";

const PI_ANTHROPIC_0_87_1 = "pi-ai@0.87.1 providers/data/anthropic.json";
const PI_ANTHROPIC_1_1_0 = "pi-ai@1.1.0 providers/data/anthropic.json";
const PI_ZAI_0_87_1 = "pi-ai@0.87.1 providers/data/zai.json";
const PI_MOONSHOT_0_87_1 = "pi-ai@0.87.1 providers/data/moonshotai.json";
const PI_DEEPSEEK_0_87_1 = "pi-ai@0.87.1 providers/data/deepseek.json";

// Pi default budgets (api/simple-options.js, 0.87.1). A budget is sent as the same number on the wire.
export const ANTHROPIC_PI_DEFAULT_BUDGETS: readonly (readonly [
  ThinkingLevel,
  number,
])[] = Object.freeze([
  ["minimal", 1024],
  ["low", 2048],
  ["medium", 8192],
  ["high", 16384],
]);
export const ANTHROPIC_ANSWER_RESERVE_TOKENS = 1024;
export const ANTHROPIC_MIN_THINKING_BUDGET = 1024;

// Anthropic models without forceAdaptiveThinking (0.87.1 catalogue, no thinkingLevelMap): Pi sends
// budget_tokens for a level and disabled otherwise, with the default supported levels off..high.
const ANTHROPIC_BUDGET_MODEL_IDS: ReadonlySet<string> = new Set([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
]);

type AdaptiveEntry = {
  readonly evidence: string;
  // true when the catalogue does not null off, so a disabled switch proves off.
  readonly offSupported: boolean;
  // effort wire value -> levels that the same effort proves (minimal is absent from the table when
  // its map is null; low proves minimal when the map leaves minimal unset, as Pi's clamp does).
  readonly efforts: Readonly<Record<string, readonly ThinkingLevel[]>>;
};

// Adaptive models from the exact Pi catalogue entries. Each key is the model id as OpenCode names it;
// Pi's "chat:" namespace is stripped only for this comparison. Haiku 5 without .5 is not in either archive.
const ANTHROPIC_ADAPTIVE_MODEL_ENTRIES: Readonly<
  Record<string, AdaptiveEntry>
> = {
  "claude-opus-4-6": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-opus-4-6`,
    offSupported: true,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      max: ["max"],
    },
  },
  "claude-sonnet-4-6": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-sonnet-4-6`,
    offSupported: true,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      max: ["max"],
    },
  },
  "claude-opus-4-7": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-opus-4-7`,
    offSupported: true,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  "claude-opus-4-8": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-opus-4-8`,
    offSupported: true,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  "claude-sonnet-5": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-sonnet-5`,
    offSupported: true,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  "claude-fable-5": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-fable-5`,
    offSupported: false,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  "claude-fable-5-1": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-fable-5-1`,
    offSupported: false,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  "claude-opus-5": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-opus-5`,
    offSupported: false,
    efforts: {
      low: ["minimal", "low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  // minimal:null in the catalogue: minimal is not supported, so low proves only low.
  "claude-opus-5-5": {
    evidence: `${PI_ANTHROPIC_0_87_1} claude-opus-5-5`,
    offSupported: false,
    efforts: {
      low: ["low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  // 1.1.0 only: the catalogue keys these as chat:claude-*-5-5 with the same map as opus-5-5.
  "claude-sonnet-5-5": {
    evidence: `${PI_ANTHROPIC_1_1_0} chat:claude-sonnet-5-5`,
    offSupported: false,
    efforts: {
      low: ["low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
  "claude-haiku-5-5": {
    evidence: `${PI_ANTHROPIC_1_1_0} chat:claude-haiku-5-5`,
    offSupported: false,
    efforts: {
      low: ["low"],
      medium: ["medium"],
      high: ["high"],
      xhigh: ["xhigh"],
      max: ["max"],
    },
  },
};

// Pi's budget for one level, after the model's output cap is applied. Pi caps each budget at
// limit - answer reserve, so levels can share one budget. This is the requested recipe at the
// model-derived cap; the request's own max_tokens can clamp it further at runtime.
export function anthropicBudgetLevels(
  outputLimit: unknown,
  budget: number,
): readonly ThinkingLevel[] {
  if (!isPositiveInteger(outputLimit)) {
    return [];
  }
  const cap = outputLimit - ANTHROPIC_ANSWER_RESERVE_TOKENS;
  if (cap < ANTHROPIC_MIN_THINKING_BUDGET) {
    return [];
  }
  return ANTHROPIC_PI_DEFAULT_BUDGETS.filter(
    ([, defaultBudget]) => Math.min(defaultBudget, cap) === budget,
  ).map(([level]) => level);
}

// The budgets Pi would send for one output limit, grouped by the value they share.
export function anthropicEffectiveBudgets(outputLimit: unknown): readonly {
  readonly budgetTokens: number;
  readonly levels: readonly ThinkingLevel[];
}[] {
  if (!isPositiveInteger(outputLimit)) {
    return [];
  }
  const cap = outputLimit - ANTHROPIC_ANSWER_RESERVE_TOKENS;
  if (cap < ANTHROPIC_MIN_THINKING_BUDGET) {
    return [];
  }
  const budgets = [
    ...new Set(
      ANTHROPIC_PI_DEFAULT_BUDGETS.map(([, value]) => Math.min(value, cap)),
    ),
  ];
  return budgets.map((budgetTokens) => ({
    budgetTokens,
    levels: anthropicBudgetLevels(outputLimit, budgetTokens),
  }));
}

export function isAnthropicBudgetModel(modelID: string): boolean {
  return ANTHROPIC_BUDGET_MODEL_IDS.has(modelID);
}

// Only plain and null-prototype objects carry own fields that JSON and the host would send.
export function isPlainRecord(value: unknown): value is Overlay {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function ownField(record: unknown, key: string): unknown {
  if (typeof record !== "object" || record === null) {
    return undefined;
  }
  return Object.hasOwn(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

// Undefined means present but not a proof: not a plain record, or it carries an own field outside
// `allowed`. An absent value reads as an empty record.
function exactFields(
  value: unknown,
  allowed: readonly string[],
): Overlay | undefined {
  if (value === undefined) {
    return {};
  }
  if (!isPlainRecord(value)) {
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined && !allowed.includes(key)) {
      return undefined;
    }
  }
  return value;
}

function effortLevels(
  value: unknown,
  allowed: readonly ThinkingLevel[],
): readonly ThinkingLevel[] {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? [value as ThinkingLevel]
    : [];
}

function proofOf(
  transportKind: TransportKind,
  evidence: string,
  levels: readonly ThinkingLevel[],
): ContractProof | undefined {
  return levels.length === 0
    ? undefined
    : { transportKind, compatibleLevels: levels, evidence };
}

function settingsOf(variant: ProtocolVariant): unknown {
  return ownField(variant, "settings");
}

function bodyOf(variant: ProtocolVariant): unknown {
  return ownField(variant, "body");
}

// The known reasoningEffort literals of the OpenAI responses schema (packages/ai/src/schema/options.ts,
// blob 88429a2d, at 8a8bd622): none, minimal, low, medium, high, xhigh, max. "none" and a literal
// "off" are not proofs of off here; the schema accepts any string, so only these names are read.
const RESPONSES_EFFORTS: readonly ThinkingLevel[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

// OpenCode responses reader: reasoningEffort reaches the request; summary and include do not change it.
// Only openai and xai use the known literal set. Other Responses-shaped branches keep the generic names.
function responsesFamilyWith(levels: readonly ThinkingLevel[]): Family {
  return (variant) => {
    const settings = exactFields(settingsOf(variant), [
      "include",
      "reasoningEffort",
      "reasoningSummary",
    ]);
    if (settings === undefined || bodyOf(variant) !== undefined) {
      return undefined;
    }
    return proofOf(
      "native",
      OPENCODE_RESPONSES,
      effortLevels(ownField(settings, "reasoningEffort"), levels),
    );
  };
}

const responsesFamily: Family = responsesFamilyWith(RESPONSES_EFFORTS);
const genericResponsesFamily: Family = responsesFamilyWith(GENERIC_EFFORTS);

// OpenCode chat reader: reasoningEffort is sent as reasoning_effort.
const chatFamily: Family = (variant) => {
  const settings = exactFields(settingsOf(variant), ["reasoningEffort"]);
  if (settings === undefined || bodyOf(variant) !== undefined) {
    return undefined;
  }
  return proofOf(
    "native",
    OPENCODE_CHAT,
    effortLevels(ownField(settings, "reasoningEffort"), GENERIC_EFFORTS),
  );
};

// NVIDIA's openai-compatible branch sends different controls, so it is not read here.
const openaiCompatibleFamily: Family = (variant, model) =>
  model.providerID === "nvidia" ? undefined : chatFamily(variant, model);

// Alibaba chat (OpenCode reader only): enableThinking false is the explicit off; enabled thinking
// proves the effort it carries. Pi's qwen translation is not verified for this provider id, so this
// proof has no Pi parity claim.
const alibabaChatFamily: Family = (variant) => {
  const settings = exactFields(settingsOf(variant), [
    "enableThinking",
    "reasoningEffort",
  ]);
  if (settings === undefined || bodyOf(variant) !== undefined) {
    return undefined;
  }
  const enabled = ownField(settings, "enableThinking");
  const effort = ownField(settings, "reasoningEffort");
  if (enabled === false && effort === undefined) {
    return proofOf("binary", OPENCODE_ALIBABA_CHAT, ["off"]);
  }
  if (enabled === true) {
    return proofOf(
      "native",
      OPENCODE_ALIBABA_CHAT,
      effortLevels(effort, GENERIC_EFFORTS),
    );
  }
  return undefined;
};

// Z.ai chat: Pi's zai format enables thinking iff an effort is sent, and sends reasoning_effort only
// where the model supports it. Binary models carry no effort; the others map the listed efforts.
const ZAI_BINARY_MODEL_IDS: ReadonlySet<string> = new Set([
  "glm-4.7",
  "glm-5-turbo",
]);
const ZAI_OFF_MODEL_IDS: ReadonlySet<string> = new Set([
  "glm-4.7",
  "glm-5-turbo",
  "glm-5.2",
  "glm-5.2-highspeed",
]);
const ZAI_EFFORT_HIGH_MAX_MODEL_IDS: ReadonlySet<string> = new Set([
  "glm-5.2",
  "glm-5.2-highspeed",
]);
const ZAI_EFFORT_LOW_HIGH_MAX_MODEL_IDS: ReadonlySet<string> = new Set([
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.3-highspeed",
]);

const zaiChatFamily: Family = (variant, model) => {
  if (model.providerID !== "zai" || bodyOf(variant) !== undefined) {
    return undefined;
  }
  const settings = exactFields(settingsOf(variant), [
    "reasoningEffort",
    "thinking",
  ]);
  const thinking = exactFields(ownField(settings, "thinking"), [
    "clear_thinking",
    "type",
  ]);
  if (settings === undefined || thinking === undefined) {
    return undefined;
  }
  const clearThinking = ownField(thinking, "clear_thinking");
  if (clearThinking !== undefined && clearThinking !== false) {
    return undefined;
  }
  const modelID = model.modelID ?? "";
  const evidence = `${PI_ZAI_0_87_1} ${modelID}`;
  const effort = ownField(settings, "reasoningEffort");
  const type = ownField(thinking, "type");

  if (type === "disabled" && effort === undefined) {
    return ZAI_OFF_MODEL_IDS.has(modelID)
      ? proofOf("binary", evidence, ["off"])
      : undefined;
  }
  if (type !== "enabled") {
    return undefined;
  }
  if (ZAI_BINARY_MODEL_IDS.has(modelID)) {
    return effort === undefined
      ? proofOf("binary", evidence, ["minimal", "low", "medium", "high"])
      : undefined;
  }
  if (ZAI_EFFORT_HIGH_MAX_MODEL_IDS.has(modelID)) {
    return proofOf("native", evidence, effortLevels(effort, ["high", "max"]));
  }
  if (ZAI_EFFORT_LOW_HIGH_MAX_MODEL_IDS.has(modelID)) {
    return proofOf(
      "native",
      evidence,
      effortLevels(effort, ["low", "high", "max"]),
    );
  }
  return undefined;
};

// Z.ai messages (OpenCode reader only; Pi's Z.ai chat translation is a different path). Disabled with
// no effort or with none is off. The enabled effort is only the generic default names.
const zaiMessagesFamily: Family = (variant) => {
  const settings = exactFields(settingsOf(variant), ["effort", "thinking"]);
  const thinking = exactFields(ownField(settings, "thinking"), ["type"]);
  if (
    settings === undefined ||
    thinking === undefined ||
    bodyOf(variant) !== undefined
  ) {
    return undefined;
  }
  const type = ownField(thinking, "type");
  const effort = ownField(settings, "effort");
  if (type === "disabled" && (effort === undefined || effort === "none")) {
    return proofOf("binary", OPENCODE_ZAI_MESSAGES, ["off"]);
  }
  if (type === "enabled") {
    return proofOf(
      "native",
      OPENCODE_ZAI_MESSAGES,
      effortLevels(effort, GENERIC_EFFORTS),
    );
  }
  return undefined;
};

// Anthropic messages: adaptive models read effort through their catalogue entry. Models outside the
// table, wrappers that reach this reader, and any other shape stay unmapped.
const anthropicFamily: Family = (variant, model) => {
  if (model.providerID !== "anthropic" || bodyOf(variant) !== undefined) {
    return undefined;
  }
  const settings = exactFields(settingsOf(variant), ["effort", "thinking"]);
  if (settings === undefined) {
    return undefined;
  }
  const modelID = model.modelID ?? "";
  const effort = ownField(settings, "effort");
  const thinking = ownField(settings, "thinking");

  if (Object.hasOwn(ANTHROPIC_ADAPTIVE_MODEL_ENTRIES, modelID)) {
    const entry = ANTHROPIC_ADAPTIVE_MODEL_ENTRIES[modelID];
    const adaptiveThinking = exactFields(thinking, ["display", "type"]);
    if (entry === undefined || adaptiveThinking === undefined) {
      return undefined;
    }
    const type = ownField(adaptiveThinking, "type");
    if (type === "adaptive" && typeof effort === "string") {
      return Object.hasOwn(entry.efforts, effort)
        ? proofOf("native", entry.evidence, entry.efforts[effort] ?? [])
        : undefined;
    }
    if (
      type === "disabled" &&
      effort === undefined &&
      ownField(adaptiveThinking, "display") === undefined &&
      entry.offSupported
    ) {
      return proofOf("binary", entry.evidence, ["off"]);
    }
    return undefined;
  }

  if (!ANTHROPIC_BUDGET_MODEL_IDS.has(modelID) || effort !== undefined) {
    return undefined;
  }
  const budgetThinking = exactFields(thinking, [
    "budgetTokens",
    "budget_tokens",
    "type",
  ]);
  if (budgetThinking === undefined) {
    return undefined;
  }
  const type = ownField(budgetThinking, "type");
  const camel = ownField(budgetThinking, "budgetTokens");
  const snake = ownField(budgetThinking, "budget_tokens");
  if (type === "disabled") {
    return camel === undefined && snake === undefined
      ? proofOf("binary", `${PI_ANTHROPIC_0_87_1} ${modelID} disabled`, ["off"])
      : undefined;
  }
  if (type !== "enabled" || (camel === undefined) === (snake === undefined)) {
    return undefined;
  }
  const budget = camel ?? snake;
  if (!isPositiveInteger(budget)) {
    return undefined;
  }
  return proofOf(
    "budget",
    `${PI_ANTHROPIC_0_87_1} ${modelID} budget (model-derived cap)`,
    anthropicBudgetLevels(model.limit?.output, budget),
  );
};

// Moonshot chat (Pi moonshotai): kimi-k2.6 uses the deepseek format, a binary switch with no effort.
// kimi-k3 sends reasoning_effort with its own map, which keeps only low, high, and max.
const moonshotChatFamily: Family = (variant, model) => {
  if (model.providerID !== "moonshotai" || bodyOf(variant) !== undefined) {
    return undefined;
  }
  const settings = exactFields(settingsOf(variant), [
    "reasoningEffort",
    "thinking",
  ]);
  const thinking = exactFields(ownField(settings, "thinking"), [
    "keep",
    "type",
  ]);
  if (settings === undefined || thinking === undefined) {
    return undefined;
  }
  const effort = ownField(settings, "reasoningEffort");
  const type = ownField(thinking, "type");
  const keep = ownField(thinking, "keep");
  if (model.modelID === "kimi-k2.6") {
    if (effort !== undefined || keep !== undefined) {
      return undefined;
    }
    const evidence = `${PI_MOONSHOT_0_87_1} kimi-k2.6`;
    if (type === "enabled") {
      return proofOf("binary", evidence, ["minimal", "low", "medium", "high"]);
    }
    return type === "disabled"
      ? proofOf("binary", evidence, ["off"])
      : undefined;
  }
  if (model.modelID === "kimi-k3") {
    if (ownField(settings, "thinking") !== undefined) {
      return undefined;
    }
    return proofOf(
      "native",
      `${PI_MOONSHOT_0_87_1} kimi-k3`,
      effortLevels(effort, ["low", "high", "max"]),
    );
  }
  return undefined;
};

// DeepSeek (Pi deepseek format, 0.87.1 detected compat: supportsReasoningEffort is not disabled for
// DeepSeek, so Pi sends reasoning_effort next to thinking enabled). The exact catalogue map decides
// which efforts exist: flash supports low, high, and max; v4-pro supports high and max. Enabled
// without an effort is not a Pi shape, so it stays unmapped. Disabled with no effort is off, since
// the catalogue does not null off.
const DEEPSEEK_PI_EFFORTS: Readonly<Record<string, readonly ThinkingLevel[]>> =
  {
    "deepseek-flash": ["low", "high", "max"],
    "deepseek-v4-pro": ["high", "max"],
  };

const deepseekFamily: Family = (variant, model) => {
  if (model.providerID !== "deepseek") {
    return undefined;
  }
  const settings = exactFields(settingsOf(variant), ["reasoningEffort"]);
  const body = exactFields(bodyOf(variant), ["thinking"]);
  const thinking = exactFields(ownField(body, "thinking"), ["type"]);
  if (settings === undefined || body === undefined || thinking === undefined) {
    return undefined;
  }
  const modelID = model.modelID ?? "";
  if (!Object.hasOwn(DEEPSEEK_PI_EFFORTS, modelID)) {
    return undefined;
  }
  const evidence = `${PI_DEEPSEEK_0_87_1} ${modelID}`;
  const type = ownField(thinking, "type");
  const effort = ownField(settings, "reasoningEffort");
  if (type === "disabled") {
    return effort === undefined
      ? proofOf("binary", evidence, ["off"])
      : undefined;
  }
  if (type === "enabled") {
    return proofOf(
      "native",
      evidence,
      effortLevels(effort, DEEPSEEK_PI_EFFORTS[modelID] ?? []),
    );
  }
  return undefined;
};

// OpenRouter reasoning.effort is forwarded as the effort; enabled, budgets, and other controls are not
// read as a level.
const openrouterFamily: Family = (variant) => {
  const settings = exactFields(settingsOf(variant), ["reasoning"]);
  const reasoning = exactFields(ownField(settings, "reasoning"), [
    "effort",
    "enabled",
    "max_tokens",
  ]);
  if (
    settings === undefined ||
    reasoning === undefined ||
    bodyOf(variant) !== undefined
  ) {
    return undefined;
  }
  if (
    ownField(reasoning, "enabled") !== undefined ||
    ownField(reasoning, "max_tokens") !== undefined
  ) {
    return undefined;
  }
  return proofOf(
    "native",
    OPENCODE_OPENROUTER,
    effortLevels(ownField(reasoning, "effort"), GENERIC_EFFORTS),
  );
};

// Gemini thinkingLevel: thoughts must be included (or unspecified); a budget is not a level.
const geminiFamily: Family = (variant) => {
  const settings = exactFields(settingsOf(variant), ["thinkingConfig"]);
  const config = exactFields(ownField(settings, "thinkingConfig"), [
    "includeThoughts",
    "thinkingLevel",
  ]);
  if (
    settings === undefined ||
    config === undefined ||
    bodyOf(variant) !== undefined
  ) {
    return undefined;
  }
  const includeThoughts = ownField(config, "includeThoughts");
  if (includeThoughts !== undefined && includeThoughts !== true) {
    return undefined;
  }
  return proofOf(
    "native",
    OPENCODE_GEMINI,
    effortLevels(ownField(config, "thinkingLevel"), GENERIC_EFFORTS),
  );
};

// Bedrock: the family follows the model id, as the host builder does. Claude on Bedrock has no
// proof here, so it stays unmapped.
const bedrockFamily: Family = (variant, model) => {
  const modelID = model.modelID ?? "";
  const body = exactFields(bodyOf(variant), ["additionalModelRequestFields"]);
  if (settingsOf(variant) !== undefined || body === undefined) {
    return undefined;
  }
  const fields = exactFields(ownField(body, "additionalModelRequestFields"), [
    "reasoning",
    "reasoningConfig",
    "reasoning_effort",
  ]);
  if (fields === undefined || modelID.includes("anthropic")) {
    return undefined;
  }
  if (modelID.includes("openai.gpt-oss")) {
    return proofOf(
      "native",
      OPENCODE_BEDROCK,
      effortLevels(ownField(fields, "reasoning_effort"), GENERIC_EFFORTS),
    );
  }
  if (modelID.includes("openai.") || modelID.includes("xai.")) {
    const reasoning = exactFields(ownField(fields, "reasoning"), ["effort"]);
    return reasoning === undefined
      ? undefined
      : proofOf(
          "native",
          OPENCODE_BEDROCK,
          effortLevels(ownField(reasoning, "effort"), GENERIC_EFFORTS),
        );
  }
  const config = exactFields(ownField(fields, "reasoningConfig"), [
    "maxReasoningEffort",
    "type",
  ]);
  if (config === undefined || ownField(config, "type") !== "enabled") {
    return undefined;
  }
  return proofOf(
    "native",
    OPENCODE_BEDROCK,
    effortLevels(ownField(config, "maxReasoningEffort"), GENERIC_EFFORTS),
  );
};

// Cloudflare AI Gateway branches by the upstream model prefix, as the host builder does.
const cloudflareFamily: Family = (variant, model) => {
  const modelID = model.modelID ?? "";
  if (modelID.startsWith("openai/")) {
    return genericResponsesFamily(variant, model);
  }
  if (modelID.startsWith("anthropic/")) {
    return undefined;
  }
  return chatFamily(variant, model);
};

const FAMILY_BY_PACKAGE: ReadonlyMap<string, Family> = new Map<string, Family>([
  ["@opencode/ai/providers/openai", responsesFamily],
  ["@opencode/ai/providers/xai", responsesFamily],
  ["@opencode/ai/providers/alibaba/responses", genericResponsesFamily],
  ["@opencode/ai/providers/google-vertex/chat", chatFamily],
  ["@opencode/ai/providers/cerebras", chatFamily],
  ["@opencode/ai/providers/fireworks", chatFamily],
  ["@opencode/ai/providers/groq", chatFamily],
  ["@opencode/ai/providers/meta/chat", chatFamily],
  ["@opencode/ai/providers/minimax/chat", chatFamily],
  ["@opencode/ai/providers/togetherai", chatFamily],
  ["@opencode/ai/providers/openai-compatible", openaiCompatibleFamily],
  ["@opencode/ai/providers/alibaba/chat", alibabaChatFamily],
  ["@opencode/ai/providers/zai/chat", zaiChatFamily],
  ["@opencode/ai/providers/zai-coding-plan/messages", zaiMessagesFamily],
  ["@opencode/ai/providers/anthropic", anthropicFamily],
  ["@opencode/ai/providers/moonshot/chat", moonshotChatFamily],
  ["@opencode/ai/providers/deepseek", deepseekFamily],
  ["@opencode/ai/providers/openrouter", openrouterFamily],
  ["@opencode/ai/providers/google", geminiFamily],
  ["@opencode/ai/providers/google-vertex", geminiFamily],
  ["@opencode/ai/providers/amazon-bedrock", bedrockFamily],
  ["@opencode/ai/providers/cloudflare-ai-gateway", cloudflareFamily],
]);

// Model-level overlays other than compaction could change the wire the variant sends. Their merge
// order with the variant is not verified here, so they hide every proof.
function hasOnlyCompactionSettings(model: ProtocolModel): boolean {
  return exactFields(model.settings, ["compaction"]) !== undefined;
}

export function recognizeVariantProof(
  model: ProtocolModel,
  variant: ProtocolVariant,
): ContractProof | undefined {
  if (
    ownField(variant, "headers") !== undefined ||
    ownField(model, "headers") !== undefined ||
    ownField(model, "body") !== undefined ||
    !hasOnlyCompactionSettings(model)
  ) {
    return undefined;
  }
  const packageName = ownField(model, "package");
  if (typeof packageName !== "string") {
    return undefined;
  }
  return FAMILY_BY_PACKAGE.get(packageName)?.(variant, model);
}

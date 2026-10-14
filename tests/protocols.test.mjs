import assert from "node:assert/strict";
import { test } from "node:test";

import {
  knownThinkingLevels,
  knownThinkingProof,
} from "../dist/thinking/policies.js";
import {
  ANTHROPIC_PI_DEFAULT_BUDGETS,
  anthropicBudgetLevels,
  anthropicEffectiveBudgets,
} from "../dist/thinking/protocols.js";

const PACKAGE = {
  responses: "@opencode/ai/providers/openai",
  xai: "@opencode/ai/providers/xai",
  chat: "@opencode/ai/providers/groq",
  alibabaChat: "@opencode/ai/providers/alibaba/chat",
  alibabaMessages: "@opencode/ai/providers/alibaba/messages",
  zaiChat: "@opencode/ai/providers/zai/chat",
  zaiMessages: "@opencode/ai/providers/zai-coding-plan/messages",
  anthropic: "@opencode/ai/providers/anthropic",
  moonshotChat: "@opencode/ai/providers/moonshot/chat",
  moonshotResponses: "@opencode/ai/providers/moonshot/responses",
  deepseek: "@opencode/ai/providers/deepseek",
  openrouter: "@opencode/ai/providers/openrouter",
  gemini: "@opencode/ai/providers/google",
  bedrock: "@opencode/ai/providers/amazon-bedrock",
  cloudflare: "@opencode/ai/providers/cloudflare-ai-gateway",
  openaiCompatible: "@opencode/ai/providers/openai-compatible",
  mistral: "@opencode/ai/providers/mistral",
  vertexMessages: "@opencode/ai/providers/google-vertex/messages",
  metaMessages: "@opencode/ai/providers/meta/messages",
};

const PROVIDER_FOR_PACKAGE = {
  [PACKAGE.anthropic]: "anthropic",
  [PACKAGE.moonshotChat]: "moonshotai",
  [PACKAGE.deepseek]: "deepseek",
  [PACKAGE.zaiChat]: "zai",
};

// Arbitrary variant ids on purpose: a level must come from the overlay, never from the id.
// Limits default to Pi's catalogue output for the Anthropic models (64000).
function model(packageName, modelID, overrides = {}) {
  return {
    providerID: PROVIDER_FOR_PACKAGE[packageName] ?? "acme",
    modelID,
    package: packageName,
    limit: { context: 200000, output: 64000 },
    variants: [],
    ...overrides,
  };
}

function variant(overlay = {}) {
  return { id: "arbitrary-variant", ...overlay };
}

// Each row names the family, the evidence, and the levels it proves. [] means unmapped: either
// the overlay is outside the reader's proof or the model is outside the verified table.
const MATRIX = [
  [
    "Anthropic sonnet-5-5 low proves only low (minimal and off are null)",
    model(PACKAGE.anthropic, "claude-sonnet-5-5"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "low" } }),
    ["low"],
  ],
  [
    "Anthropic sonnet-5-5 xhigh is mapped by its 1.1.0 catalogue entry",
    model(PACKAGE.anthropic, "claude-sonnet-5-5"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "xhigh" } }),
    ["xhigh"],
  ],
  [
    "Anthropic haiku-5-5 max is mapped by its 1.1.0 catalogue entry",
    model(PACKAGE.anthropic, "claude-haiku-5-5"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "max" } }),
    ["max"],
  ],
  [
    "Anthropic sonnet-5-5 disabled is not off (off is null)",
    model(PACKAGE.anthropic, "claude-sonnet-5-5"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    [],
  ],
  [
    "Anthropic haiku-5 without the .5 is not proven by either archive",
    model(PACKAGE.anthropic, "claude-haiku-5"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    [],
  ],
  // Anthropic adaptive models (Pi catalogue thinkingLevelMap; mapThinkingLevelToEffort).
  [
    "Anthropic opus-4-8 low proves minimal and low (minimal falls to low)",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "low" } }),
    ["minimal", "low"],
  ],
  [
    "Anthropic opus-4-8 medium proves medium",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "medium" } }),
    ["medium"],
  ],
  [
    "Anthropic opus-4-8 high proves high",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    ["high"],
  ],
  [
    "Anthropic opus-4-8 xhigh is mapped by its catalogue entry",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "xhigh" } }),
    ["xhigh"],
  ],
  [
    "Anthropic opus-4-8 max is mapped by its catalogue entry",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "max" } }),
    ["max"],
  ],
  [
    "Anthropic opus-4-8 disabled proves off (no null map)",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    ["off"],
  ],
  [
    "Anthropic opus-4-6 maps no xhigh, so xhigh stays unmapped",
    model(PACKAGE.anthropic, "claude-opus-4-6"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "xhigh" } }),
    [],
  ],
  [
    "Anthropic opus-4-6 max is mapped",
    model(PACKAGE.anthropic, "claude-opus-4-6"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "max" } }),
    ["max"],
  ],
  [
    "Anthropic sonnet-4-6 low proves minimal and low",
    model(PACKAGE.anthropic, "claude-sonnet-4-6"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "low" } }),
    ["minimal", "low"],
  ],
  [
    "Anthropic fable-5 low proves minimal and low",
    model(PACKAGE.anthropic, "claude-fable-5"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "low" } }),
    ["minimal", "low"],
  ],
  [
    "Anthropic fable-5 xhigh is mapped",
    model(PACKAGE.anthropic, "claude-fable-5-1"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "xhigh" } }),
    ["xhigh"],
  ],
  [
    "Anthropic fable-5 disabled is not off (off map null)",
    model(PACKAGE.anthropic, "claude-fable-5"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    [],
  ],
  [
    "Anthropic opus-5 disabled is not off (off map null)",
    model(PACKAGE.anthropic, "claude-opus-5"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    [],
  ],
  [
    "Anthropic opus-5-5 low proves only low (minimal null)",
    model(PACKAGE.anthropic, "claude-opus-5-5"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "low" } }),
    ["low"],
  ],
  [
    "Anthropic opus-5-5 minimal effort is not a wire value here",
    model(PACKAGE.anthropic, "claude-opus-5-5"),
    variant({
      settings: { thinking: { type: "adaptive" }, effort: "minimal" },
    }),
    [],
  ],
  [
    "Anthropic adaptive with an unknown effort is unmapped",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "turbo" } }),
    [],
  ],
  [
    "Anthropic adaptive without effort is a binary toggle, not a level",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" } } }),
    [],
  ],
  [
    "Anthropic adaptive with an optional display field still proves its effort",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({
      settings: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "high",
      },
    }),
    ["high"],
  ],
  [
    "Anthropic model outside the verified table is unmapped",
    model(PACKAGE.anthropic, "claude-future-9"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    [],
  ],
  [
    "Anthropic under another provider id is unmapped",
    model(PACKAGE.anthropic, "claude-opus-4-8", { providerID: "acme" }),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    [],
  ],

  // Anthropic manual budgets: keep the catalogue inputs covered, but never treat the projection
  // as a request-level proof because this reader has no request max_tokens.
  [
    "Anthropic sonnet-4-5 1024 recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 1024 } },
    }),
    [],
  ],
  [
    "Anthropic sonnet-4-5 2048 recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 2048 } },
    }),
    [],
  ],
  [
    "Anthropic sonnet-4-5 8192 recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 8192 } },
    }),
    [],
  ],
  [
    "Anthropic sonnet-4-5 16384 recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 16384 } },
    }),
    [],
  ],
  [
    "Anthropic sonnet-4-5 snake-case budget recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: { thinking: { type: "enabled", budget_tokens: 2048 } },
    }),
    [],
  ],
  [
    "Anthropic sonnet-4-5 budget 16000 has no catalogue recipe or proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 16000 } },
    }),
    [],
  ],
  [
    "Anthropic sonnet-4-5 both budget spellings are contradictory",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: {
        thinking: { type: "enabled", budgetTokens: 1024, budget_tokens: 2048 },
      },
    }),
    [],
  ],
  [
    "Anthropic sonnet-4-5 disabled still proves off",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    ["off"],
  ],
  [
    "Anthropic sonnet-4-5 with an effort is not a budget level",
    model(PACKAGE.anthropic, "claude-sonnet-4-5"),
    variant({
      settings: {
        thinking: { type: "enabled", budgetTokens: 2048 },
        effort: "low",
      },
    }),
    [],
  ],
  [
    "Anthropic haiku dated id recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-haiku-4-5-20251001"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 8192 } },
    }),
    [],
  ],
  [
    "Anthropic opus dated id recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-opus-4-5-20251101"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 1024 } },
    }),
    [],
  ],
  [
    "Anthropic adaptive model budget is unmapped",
    model(PACKAGE.anthropic, "claude-opus-4-8"),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 2048 } },
    }),
    [],
  ],

  // Lower output limits still produce catalogue recipes, not request-level proofs.
  [
    "Limit 4000 recipe 2976 maps medium and high in the catalogue only",
    model(PACKAGE.anthropic, "claude-sonnet-4-5", {
      limit: { context: 200000, output: 4000 },
    }),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 2976 } },
    }),
    [],
  ],
  [
    "Limit 4000 minimal recipe is not a request-level proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5", {
      limit: { context: 200000, output: 4000 },
    }),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 1024 } },
    }),
    [],
  ],
  [
    "Limit 4000 does not produce the 8192 recipe",
    model(PACKAGE.anthropic, "claude-sonnet-4-5", {
      limit: { context: 200000, output: 4000 },
    }),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 8192 } },
    }),
    [],
  ],
  [
    "Limit 2048 maps all four levels to one catalogue recipe, not a request proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5", {
      limit: { context: 200000, output: 2048 },
    }),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 1024 } },
    }),
    [],
  ],
  [
    "Limit below answer reserve plus minimum has no recipe or proof",
    model(PACKAGE.anthropic, "claude-sonnet-4-5", {
      limit: { context: 200000, output: 1500 },
    }),
    variant({
      settings: { thinking: { type: "enabled", budgetTokens: 1024 } },
    }),
    [],
  ],

  // Moonshot chat: kimi-k3 maps low, high, and max (catalogue map); kimi-k2.6 is a binary toggle.
  [
    "Moonshot kimi-k3 low proves low",
    model(PACKAGE.moonshotChat, "kimi-k3"),
    variant({ settings: { reasoningEffort: "low" } }),
    ["low"],
  ],
  [
    "Moonshot kimi-k3 high proves high",
    model(PACKAGE.moonshotChat, "kimi-k3"),
    variant({ settings: { reasoningEffort: "high" } }),
    ["high"],
  ],
  [
    "Moonshot kimi-k3 max proves max",
    model(PACKAGE.moonshotChat, "kimi-k3"),
    variant({ settings: { reasoningEffort: "max" } }),
    ["max"],
  ],
  [
    "Moonshot kimi-k3 medium is null in its map",
    model(PACKAGE.moonshotChat, "kimi-k3"),
    variant({ settings: { reasoningEffort: "medium" } }),
    [],
  ],
  [
    "Moonshot kimi-k3 xhigh is null in its map",
    model(PACKAGE.moonshotChat, "kimi-k3"),
    variant({ settings: { reasoningEffort: "xhigh" } }),
    [],
  ],
  [
    "Moonshot kimi-k3 minimal is null in its map",
    model(PACKAGE.moonshotChat, "kimi-k3"),
    variant({ settings: { reasoningEffort: "minimal" } }),
    [],
  ],
  [
    "Moonshot kimi-k3 with a thinking switch is contradictory",
    model(PACKAGE.moonshotChat, "kimi-k3"),
    variant({
      settings: { reasoningEffort: "high", thinking: { type: "enabled" } },
    }),
    [],
  ],
  [
    "Moonshot kimi-k2.6 enabled proves the binary set minimal..high",
    model(PACKAGE.moonshotChat, "kimi-k2.6"),
    variant({ settings: { thinking: { type: "enabled" } } }),
    ["minimal", "low", "medium", "high"],
  ],
  [
    "Moonshot kimi-k2.6 disabled proves off",
    model(PACKAGE.moonshotChat, "kimi-k2.6"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    ["off"],
  ],
  [
    "Moonshot kimi-k2.6 enabled with an effort is unmapped",
    model(PACKAGE.moonshotChat, "kimi-k2.6"),
    variant({
      settings: { thinking: { type: "enabled" }, reasoningEffort: "high" },
    }),
    [],
  ],
  [
    "Moonshot kimi-k2.6 with keep is unmapped",
    model(PACKAGE.moonshotChat, "kimi-k2.6"),
    variant({ settings: { thinking: { type: "enabled", keep: "all" } } }),
    [],
  ],
  [
    "Moonshot under another provider id is unmapped",
    model(PACKAGE.moonshotChat, "kimi-k3", { providerID: "acme" }),
    variant({ settings: { reasoningEffort: "high" } }),
    [],
  ],
  [
    "Moonshot responses has no Pi translation here and stays unmapped",
    model(PACKAGE.moonshotResponses, "kimi-k3"),
    variant({ settings: { reasoningEffort: "high" } }),
    [],
  ],

  // DeepSeek: Pi (openai-completions deepseek format) sends thinking enabled only together with
  // reasoning_effort, and supportsReasoningEffort is true for DeepSeek, so a binary switch without an
  // effort is never a Pi proof. The effort must be in the exact model map (Pi archive 0.87.1).
  [
    "DeepSeek flash disabled proves off",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({ body: { thinking: { type: "disabled" } } }),
    ["off"],
  ],
  [
    "DeepSeek flash enabled without an effort is unproven",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({ body: { thinking: { type: "enabled" } } }),
    [],
  ],
  [
    "DeepSeek v4-pro enabled without an effort is unproven",
    model(PACKAGE.deepseek, "deepseek-v4-pro"),
    variant({ body: { thinking: { type: "enabled" } } }),
    [],
  ],
  [
    "DeepSeek flash max with the host enabled body proves max",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({
      settings: { reasoningEffort: "max" },
      body: { thinking: { type: "enabled" } },
    }),
    ["max"],
  ],
  [
    "DeepSeek flash high with the host enabled body proves high",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({
      settings: { reasoningEffort: "high" },
      body: { thinking: { type: "enabled" } },
    }),
    ["high"],
  ],
  [
    "DeepSeek flash low proves low (map low is low)",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({
      settings: { reasoningEffort: "low" },
      body: { thinking: { type: "enabled" } },
    }),
    ["low"],
  ],
  [
    "DeepSeek flash medium is null in its map and stays unmapped",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({
      settings: { reasoningEffort: "medium" },
      body: { thinking: { type: "enabled" } },
    }),
    [],
  ],
  [
    "DeepSeek flash xhigh is absent from its map and stays unmapped",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({
      settings: { reasoningEffort: "xhigh" },
      body: { thinking: { type: "enabled" } },
    }),
    [],
  ],
  [
    "DeepSeek v4-pro low is null in its map and stays unmapped",
    model(PACKAGE.deepseek, "deepseek-v4-pro"),
    variant({
      settings: { reasoningEffort: "low" },
      body: { thinking: { type: "enabled" } },
    }),
    [],
  ],
  [
    "DeepSeek v4-pro max proves max",
    model(PACKAGE.deepseek, "deepseek-v4-pro"),
    variant({
      settings: { reasoningEffort: "max" },
      body: { thinking: { type: "enabled" } },
    }),
    ["max"],
  ],
  [
    "DeepSeek disabled body with an effort is contradictory",
    model(PACKAGE.deepseek, "deepseek-flash"),
    variant({
      settings: { reasoningEffort: "high" },
      body: { thinking: { type: "disabled" } },
    }),
    [],
  ],
  [
    "DeepSeek model outside the table is unmapped",
    model(PACKAGE.deepseek, "deepseek-other"),
    variant({ body: { thinking: { type: "disabled" } } }),
    [],
  ],

  // Z.ai chat: per catalogue entry. glm-4.7 and glm-5-turbo are binary; glm-5.2 maps high and max;
  // glm-5.3 maps low, high, and max; off is proven only where the catalogue keeps off.
  [
    "Z.ai glm-4.7 enabled alone proves the binary set",
    model(PACKAGE.zaiChat, "glm-4.7"),
    variant({
      settings: { thinking: { type: "enabled", clear_thinking: false } },
    }),
    ["minimal", "low", "medium", "high"],
  ],
  [
    "Z.ai glm-4.7 disabled proves off",
    model(PACKAGE.zaiChat, "glm-4.7"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    ["off"],
  ],
  [
    "Z.ai glm-4.7 with an effort is unmapped (no reasoning_effort in Pi)",
    model(PACKAGE.zaiChat, "glm-4.7"),
    variant({
      settings: { thinking: { type: "enabled" }, reasoningEffort: "high" },
    }),
    [],
  ],
  [
    "Z.ai glm-5.2 high proves high",
    model(PACKAGE.zaiChat, "glm-5.2"),
    variant({
      settings: {
        thinking: { type: "enabled", clear_thinking: false },
        reasoningEffort: "high",
      },
    }),
    ["high"],
  ],
  [
    "Z.ai glm-5.2 max proves max",
    model(PACKAGE.zaiChat, "glm-5.2-highspeed"),
    variant({
      settings: { thinking: { type: "enabled" }, reasoningEffort: "max" },
    }),
    ["max"],
  ],
  [
    "Z.ai glm-5.2 disabled proves off",
    model(PACKAGE.zaiChat, "glm-5.2"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    ["off"],
  ],
  [
    "Z.ai glm-5.2 low is null in its map",
    model(PACKAGE.zaiChat, "glm-5.2"),
    variant({
      settings: { thinking: { type: "enabled" }, reasoningEffort: "low" },
    }),
    [],
  ],
  [
    "Z.ai glm-5.3 low proves low",
    model(PACKAGE.zaiChat, "glm-5.3"),
    variant({
      settings: { thinking: { type: "enabled" }, reasoningEffort: "low" },
    }),
    ["low"],
  ],
  [
    "Z.ai glm-5.3 high proves high",
    model(PACKAGE.zaiChat, "glm-5.3-flash"),
    variant({
      settings: { thinking: { type: "enabled" }, reasoningEffort: "high" },
    }),
    ["high"],
  ],
  [
    "Z.ai glm-5.3 disabled is not off (off null)",
    model(PACKAGE.zaiChat, "glm-5.3"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    [],
  ],
  [
    "Z.ai retained clear_thinking true is contradictory to a plain level",
    model(PACKAGE.zaiChat, "glm-5.3"),
    variant({
      settings: {
        thinking: { type: "enabled", clear_thinking: true },
        reasoningEffort: "low",
      },
    }),
    [],
  ],
  [
    "Z.ai model outside the table is unmapped",
    model(PACKAGE.zaiChat, "glm-9"),
    variant({
      settings: { thinking: { type: "enabled" }, reasoningEffort: "high" },
    }),
    [],
  ],

  // Z.ai messages: only disabled with no effort or with none is off; minimal stays unmapped.
  [
    "Z.ai messages disabled with none proves off",
    model(PACKAGE.zaiMessages, "glm-5.3"),
    variant({ settings: { thinking: { type: "disabled" }, effort: "none" } }),
    ["off"],
  ],
  [
    "Z.ai messages disabled with no effort proves off",
    model(PACKAGE.zaiMessages, "glm-5.3"),
    variant({ settings: { thinking: { type: "disabled" } } }),
    ["off"],
  ],
  [
    "Z.ai messages disabled with minimal is unproven, not off",
    model(PACKAGE.zaiMessages, "glm-5.3"),
    variant({
      settings: { thinking: { type: "disabled" }, effort: "minimal" },
    }),
    [],
  ],
  [
    "Z.ai messages enabled with high proves high under the generic rule",
    model(PACKAGE.zaiMessages, "glm-5.3"),
    variant({ settings: { thinking: { type: "enabled" }, effort: "high" } }),
    ["high"],
  ],

  // Alibaba chat (Pi's qwen branch: enable_thinking is false exactly when no effort is sent).
  [
    "Alibaba chat enableThinking false proves off",
    model(PACKAGE.alibabaChat, "qwen-plus"),
    variant({ settings: { enableThinking: false } }),
    ["off"],
  ],
  [
    "Alibaba chat enabled with high proves high",
    model(PACKAGE.alibabaChat, "qwen-plus"),
    variant({ settings: { enableThinking: true, reasoningEffort: "high" } }),
    ["high"],
  ],
  [
    "Alibaba chat enabled alone is a binary toggle",
    model(PACKAGE.alibabaChat, "qwen-plus"),
    variant({ settings: { enableThinking: true } }),
    [],
  ],
  [
    "Alibaba chat disabled with an effort is contradictory",
    model(PACKAGE.alibabaChat, "qwen-plus"),
    variant({ settings: { enableThinking: false, reasoningEffort: "high" } }),
    [],
  ],
  [
    "Alibaba messages has no Pi translation here and stays unmapped",
    model(PACKAGE.alibabaMessages, "qwen-plus"),
    variant({ settings: { thinking: { type: "enabled" }, effort: "high" } }),
    [],
  ],

  // Generic wrappers: only the host's documented default names low, medium and high.
  [
    "Groq chat low proves low under the generic rule",
    model(PACKAGE.chat, "llama"),
    variant({ settings: { reasoningEffort: "low" } }),
    ["low"],
  ],
  [
    "Groq chat minimal is not claimed for the wrapper",
    model(PACKAGE.chat, "llama"),
    variant({ settings: { reasoningEffort: "minimal" } }),
    [],
  ],
  [
    "Groq chat xhigh is not claimed for the wrapper",
    model(PACKAGE.chat, "llama"),
    variant({ settings: { reasoningEffort: "xhigh" } }),
    [],
  ],
  [
    "Groq chat max is not claimed for the wrapper",
    model(PACKAGE.chat, "llama"),
    variant({ settings: { reasoningEffort: "max" } }),
    [],
  ],
  [
    "Groq chat none has no proof of off",
    model(PACKAGE.chat, "llama"),
    variant({ settings: { reasoningEffort: "none" } }),
    [],
  ],
  [
    "OpenAI responses high proves high (known literal)",
    model(PACKAGE.responses, "gpt-5"),
    variant({
      settings: { reasoningEffort: "high", reasoningSummary: "auto" },
    }),
    ["high"],
  ],
  [
    "OpenAI responses minimal proves minimal (known literal)",
    model(PACKAGE.responses, "gpt-5"),
    variant({ settings: { reasoningEffort: "minimal" } }),
    ["minimal"],
  ],
  [
    "OpenAI responses xhigh proves xhigh (known literal)",
    model(PACKAGE.responses, "gpt-5"),
    variant({ settings: { reasoningEffort: "xhigh" } }),
    ["xhigh"],
  ],
  [
    "OpenAI responses max proves max (known literal)",
    model(PACKAGE.responses, "gpt-5"),
    variant({ settings: { reasoningEffort: "max" } }),
    ["max"],
  ],
  [
    "xAI responses minimal proves minimal (known literal)",
    model(PACKAGE.xai, "grok-4"),
    variant({ settings: { reasoningEffort: "minimal" } }),
    ["minimal"],
  ],
  [
    "xAI responses xhigh proves xhigh (known literal)",
    model(PACKAGE.xai, "grok-4"),
    variant({ settings: { reasoningEffort: "xhigh" } }),
    ["xhigh"],
  ],
  [
    "xAI responses max proves max (known literal)",
    model(PACKAGE.xai, "grok-4"),
    variant({ settings: { reasoningEffort: "max" } }),
    ["max"],
  ],
  [
    "OpenAI responses with a string outside the known literals is unproven",
    model(PACKAGE.responses, "gpt-5"),
    variant({ settings: { reasoningEffort: "turbo" } }),
    [],
  ],
  [
    "xAI responses with a string outside the known literals is unproven",
    model(PACKAGE.xai, "grok-4"),
    variant({ settings: { reasoningEffort: "ultra" } }),
    [],
  ],
  [
    "OpenAI responses literal off is unproven, even as a named off variant",
    model(PACKAGE.responses, "gpt-5"),
    variant({ settings: { reasoningEffort: "off" } }),
    [],
  ],
  [
    "xAI responses none has no proof of off",
    model(PACKAGE.xai, "grok-4"),
    variant({ settings: { reasoningEffort: "none" } }),
    [],
  ],
  [
    "Cloudflare openai branch keeps the generic names and leaves xhigh unmapped",
    model(PACKAGE.cloudflare, "openai/gpt-5"),
    variant({ settings: { reasoningEffort: "xhigh" } }),
    [],
  ],
  [
    "OpenAI responses none has no proof of off",
    model(PACKAGE.responses, "gpt-5"),
    variant({ settings: { reasoningEffort: "none" } }),
    [],
  ],
  [
    "OpenAI-compatible NVIDIA branch stays unmapped",
    model(PACKAGE.openaiCompatible, "deepseek-v4", { providerID: "nvidia" }),
    variant({ settings: { reasoningEffort: "high" } }),
    [],
  ],
  [
    "OpenAI-compatible outside NVIDIA uses the chat wrapper",
    model(PACKAGE.openaiCompatible, "synthetic"),
    variant({ settings: { reasoningEffort: "low" } }),
    ["low"],
  ],
  [
    "Mistral has no Pi effort map in the archive and stays unmapped",
    model(PACKAGE.mistral, "mistral-small-latest"),
    variant({ settings: { reasoningEffort: "high" } }),
    [],
  ],

  // OpenRouter and Gemini: the same generic names; budgets and disables stay unmapped.
  [
    "OpenRouter reasoning.effort high proves high under the generic rule",
    model(PACKAGE.openrouter, "x/y"),
    variant({ settings: { reasoning: { effort: "high" } } }),
    ["high"],
  ],
  [
    "OpenRouter enabled false is not claimed off here",
    model(PACKAGE.openrouter, "x/y"),
    variant({ settings: { reasoning: { enabled: false } } }),
    [],
  ],
  [
    "OpenRouter max_tokens is a budget, not a level",
    model(PACKAGE.openrouter, "x/y"),
    variant({ settings: { reasoning: { max_tokens: 8000 } } }),
    [],
  ],
  [
    "Gemini thinkingLevel high proves high under the generic rule",
    model(PACKAGE.gemini, "gemini-3-pro"),
    variant({
      settings: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
      },
    }),
    ["high"],
  ],
  [
    "Gemini lowercase minimal is native proof for any gemini model, not a Pi claim",
    model(PACKAGE.gemini, "gemini-3-pro"),
    variant({ settings: { thinkingConfig: { thinkingLevel: "minimal" } } }),
    ["minimal"],
  ],
  [
    "Gemini uppercase MINIMAL proves minimal on an exact Pi flash id",
    model(PACKAGE.gemini, "gemini-3-flash-preview"),
    variant({ settings: { thinkingConfig: { thinkingLevel: "MINIMAL" } } }),
    ["minimal"],
  ],
  [
    "Gemini uppercase LOW proves low on an exact Pi flash id",
    model(PACKAGE.gemini, "gemini-3.5-flash"),
    variant({
      settings: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "LOW" },
      },
    }),
    ["low"],
  ],
  [
    "Gemini uppercase MINIMAL is unmapped where Pi's map nulls minimal",
    model(PACKAGE.gemini, "gemini-3.1-pro-preview"),
    variant({ settings: { thinkingConfig: { thinkingLevel: "MINIMAL" } } }),
    [],
  ],
  [
    "Gemini uppercase MINIMAL on a Pi budget id is unmapped",
    model(PACKAGE.gemini, "gemini-2.5-flash"),
    variant({ settings: { thinkingConfig: { thinkingLevel: "MINIMAL" } } }),
    [],
  ],
  [
    "Gemini uppercase MINIMAL with explicit includeThoughts false is a conflict",
    model(PACKAGE.gemini, "gemini-3-flash-preview"),
    variant({
      settings: {
        thinkingConfig: { includeThoughts: false, thinkingLevel: "MINIMAL" },
      },
    }),
    [],
  ],
  [
    "Gemini uppercase MINIMAL with a budget beside it is a conflict",
    model(PACKAGE.gemini, "gemini-3-flash-preview"),
    variant({
      settings: {
        thinkingConfig: { thinkingBudget: 128, thinkingLevel: "MINIMAL" },
      },
    }),
    [],
  ],
  [
    "Gemini mixed-case wire is unmapped",
    model(PACKAGE.gemini, "gemini-3-flash-preview"),
    variant({ settings: { thinkingConfig: { thinkingLevel: "Minimal" } } }),
    [],
  ],
  [
    "Gemini uppercase level on a generic model id is unmapped, not native",
    model(PACKAGE.gemini, "gemini-3-pro"),
    variant({ settings: { thinkingConfig: { thinkingLevel: "HIGH" } } }),
    [],
  ],
  [
    "Gemini zero budget does not prove off",
    model(PACKAGE.gemini, "gemini-3-pro"),
    variant({
      settings: {
        thinkingConfig: { includeThoughts: false, thinkingBudget: 0 },
      },
    }),
    [],
  ],
  [
    "Gemini hidden thoughts with a level are not a clean proof",
    model(PACKAGE.gemini, "gemini-3-pro"),
    variant({
      settings: {
        thinkingConfig: { includeThoughts: false, thinkingLevel: "low" },
      },
    }),
    [],
  ],
  // Bedrock: the native protocol reads only providerOptions.thinking (a budget) and passes every other
  // body key through unread. No body key is a level proof, so each row stays unmapped.
  [
    "Bedrock gpt-oss reasoning_effort low is unmapped (the native reader never reads it)",
    model(PACKAGE.bedrock, "openai.gpt-oss-120b"),
    variant({
      body: { additionalModelRequestFields: { reasoning_effort: "low" } },
    }),
    [],
  ],
  [
    "Bedrock GPT-5.5 reasoning.effort high is unmapped",
    model(PACKAGE.bedrock, "openai.gpt-5.5"),
    variant({
      body: { additionalModelRequestFields: { reasoning: { effort: "high" } } },
    }),
    [],
  ],
  [
    "Bedrock Grok 4.6 reasoning.effort high is unmapped",
    model(PACKAGE.bedrock, "xai.grok-4.6"),
    variant({
      body: { additionalModelRequestFields: { reasoning: { effort: "high" } } },
    }),
    [],
  ],
  [
    "Bedrock Llama 4 Maverick reasoningConfig enabled medium is unmapped (non-reasoning in Pi)",
    model(PACKAGE.bedrock, "meta.llama4-maverick-17b-instruct-v1:0"),
    variant({
      body: {
        additionalModelRequestFields: {
          reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" },
        },
      },
    }),
    [],
  ],
  [
    "Bedrock reasoningConfig disabled is unmapped, not off",
    model(PACKAGE.bedrock, "meta.llama4-maverick-17b-instruct-v1:0"),
    variant({
      body: {
        additionalModelRequestFields: { reasoningConfig: { type: "disabled" } },
      },
    }),
    [],
  ],
  [
    "Bedrock Claude adaptive with output_config effort is unmapped",
    model(PACKAGE.bedrock, "anthropic.claude-sonnet-4-6"),
    variant({
      body: {
        additionalModelRequestFields: {
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
        },
      },
    }),
    [],
  ],
  [
    "Bedrock unknown custom id with reasoning_effort is unmapped",
    model(PACKAGE.bedrock, "acme.custom-model"),
    variant({
      body: { additionalModelRequestFields: { reasoning_effort: "high" } },
    }),
    [],
  ],
  [
    "Bedrock settings reasoningEffort high is unmapped (no Bedrock settings reader)",
    model(PACKAGE.bedrock, "openai.gpt-oss-120b"),
    variant({ settings: { reasoningEffort: "high" } }),
    [],
  ],
  [
    "Cloudflare openai branch uses the responses wrapper",
    model(PACKAGE.cloudflare, "openai/gpt-5"),
    variant({ settings: { reasoningEffort: "high" } }),
    ["high"],
  ],
  [
    "Cloudflare anthropic branch stays unmapped",
    model(PACKAGE.cloudflare, "anthropic/claude-sonnet-4-6"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    [],
  ],
  [
    "Cloudflare other branch uses the chat wrapper",
    model(PACKAGE.cloudflare, "meta/llama-4"),
    variant({ settings: { reasoningEffort: "low" } }),
    ["low"],
  ],
  [
    "Vertex Claude messages stays unmapped",
    model(PACKAGE.vertexMessages, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    [],
  ],
  [
    "Meta messages stays unmapped",
    model(PACKAGE.metaMessages, "claude-opus-4-8"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    [],
  ],
  [
    "Moonshot messages-free responses package is unknown",
    model("@opencode/ai/providers/unknown-package"),
    variant({ settings: { reasoningEffort: "high" } }),
    [],
  ],
];

for (const [name, row, overlay, expected] of MATRIX) {
  test(`protocol matrix: ${name}`, () => {
    assert.deepEqual(knownThinkingLevels(row, overlay), expected);
  });
}

test("a variant or model headers field hides every level", () => {
  assert.deepEqual(
    knownThinkingLevels(
      model(PACKAGE.anthropic, "claude-opus-4-8"),
      variant({
        settings: { thinking: { type: "adaptive" }, effort: "high" },
        headers: { "x-t": "1" },
      }),
    ),
    [],
  );
  assert.deepEqual(
    knownThinkingLevels(
      model(PACKAGE.anthropic, "claude-opus-4-8", { headers: { "x-t": "1" } }),
      variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    ),
    [],
  );
});

test("a model-level setting other than compaction hides every level", () => {
  assert.deepEqual(
    knownThinkingLevels(
      model(PACKAGE.anthropic, "claude-opus-4-8", {
        settings: { thinking: { type: "disabled" } },
      }),
      variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    ),
    [],
  );
  assert.deepEqual(
    knownThinkingLevels(
      model(PACKAGE.anthropic, "claude-opus-4-8", {
        settings: { compaction: { type: "native" } },
      }),
      variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
    ),
    ["high"],
  );
});

test("inherited variant or settings fields cannot establish a level for any family", () => {
  assert.deepEqual(
    knownThinkingLevels(model(PACKAGE.anthropic, "claude-opus-4-8"), {
      id: "x",
      settings: Object.create({
        thinking: { type: "adaptive" },
        effort: "high",
      }),
    }),
    [],
  );
  assert.deepEqual(
    knownThinkingLevels(model(PACKAGE.alibabaChat, "qwen-plus"), {
      id: "x",
      settings: Object.create({ enableThinking: false }),
    }),
    [],
  );
  assert.deepEqual(
    knownThinkingLevels(model(PACKAGE.deepseek, "deepseek-flash"), {
      id: "x",
      body: Object.create({ thinking: { type: "disabled" } }),
    }),
    [],
  );
});

test("a null-prototype settings record with its own fields proves its level", () => {
  const settings = Object.assign(Object.create(null), {
    thinking: Object.assign(Object.create(null), { type: "adaptive" }),
    effort: "medium",
  });

  assert.deepEqual(
    knownThinkingLevels(model(PACKAGE.anthropic, "claude-opus-4-8"), {
      id: "x",
      settings,
    }),
    ["medium"],
  );
});

test("sparse own fields that are undefined do not change the proof", () => {
  assert.deepEqual(
    knownThinkingLevels(
      model(PACKAGE.anthropic, "claude-opus-4-8"),
      variant({
        settings: {
          thinking: { type: "adaptive", display: undefined },
          effort: "low",
        },
      }),
    ),
    ["minimal", "low"],
  );
});

test("an unknown package is unmapped whatever the overlay", () => {
  assert.deepEqual(
    knownThinkingLevels(
      model("aisdk:@ai-sdk/gateway"),
      variant({ settings: { reasoningEffort: "high" } }),
    ),
    [],
  );
});

// Proof transport and evidence. Native effort, binary switch, and budget are different
// transports; evidence names the exact scoped model and package version.
test("a binary switch proof is binary and its evidence names the exact Pi model", () => {
  const proof = knownThinkingProof(
    model(PACKAGE.moonshotChat, "kimi-k2.6"),
    variant({ settings: { thinking: { type: "enabled" } } }),
  );

  assert.equal(proof.transportKind, "binary");
  assert.deepEqual(proof.compatibleLevels, [
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.match(proof.evidence, /^pi-ai@0.87.1 .*kimi-k2.6/);
});

test("an OpenCode-only wrapper proof is native and never cites Pi", () => {
  const proof = knownThinkingProof(
    model(PACKAGE.chat, "llama"),
    variant({ settings: { reasoningEffort: "low" } }),
  );

  assert.equal(proof.transportKind, "native");
  assert.deepEqual(proof.compatibleLevels, ["low"]);
  assert.match(proof.evidence, /^opencode@8a8bd622 /);
});

test("Anthropic catalogue recipe levels remain projections, not request-level proofs", () => {
  assert.deepEqual(ANTHROPIC_PI_DEFAULT_BUDGETS, [
    ["minimal", 1024],
    ["low", 2048],
    ["medium", 8192],
    ["high", 16384],
  ]);

  for (const [outputLimit, budget, levels] of [
    [64000, 1024, ["minimal"]],
    [64000, 2048, ["low"]],
    [64000, 8192, ["medium"]],
    [64000, 16384, ["high"]],
    [4000, 1024, ["minimal"]],
    [4000, 2048, ["low"]],
    [4000, 2976, ["medium", "high"]],
    [4000, 8192, []],
    [2048, 1024, ["minimal", "low", "medium", "high"]],
    [1500, 1024, []],
  ]) {
    assert.deepEqual(anthropicBudgetLevels(outputLimit, budget), levels);
  }
  for (const outputLimit of [undefined, null, 0, Number.NaN, "64000"]) {
    assert.deepEqual(anthropicBudgetLevels(outputLimit, 1024), []);
  }
  assert.deepEqual(anthropicEffectiveBudgets(2048), [
    {
      budgetTokens: 1024,
      levels: ["minimal", "low", "medium", "high"],
    },
  ]);

  const manualModels = [
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-5",
    "claude-opus-4-5-20251101",
    "claude-sonnet-4-5",
    "claude-sonnet-4-5-20250929",
  ];
  for (const modelID of manualModels) {
    assert.equal(
      knownThinkingProof(
        model(PACKAGE.anthropic, modelID, {
          limit: { context: 200000, output: 64000 },
        }),
        variant({
          settings: { thinking: { type: "enabled", budgetTokens: 8192 } },
        }),
      ),
      undefined,
      modelID,
    );
  }
});

test("Anthropic disabled thinking proves off without reading the catalogue output limit", () => {
  let limitReads = 0;
  const disabledModel = {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-5",
    package: PACKAGE.anthropic,
    variants: [],
    get limit() {
      limitReads += 1;
      return { output: 64000 };
    },
  };

  assert.deepEqual(
    knownThinkingLevels(
      disabledModel,
      variant({ settings: { thinking: { type: "disabled" } } }),
    ),
    ["off"],
  );
  assert.equal(limitReads, 0);
});

test("an Anthropic 1.1.0 catalogue proof cites that archive and the exact model", () => {
  const proof = knownThinkingProof(
    model(PACKAGE.anthropic, "claude-sonnet-5-5"),
    variant({ settings: { thinking: { type: "adaptive" }, effort: "high" } }),
  );

  assert.equal(proof.transportKind, "native");
  assert.match(proof.evidence, /^pi-ai@1.1.0 /);
  assert.match(proof.evidence, /claude-sonnet-5-5/);
});

test("an unproven overlay has no proof at all, not an empty proof", () => {
  assert.equal(
    knownThinkingProof(
      model("aisdk:@ai-sdk/gateway"),
      variant({ settings: { reasoningEffort: "high" } }),
    ),
    undefined,
  );
});

// Responses literals are OpenCode's own schema, not a Pi translation: the proof must never cite Pi.
test("an openai or xai responses proof cites the OpenCode schema and never Pi", () => {
  for (const packageName of [PACKAGE.responses, PACKAGE.xai]) {
    const proof = knownThinkingProof(
      model(packageName, "gpt-5"),
      variant({ settings: { reasoningEffort: "xhigh" } }),
    );
    assert.equal(proof.transportKind, "native");
    assert.deepEqual(proof.compatibleLevels, ["xhigh"]);
    assert.equal(
      proof.evidence,
      "opencode@8a8bd622 packages/ai/src/protocols/utils/open-responses-options.ts",
    );
  }
});

// Native budget controls depend on the final request cap, so a dynamic -1 or a budget-0 disable is not a
// ThinkingProof, however the id is registered.
test("Gemini native budget -1 and budget 0 on a dynamic id are conditional, so they prove nothing", () => {
  const dynamic = model(
    PACKAGE.gemini,
    "gemini-2.5-computer-use-preview-10-2025",
  );
  assert.deepEqual(
    knownThinkingLevels(
      dynamic,
      variant({
        settings: {
          thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
        },
      }),
    ),
    [],
  );
  assert.deepEqual(
    knownThinkingLevels(
      dynamic,
      variant({
        settings: {
          thinkingConfig: { includeThoughts: false, thinkingBudget: 0 },
        },
      }),
    ),
    [],
  );
});

// Bedrock source negatives. The pinned native reader (bedrock-converse.ts at 8a8bd622) reads only
// providerOptions.thinking as an enabled budget. Other additionalModelRequestFields keys reach the wire only
// through an http.body overlay, which the reader never inspects, so no key, level or model id establishes
// an effort proof.
const BEDROCK_UNREAD_BODIES = [
  (level) => ({ additionalModelRequestFields: { reasoning_effort: level } }),
  (level) => ({
    additionalModelRequestFields: { reasoning: { effort: level } },
  }),
  (level) => ({
    additionalModelRequestFields: {
      reasoningConfig: { type: "enabled", maxReasoningEffort: level },
    },
  }),
  (level) => ({
    additionalModelRequestFields: {
      thinking: { type: "adaptive" },
      output_config: { effort: level },
    },
  }),
  (level) => ({ additionalModelRequestFields: { effort: level } }),
  () => ({
    additionalModelRequestFields: {
      thinking: { type: "enabled", budget_tokens: 8000 },
    },
  }),
];
const BEDROCK_LEVELS = [
  "none",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const BEDROCK_IDS = [
  "openai.gpt-oss-120b",
  "openai.gpt-5.5",
  "xai.grok-4.6",
  "meta.llama4-maverick-17b-instruct-v1:0",
  "anthropic.claude-sonnet-4-6",
  "acme.custom-model",
];

test("no Bedrock body key yields a level proof for any level or model id", () => {
  for (const modelID of BEDROCK_IDS) {
    for (const body of BEDROCK_UNREAD_BODIES) {
      for (const level of BEDROCK_LEVELS) {
        const row = model(PACKAGE.bedrock, modelID);
        const overlay = variant({ body: body(level) });
        assert.equal(
          knownThinkingProof(row, overlay),
          undefined,
          `${modelID} ${JSON.stringify(overlay.body)}`,
        );
        assert.deepEqual(knownThinkingLevels(row, overlay), []);
      }
    }
  }
});

test("a bare Bedrock reasoningConfig enablement or an empty one proves no level", () => {
  for (const reasoningConfig of [{ type: "enabled" }, {}]) {
    assert.deepEqual(
      knownThinkingLevels(
        model(PACKAGE.bedrock, "openai.gpt-oss-120b"),
        variant({
          body: { additionalModelRequestFields: { reasoningConfig } },
        }),
      ),
      [],
    );
  }
});

import type {
  ThinkingLevel,
  ThinkingModel,
  ThinkingVariant,
} from "./policies.js";
import type { ContractProof } from "./protocols.js";

const ENCRYPTED_REASONING = "reasoning.encrypted_content";
const PACKAGE_BY_PROVIDER = Object.freeze({
  openai: "@opencode/ai/providers/openai",
  xai: "@opencode/ai/providers/xai",
  meta: "@opencode/ai/providers/meta/responses",
  "cloudflare-ai-gateway": "@opencode/ai/providers/cloudflare-ai-gateway",
  "github-copilot": "aisdk:@ai-sdk/github-copilot",
});
const OPENCODE_FACADE_PACKAGES = new Set([
  "@opencode/ai/providers/openai",
  "@opencode/ai/providers/openai/responses",
]);
const OPENCODE_GENERIC_RESPONSES_PACKAGE =
  "@opencode/ai/providers/openai-compatible-responses";

// Source-owned snapshots of exact Pi AI 0.87.1 catalogue rows. Explicit null means Pi does not
// advertise that level; omitted minimal..high entries in the OpenCode rows map to themselves.
const LEVEL_MAPS: Readonly<
  Record<string, Readonly<Record<string, string | null>>>
> = Object.freeze({
  "openai/gpt-5": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5-mini": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5-nano": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5-pro": {
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5.1": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/gpt-5.2": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.2-chat-latest": {
    minimal: null,
    low: null,
    medium: "medium",
    high: null,
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.2-pro": {
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.3-codex": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.3-codex-spark": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4-mini": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4-nano": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.4-pro": {
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.5": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.5-pro": {
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/gpt-5.6-luna": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-5.6-sol": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-5.6-terra": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-6-astra": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-6-luna": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-6-sol": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "openai/gpt-realtime-2.1": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "openai/o1": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o1-pro": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o3": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o3-mini": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o3-pro": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "openai/o4-mini": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "xai/grok-4.3": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "xai/grok-4.5": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "xai/grok-4.6": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "xai/grok-4.7": {
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.1": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.2": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.2-contributor": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "meta/muse-spark-1.3": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "meta/muse-spark-1.3-contributor": {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  // Pi AI 0.87.1 providers/data/opencode.json (openai-responses). Missing
  // minimal..high entries use their level; explicit nulls remain unsupported.
  "opencode/gpt-5": { off: null, xhigh: null, max: null },
  "opencode/gpt-5-codex": {
    off: null,
    minimal: null,
    xhigh: null,
    max: null,
  },
  "opencode/gpt-5-nano": { off: null, xhigh: null, max: null },
  "opencode/gpt-5.1": {
    off: null,
    minimal: null,
    xhigh: null,
    max: null,
  },
  "opencode/gpt-5.1-codex": {
    off: null,
    minimal: null,
    xhigh: null,
    max: null,
  },
  "opencode/gpt-5.1-codex-max": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.1-codex-mini": {
    off: null,
    minimal: null,
    xhigh: null,
    max: null,
  },
  "opencode/gpt-5.2": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.2-codex": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.3-codex": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.4": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.4-mini": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.4-nano": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.4-pro": {
    off: null,
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.5": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.5-pro": {
    off: null,
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "opencode/gpt-5.6-luna": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: "max",
  },
  "opencode/gpt-5.6-sol": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: "max",
  },
  "opencode/gpt-5.6-terra": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: "max",
  },
  "opencode/gpt-6-astra": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: "max",
  },
  "opencode/gpt-6-luna": {
    off: "none",
    minimal: null,
    xhigh: "xhigh",
    max: "max",
  },
  "opencode/gpt-6-sol": {
    off: "none",
    minimal: null,
    xhigh: "xhigh",
    max: "max",
  },
  "opencode/grok-4.5": {
    off: null,
    minimal: null,
    xhigh: null,
    max: null,
  },
  "opencode/grok-4.6": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/grok-build-0.1": {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    xhigh: null,
    max: null,
  },
  "opencode/muse-spark-1.2": { off: null, xhigh: "xhigh", max: null },
  "opencode/muse-spark-1.2-contributor-free": {
    off: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode/muse-spark-1.3": { off: null, xhigh: "xhigh", max: null },
  "opencode/muse-spark-1.3-contributor-free": {
    off: null,
    xhigh: "xhigh",
    max: null,
  },
  // Pi AI 0.87.1 providers/data/opencode-go.json (openai-responses).
  "opencode-go/gpt-5.6-luna": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: "max",
  },
  "opencode-go/grok-4.6": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode-go/grok-4.7": {
    off: null,
    minimal: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode-go/muse-spark-1.2-contributor": {
    off: null,
    xhigh: "xhigh",
    max: null,
  },
  "opencode-go/muse-spark-1.3-contributor": {
    off: null,
    xhigh: "xhigh",
    max: null,
  },
  // Cloudflare's native OpenAI Responses route requires the provider's openai/ model prefix.
  // These are the exact Pi AI 0.87.1 providers/data/cloudflare-ai-gateway.json rows.
  "cloudflare-ai-gateway/gpt-5": {
    off: null,
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5-mini": {
    off: null,
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5-nano": {
    off: null,
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.1": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.4": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.4-mini": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.4-nano": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.4-pro": {
    off: null,
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.5": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.5-pro": {
    off: null,
    minimal: null,
    low: null,
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "cloudflare-ai-gateway/gpt-5.6-luna": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "cloudflare-ai-gateway/gpt-5.6-sol": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "cloudflare-ai-gateway/gpt-5.6-terra": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "cloudflare-ai-gateway/gpt-6-astra": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "cloudflare-ai-gateway/o3": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "cloudflare-ai-gateway/o3-mini": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "cloudflare-ai-gateway/o4-mini": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
});

for (const row of Object.values(LEVEL_MAPS)) {
  if (!Object.hasOwn(row, "off")) {
    Object.defineProperty(row, "off", {
      value: null,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  Object.freeze(row);
}

export type ResponsesAdmission =
  | { readonly kind: "outside-scope" }
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "matched";
      readonly advertisedLevels: readonly ThinkingLevel[];
      readonly compatibleLevels: readonly ThinkingLevel[];
      readonly unsupportedLevels: readonly ThinkingLevel[];
      readonly proof: ContractProof;
    }
  | {
      readonly kind: "unproven-controls" | "construction-unproven";
      readonly advertisedLevels: readonly ThinkingLevel[];
      readonly unsupportedLevels: readonly ThinkingLevel[];
    };

const CANONICAL_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const RESPONSES_EVIDENCE =
  "opencode@8a8bd622 packages/ai/src/protocols/utils/open-responses-options.ts";
const PI_OPENAI = "pi-ai@0.87.1 providers/data/openai.json";
const PI_XAI = "pi-ai@0.87.1 providers/data/xai.json";
const PI_META = "pi-ai@0.87.1 providers/data/meta.json";
const PI_OPENCODE = "pi-ai@0.87.1 providers/data/opencode.json";
const PI_OPENCODE_GO = "pi-ai@0.87.1 providers/data/opencode-go.json";
const META_RESPONSES_EVIDENCE =
  "OpenCode 8a8bd622 packages/ai/src/providers/meta/responses.ts + protocols/meta-responses.ts + providers/meta.ts";
const COPILOT_RESPONSES_EVIDENCE =
  "OpenCode 8a8bd622 packages/core/src/github-copilot/responses/openai-responses-language-model.ts + packages/core/src/aisdk.ts + packages/core/src/plugin/provider/github-copilot.ts + packages/core/src/provider.ts";
const SAFE_NON_REASONING_INCLUDES = new Set(["code_interpreter_call.outputs"]);
// The Copilot lowerer's runtime schema is narrower than its API include type.
const COPILOT_INCLUDE_VALUES = new Set([
  ENCRYPTED_REASONING,
  "file_search_call.results",
  "message.output_text.logprobs",
]);
const COPILOT_LEVEL_MAPS: Readonly<
  Record<string, Readonly<Record<string, string | null>>>
> = Object.freeze({
  "github-copilot/gpt-5-mini": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "github-copilot/gpt-5.3-codex": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "github-copilot/gpt-5.4": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "github-copilot/gpt-5.4-mini": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "github-copilot/gpt-5.4-nano": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "github-copilot/gpt-5.5": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "github-copilot/gpt-5.6-luna": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "github-copilot/gpt-5.6-sol": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "github-copilot/gpt-5.6-terra": {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "github-copilot/gpt-6-astra": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "github-copilot/gpt-6-luna": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "github-copilot/gpt-6-sol": {
    off: "none",
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  "github-copilot/grok-4.5": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "github-copilot/grok-4.6": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "github-copilot/grok-4.7": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: null,
  },
  "github-copilot/mai-code-1-flash-picker": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
  "github-copilot/mai-code-1.1-flash": {
    off: null,
    minimal: null,
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: null,
  },
});
for (const levels of Object.values(COPILOT_LEVEL_MAPS)) Object.freeze(levels);

// Source-level admission does not authenticate a provider or prove the final wire. The returned
// proof names both the exact Pi row and the native projection constraints used by this matcher.
export function admitResponsesVariant(
  model: ThinkingModel,
  variant: ThinkingVariant,
): ResponsesAdmission {
  const identity = readIdentity(model);
  if (identity.kind === "outside-scope") return identity;
  if (identity.kind !== "resolved") return { kind: "unresolved" };

  if (
    identity.provider === "github-copilot" &&
    !hasCopilotResponsesRoute(model, variant, identity.modelID)
  ) {
    return { kind: "unresolved" };
  }
  const rawLevels =
    identity.provider === "github-copilot"
      ? COPILOT_LEVEL_MAPS[`${identity.provider}/${identity.modelID}`]
      : LEVEL_MAPS[`${identity.provider}/${identity.modelID}`];
  if (rawLevels === undefined) return { kind: "unresolved" };
  if (
    identity.provider === "cloudflare-ai-gateway" &&
    !hasNativeCloudflareBaseURL(model, variant)
  ) {
    return { kind: "unresolved" };
  }
  const levels = completeLevelMap(rawLevels, identity);
  const advertisedLevels = CANONICAL_LEVELS.filter(
    (level) => levels[level] !== null,
  );
  const unsupportedLevels = CANONICAL_LEVELS.filter(
    (level) => levels[level] === null,
  );
  if (identity.route === "generic" && !hasDeclaredBaseURL(model, variant)) {
    return {
      kind: "construction-unproven",
      advertisedLevels,
      unsupportedLevels,
    };
  }
  if (
    identity.provider === "cloudflare-ai-gateway" &&
    !hasCloudflareAccountId(model, variant)
  ) {
    return {
      kind: "construction-unproven",
      advertisedLevels,
      unsupportedLevels,
    };
  }
  const controls =
    identity.provider === "github-copilot"
      ? readCopilotControls(model, variant)
      : readControls(
          model,
          variant,
          identity.provider,
          identity.modelID,
          identity.route,
        );
  if (controls === undefined)
    return { kind: "unproven-controls", advertisedLevels, unsupportedLevels };

  const effort = controls.effort;
  const compatibleLevels = CANONICAL_LEVELS.filter(
    (level) =>
      level !== "off" && levels[level] !== null && levels[level] === effort,
  );
  const offAdmitted =
    identity.provider !== "github-copilot" && levels.off !== null;
  const expectedOffInclude =
    identity.provider === "xai" ? "encrypted" : "absent";
  const positiveIncludeMatches =
    identity.provider === "github-copilot"
      ? includesCopilotEncryptedReasoning(controls.include)
      : controls.include === undefined ||
        includeContainsReasoning(controls.include);
  const positiveControlsMatch =
    controls.summary === "auto" && positiveIncludeMatches;
  const offControlsMatch =
    effort === "none" &&
    controls.summary === undefined &&
    (expectedOffInclude === "encrypted"
      ? includeContainsReasoning(controls.include)
      : controls.include === undefined);
  const offCompatible = offAdmitted && offControlsMatch;
  const compatible = offCompatible
    ? ["off" as const]
    : positiveControlsMatch
      ? compatibleLevels
      : [];
  if (compatible.length === 0) {
    return { kind: "unproven-controls", advertisedLevels, unsupportedLevels };
  }

  const sourceFile =
    identity.provider === "github-copilot"
      ? "pi-ai@0.87.1 providers/data/github-copilot.json"
      : identity.provider === "cloudflare-ai-gateway"
        ? "pi-ai@0.87.1 providers/data/cloudflare-ai-gateway.json"
        : identity.provider === "openai"
          ? PI_OPENAI
          : identity.provider === "xai"
            ? PI_XAI
            : identity.provider === "meta"
              ? PI_META
              : identity.provider === "opencode"
                ? PI_OPENCODE
                : PI_OPENCODE_GO;
  const projection = offCompatible
    ? expectedOffInclude === "encrypted"
      ? "OpenCode Responses projection: effort=none, summary absent, encrypted include retained"
      : "OpenCode Responses projection: effort=none, summary absent, include absent"
    : identity.provider === "github-copilot"
      ? "Copilot Responses projection: effort and summary=auto required; encrypted include is forced before caller body overlay"
      : identity.provider === "meta"
        ? "OpenCode Meta Responses projection: mapped effort, summary=auto required, encrypted include retained"
        : "OpenCode Responses projection: mapped effort, summary=auto, encrypted include retained";
  return {
    kind: "matched",
    advertisedLevels,
    compatibleLevels: compatible,
    unsupportedLevels,
    proof: {
      sourceScope: "pi-model-recipe",
      transportKind: "native",
      compatibleLevels: compatible,
      evidence: `${sourceFile} ${identity.provider}/${identity.modelID}; ${identity.provider === "github-copilot" ? COPILOT_RESPONSES_EVIDENCE : identity.provider === "meta" ? META_RESPONSES_EVIDENCE : RESPONSES_EVIDENCE}; ${projection} (conditional, not final wire)`,
    },
  };
}

function completeLevelMap(
  raw: Readonly<Record<string, string | null>>,
  provider: Identity & { readonly kind: "resolved" },
): Record<ThinkingLevel, string | null> {
  return Object.fromEntries(
    CANONICAL_LEVELS.map((level) => [
      level,
      Object.hasOwn(raw, level)
        ? (raw[level] ?? null)
        : level !== "off" &&
            OPENCODE_PROVIDER_IDS.has(provider.provider) &&
            ["minimal", "low", "medium", "high"].includes(level)
          ? level
          : null,
    ]),
  ) as Record<ThinkingLevel, string | null>;
}

type ResponsesProvider =
  | "openai"
  | "github-copilot"
  | "xai"
  | "meta"
  | "opencode"
  | "opencode-go"
  | "cloudflare-ai-gateway";
type ResponsesRoute = "native" | "facade" | "generic" | "copilot";
type Identity =
  | { readonly kind: "outside-scope" }
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "resolved";
      readonly provider: ResponsesProvider;
      readonly modelID: string;
      readonly route: ResponsesRoute;
    };

const OPENCODE_PROVIDER_IDS = new Set(["opencode", "opencode-go"]);

function readIdentity(model: ThinkingModel): Identity {
  try {
    if (
      ["providerID", "package", "canonical", "modelID", "id"].some((key) =>
        hasAccessor(model, key),
      )
    ) {
      return { kind: "unresolved" };
    }
    const providerID = ownData(model, "providerID");
    const packageName = ownData(model, "package");
    const isOpencodeProvider =
      typeof providerID === "string" && OPENCODE_PROVIDER_IDS.has(providerID);
    const isCloudflareProvider = providerID === "cloudflare-ai-gateway";
    const isCopilotProvider = providerID === "github-copilot";
    const knownProvider =
      providerID === "openai" ||
      providerID === "xai" ||
      providerID === "meta" ||
      isOpencodeProvider ||
      isCloudflareProvider ||
      isCopilotProvider;
    const knownPackage =
      Object.values(PACKAGE_BY_PROVIDER).some(
        (value) => value === packageName,
      ) ||
      (typeof packageName === "string" &&
        OPENCODE_FACADE_PACKAGES.has(packageName)) ||
      packageName === OPENCODE_GENERIC_RESPONSES_PACKAGE ||
      packageName === PACKAGE_BY_PROVIDER["github-copilot"];
    if (!knownProvider && !knownPackage) return { kind: "outside-scope" };
    if (typeof providerID !== "string" || typeof packageName !== "string")
      return { kind: "unresolved" };

    let route: ResponsesRoute = "native";
    if (isOpencodeProvider) {
      if (OPENCODE_FACADE_PACKAGES.has(packageName)) route = "facade";
      else if (packageName === OPENCODE_GENERIC_RESPONSES_PACKAGE)
        route = "generic";
      else return { kind: "unresolved" };
    } else if (isCloudflareProvider) {
      if (packageName !== PACKAGE_BY_PROVIDER["cloudflare-ai-gateway"])
        return { kind: "unresolved" };
    } else if (isCopilotProvider) {
      if (packageName !== PACKAGE_BY_PROVIDER["github-copilot"])
        return { kind: "unresolved" };
      route = "copilot";
    } else {
      const expectedPackage =
        PACKAGE_BY_PROVIDER[providerID as keyof typeof PACKAGE_BY_PROVIDER];
      if (expectedPackage === undefined || packageName !== expectedPackage)
        return { kind: "unresolved" };
    }

    const canonical = ownData(model, "canonical");
    if (canonical !== undefined && canonical !== providerID)
      return { kind: "unresolved" };
    const modelID = ownData(model, "modelID");
    const id = ownData(model, "id");
    const effectiveID = modelID ?? id;
    if (typeof effectiveID !== "string" || effectiveID.length === 0)
      return { kind: "unresolved" };
    if (isCloudflareProvider) {
      const prefix = "openai/";
      if (!effectiveID.startsWith(prefix)) return { kind: "unresolved" };
      const sourceModelID = effectiveID.slice(prefix.length);
      if (sourceModelID.length === 0) return { kind: "unresolved" };
      return {
        kind: "resolved",
        provider: providerID,
        modelID: sourceModelID,
        route,
      };
    }
    return {
      kind: "resolved",
      provider: providerID as ResponsesProvider,
      modelID: effectiveID,
      route,
    };
  } catch {
    return { kind: "unresolved" };
  }
}

type Controls = { effort: unknown; summary: unknown; include: unknown };

function hasCopilotResponsesRoute(
  model: ThinkingModel,
  variant: ThinkingVariant,
  modelID: string,
): boolean {
  try {
    if (
      ["settings"].some((key) => hasAccessor(model, key)) ||
      ["settings"].some((key) => hasAccessor(variant, key))
    )
      return false;
    const modelSettings = ownData(model, "settings");
    const variantSettings = ownData(variant, "settings");
    if (
      (modelSettings !== undefined && !isRecord(modelSettings)) ||
      (variantSettings !== undefined && !isRecord(variantSettings)) ||
      (modelSettings !== undefined && hasAccessor(modelSettings, "endpoint")) ||
      (variantSettings !== undefined &&
        hasAccessor(variantSettings, "endpoint"))
    )
      return false;
    const variantEndpoint = ownData(variantSettings, "endpoint");
    const endpoint =
      variantEndpoint === undefined
        ? ownData(modelSettings, "endpoint")
        : variantEndpoint;
    if (endpoint !== undefined) return endpoint === "responses";

    const gpt = /^gpt-(\d+)/.exec(modelID);
    return (
      (gpt !== null &&
        Number(gpt[1]) >= 5 &&
        !modelID.startsWith("gpt-5-mini")) ||
      modelID.startsWith("grok-") ||
      modelID.startsWith("gemini-") ||
      modelID.startsWith("mai-code-")
    );
  } catch {
    return false;
  }
}

function readCopilotControls(
  model: ThinkingModel,
  variant: ThinkingVariant,
): Controls | undefined {
  try {
    if (
      ["settings", "body"].some((key) => hasAccessor(model, key)) ||
      ["settings", "body"].some((key) => hasAccessor(variant, key))
    )
      return undefined;
    const modelSettings = readCopilotSettings(ownData(model, "settings"));
    const variantSettings = readCopilotSettings(ownData(variant, "settings"));
    const body = mergeBody(
      ownData(model, "body"),
      ownData(variant, "body"),
      isValidCopilotIncludes,
    );
    if (
      modelSettings === undefined ||
      variantSettings === undefined ||
      body === undefined
    )
      return undefined;

    let effort = overlaySetting(variantSettings.effort, modelSettings.effort);
    let summary = overlaySetting(
      variantSettings.summary,
      modelSettings.summary,
    );
    if (body.hasEffort) effort = body.effort;
    if (body.hasSummary) summary = body.summary;
    const includes = overlaySetting(
      variantSettings.include,
      modelSettings.include,
    );
    const include = body.hasInclude
      ? body.include
      : [...(includes ?? []), ENCRYPTED_REASONING];
    if (!includesCopilotEncryptedReasoning(include)) return undefined;
    return { effort, summary, include };
  } catch {
    return undefined;
  }
}

function readCopilotSettings(value: unknown):
  | {
      effort: unknown;
      summary: unknown;
      include: readonly string[] | undefined;
    }
  | undefined {
  if (value === undefined)
    return { effort: undefined, summary: undefined, include: undefined };
  if (!isRecord(value)) return undefined;
  for (const key of ["reasoningEffort", "reasoningSummary", "include"])
    if (hasAccessor(value, key)) return undefined;
  const effort = ownData(value, "reasoningEffort");
  const summary = ownData(value, "reasoningSummary");
  const include = ownData(value, "include");
  if (
    (effort !== undefined && effort !== null && typeof effort !== "string") ||
    (summary !== undefined &&
      summary !== null &&
      typeof summary !== "string") ||
    (include !== undefined &&
      include !== null &&
      !isValidCopilotIncludes(include))
  )
    return undefined;
  return {
    effort: effort === null ? undefined : effort,
    summary: summary === null ? undefined : summary,
    include: include === null ? undefined : include,
  };
}

function overlaySetting<T>(
  overlay: T | undefined,
  base: T | undefined,
): T | undefined {
  return overlay === undefined ? base : overlay;
}

function readControls(
  model: ThinkingModel,
  variant: ThinkingVariant,
  provider: ResponsesProvider,
  modelID: string,
  route: ResponsesRoute,
): Controls | undefined {
  try {
    if (
      ["settings", "body"].some((key) => hasAccessor(model, key)) ||
      ["settings", "body"].some((key) => hasAccessor(variant, key))
    )
      return undefined;
    const modelSettings = readSettings(ownData(model, "settings"));
    const variantSettings = readSettings(ownData(variant, "settings"));
    const body = mergeBody(ownData(model, "body"), ownData(variant, "body"));
    if (
      modelSettings === undefined ||
      variantSettings === undefined ||
      body === undefined
    )
      return undefined;
    const defaultInclude = [ENCRYPTED_REASONING];
    const selectedSettings =
      variantSettings.includeEmpty || variantSettings.include !== undefined
        ? variantSettings
        : modelSettings.includeEmpty || modelSettings.include !== undefined
          ? modelSettings
          : undefined;
    const facadeDefaults =
      route === "facade" || (provider === "openai" && route === "native");
    // The OpenAI facade normalizes GPT-5 defaults before applying caller options.
    // This predicate mirrors that native step, not Pi model admission.
    const lowerID = modelID.toLowerCase();
    const gpt5Defaults =
      facadeDefaults &&
      lowerID.includes("gpt-5") &&
      !lowerID.includes("gpt-5-chat") &&
      !lowerID.includes("gpt-5-pro");
    const projected: Controls = {
      effort:
        variantSettings.effort ??
        modelSettings.effort ??
        (gpt5Defaults ? "medium" : undefined),
      summary:
        variantSettings.summary ??
        modelSettings.summary ??
        (gpt5Defaults ? "auto" : undefined),
      include:
        selectedSettings === undefined
          ? defaultInclude
          : selectedSettings.includeEmpty
            ? undefined
            : selectedSettings.include,
    };
    if (body.hasEffort) projected.effort = body.effort;
    if (body.hasSummary) projected.summary = body.summary;
    if (body.hasInclude) projected.include = body.include;
    return isNativeControl(
      projectionValue(model, variant, "settings", "reasoningEffort"),
      projected.effort,
    ) &&
      isNativeControl(
        projectionValue(model, variant, "settings", "reasoningSummary"),
        projected.summary,
      ) &&
      (projected.include === undefined ||
        isValidLogicalIncludes(projected.include))
      ? projected
      : undefined;
  } catch {
    return undefined;
  }
}

function hasNativeCloudflareBaseURL(
  model: ThinkingModel,
  variant: ThinkingVariant,
): boolean {
  try {
    const modelSettings = ownData(model, "settings");
    const variantSettings = ownData(variant, "settings");
    if (
      (modelSettings !== undefined && !isRecord(modelSettings)) ||
      (variantSettings !== undefined && !isRecord(variantSettings)) ||
      (modelSettings !== undefined && hasAccessor(modelSettings, "baseURL")) ||
      (variantSettings !== undefined && hasAccessor(variantSettings, "baseURL"))
    ) {
      return false;
    }
    return (
      ownData(variantSettings, "baseURL") === undefined &&
      ownData(modelSettings, "baseURL") === undefined
    );
  } catch {
    return false;
  }
}

function hasCloudflareAccountId(
  model: ThinkingModel,
  variant: ThinkingVariant,
): boolean {
  try {
    const modelSettings = ownData(model, "settings");
    const variantSettings = ownData(variant, "settings");
    if (
      (modelSettings !== undefined && !isRecord(modelSettings)) ||
      (variantSettings !== undefined && !isRecord(variantSettings)) ||
      (modelSettings !== undefined &&
        hasAccessor(modelSettings, "accountId")) ||
      (variantSettings !== undefined &&
        hasAccessor(variantSettings, "accountId"))
    ) {
      return false;
    }
    const variantAccountId = ownData(variantSettings, "accountId");
    const accountId =
      variantAccountId === undefined
        ? ownData(modelSettings, "accountId")
        : variantAccountId;
    return typeof accountId === "string" && accountId.length > 0;
  } catch {
    return false;
  }
}

function hasDeclaredBaseURL(
  model: ThinkingModel,
  variant: ThinkingVariant,
): boolean {
  try {
    return hasDeclaredBaseURLData(model, variant);
  } catch {
    return false;
  }
}

function hasDeclaredBaseURLData(
  model: ThinkingModel,
  variant: ThinkingVariant,
): boolean {
  const modelSettings = ownData(model, "settings");
  const variantSettings = ownData(variant, "settings");
  if (
    (modelSettings !== undefined &&
      (!isRecord(modelSettings) || hasAccessor(modelSettings, "baseURL"))) ||
    (variantSettings !== undefined &&
      (!isRecord(variantSettings) || hasAccessor(variantSettings, "baseURL")))
  )
    return false;
  const variantBaseURL = ownData(variantSettings, "baseURL");
  if (variantBaseURL !== undefined) return typeof variantBaseURL === "string";
  return typeof ownData(modelSettings, "baseURL") === "string";
}

type Settings = {
  effort: unknown;
  summary: unknown;
  include: unknown;
  includeEmpty: boolean;
};
function readSettings(value: unknown): Settings | undefined {
  if (value === undefined)
    return {
      effort: undefined,
      summary: undefined,
      include: undefined,
      includeEmpty: false,
    };
  if (
    !isRecord(value) ||
    ["reasoningEffort", "reasoningSummary", "include"].some((key) =>
      hasAccessor(value, key),
    ) ||
    [
      "thinking",
      "thinkingBudget",
      "thinkingConfig",
      "reasoningConfig",
      "reasoning",
      "reasoning_effort",
      "reasoning_budget",
      "budgetTokens",
    ].some((key) => hasOwn(value, key))
  )
    return undefined;
  const effort = ownData(value, "reasoningEffort");
  const summary = ownData(value, "reasoningSummary");
  const include = ownData(value, "include");
  if (
    (effort !== undefined && typeof effort !== "string") ||
    (summary !== undefined &&
      summary !== "auto" &&
      summary !== "concise" &&
      summary !== "detailed") ||
    (include !== undefined && !isValidInclude(include))
  )
    return undefined;
  return {
    effort,
    summary,
    include:
      Array.isArray(include) && include.length === 0 ? undefined : include,
    includeEmpty: Array.isArray(include) && include.length === 0,
  };
}

function mergeBody(
  base: unknown,
  overlay: unknown,
  isValidIncludes: (
    value: unknown,
  ) => value is readonly string[] = isValidLogicalIncludes,
):
  | (Controls & {
      hasEffort: boolean;
      hasSummary: boolean;
      hasInclude: boolean;
    })
  | undefined {
  const baseFields = bodyControls(base, isValidIncludes);
  const overlayFields = bodyControls(overlay, isValidIncludes);
  if (baseFields === undefined || overlayFields === undefined) return undefined;
  return {
    effort: overlayFields.hasEffort ? overlayFields.effort : baseFields.effort,
    summary: overlayFields.hasSummary
      ? overlayFields.summary
      : baseFields.summary,
    include: overlayFields.hasInclude
      ? overlayFields.include
      : baseFields.include,
    hasEffort: overlayFields.hasEffort || baseFields.hasEffort,
    hasSummary: overlayFields.hasSummary || baseFields.hasSummary,
    hasInclude: overlayFields.hasInclude || baseFields.hasInclude,
  };
}

function bodyControls(
  value: unknown,
  isValidIncludes: (
    value: unknown,
  ) => value is readonly string[] = isValidLogicalIncludes,
):
  | (Controls & {
      hasEffort: boolean;
      hasSummary: boolean;
      hasInclude: boolean;
    })
  | undefined {
  if (value === undefined)
    return {
      effort: undefined,
      summary: undefined,
      include: undefined,
      hasEffort: false,
      hasSummary: false,
      hasInclude: false,
    };
  if (
    !isRecord(value) ||
    ["include", "reasoning"].some((key) => hasAccessor(value, key)) ||
    [
      "reasoning_effort",
      "reasoning_summary",
      "reasoningEffort",
      "reasoningSummary",
      "thinking",
      "thinkingBudget",
      "thinkingConfig",
      "reasoningConfig",
      "budget_tokens",
      "reasoning_budget",
    ].some((key) => hasOwn(value, key))
  )
    return undefined;
  const include = ownField(value, "include");
  const reasoning = ownField(value, "reasoning");
  let effort: unknown;
  let summary: unknown;
  let hasEffort = false;
  let hasSummary = false;
  if (reasoning !== undefined) {
    if (
      !isRecord(reasoning) ||
      ["effort", "summary"].some((key) => hasAccessor(reasoning, key))
    )
      return undefined;
    for (const key of ownKeys(reasoning))
      if (!["effort", "summary"].includes(key)) return undefined;
    effort = ownField(reasoning, "effort");
    summary = ownField(reasoning, "summary");
    hasEffort = hasOwn(reasoning, "effort");
    hasSummary = hasOwn(reasoning, "summary");
  }
  if (include !== undefined && !isValidIncludes(include)) return undefined;
  return {
    effort,
    summary,
    include,
    hasEffort: hasEffort && effort !== undefined,
    hasSummary: hasSummary && summary !== undefined,
    hasInclude: hasOwn(value, "include") && include !== undefined,
  };
}

function projectionValue(
  model: ThinkingModel,
  variant: ThinkingVariant,
  field: string,
  key: string,
): unknown {
  const variantSettings = ownData(variant, field);
  const modelSettings = ownData(model, field);
  const v =
    variantSettings === undefined ? undefined : ownData(variantSettings, key);
  return (
    v ?? (modelSettings === undefined ? undefined : ownData(modelSettings, key))
  );
}

function isNativeControl(_explicit: unknown, value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
function isValidInclude(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1)
    if (typeof ownData(value, String(index)) !== "string") return false;
  return true;
}
function isValidLogicalIncludes(value: unknown): value is readonly string[] {
  if (!isValidInclude(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const entry = ownData(value, String(index));
    if (
      entry !== ENCRYPTED_REASONING &&
      !(typeof entry === "string" && SAFE_NON_REASONING_INCLUDES.has(entry))
    )
      return false;
  }
  return true;
}
function isValidCopilotIncludes(value: unknown): value is readonly string[] {
  if (!isValidInclude(value)) return false;
  for (let index = 0; index < value.length; index += 1)
    if (!COPILOT_INCLUDE_VALUES.has(ownData(value, String(index)) as string))
      return false;
  return true;
}
function includeContainsReasoning(value: unknown): boolean {
  if (!isValidLogicalIncludes(value)) return false;
  for (let index = 0; index < value.length; index += 1)
    if (ownData(value, String(index)) === ENCRYPTED_REASONING) return true;
  return false;
}
function includesCopilotEncryptedReasoning(value: unknown): boolean {
  if (!isValidCopilotIncludes(value)) return false;
  for (let index = 0; index < value.length; index += 1)
    if (ownData(value, String(index)) === ENCRYPTED_REASONING) return true;
  return false;
}
function isRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function ownData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function hasAccessor(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && !("value" in descriptor);
}
function ownField(value: object, key: string): unknown {
  return ownData(value, key);
}
function hasOwn(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor;
}
function ownKeys(value: object): string[] {
  return Object.keys(value);
}

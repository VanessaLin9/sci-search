/**
 * LLM provider profile（json mode、thinking kwargs、start spacing）。
 *
 * 未設定 profile env 時，只對已知 host 套用 nvidia／gemini。
 * 其餘 host，以及明示 `generic`，不送 `chat_template_kwargs`，也不套 NVIDIA 2s 間隔。
 * Prompt builder 仍只看 `disableThinking`／`preferJsonResponseFormat`，換模型不用改它們。
 * 非法 profile env 直接 throw，不靜默當成 nvidia（PR #41）。
 */
import {
  GEMINI_LLM_RATE_POLICY,
  NVIDIA_LLM_RATE_POLICY,
  type LlmQuotaBucketPolicy,
} from "./llmRequestScheduler.js";

export const LLM_PROVIDER_PROFILE_IDS = ["nvidia", "gemini", "generic"] as const;

export type LlmProviderProfileId = (typeof LLM_PROVIDER_PROFILE_IDS)[number];

/** 未知 provider 的 start-to-start 間隔。比 NVIDIA 2s 保守，避免陌生 RPM 被打滿。 */
export const GENERIC_MIN_START_INTERVAL_MS = 5_000;

export const GENERIC_LLM_RATE_POLICY: LlmQuotaBucketPolicy = {
  minStartIntervalMs: GENERIC_MIN_START_INTERVAL_MS,
};

export type LlmProviderProfile = {
  id: LlmProviderProfileId;
  preferJsonResponseFormat: boolean;
  /** True 時 prompt builder 才附上 NVIDIA/vLLM `chat_template_kwargs`。 */
  disableThinking: boolean;
  policy: LlmQuotaBucketPolicy;
};

export function isNvidiaIntegrateApi(baseUrl: string): boolean {
  return baseUrl.includes("integrate.api.nvidia.com");
}

export function isGeminiOpenAiCompatibleApi(baseUrl: string): boolean {
  return baseUrl.includes("generativelanguage.googleapis.com");
}

export function readLlmProviderProfileId(envName: string): LlmProviderProfileId | undefined {
  const raw = process.env[envName]?.trim();
  if (!raw) return undefined;
  if ((LLM_PROVIDER_PROFILE_IDS as readonly string[]).includes(raw)) {
    return raw as LlmProviderProfileId;
  }
  throw new Error(
    `${envName} must be one of ${LLM_PROVIDER_PROFILE_IDS.join(", ")} (got ${JSON.stringify(raw)}).`,
  );
}

/** 沒有明示 profile 時的 host 對照。未知 host → generic。 */
export function inferLlmProviderProfileId(baseUrl: string): LlmProviderProfileId {
  if (isNvidiaIntegrateApi(baseUrl)) return "nvidia";
  if (isGeminiOpenAiCompatibleApi(baseUrl)) return "gemini";
  return "generic";
}

/**
 * `enableThinking` 只影響 nvidia profile（沿用 routing.json／digest.json）。
 * gemini／generic 一律不送 thinking kwargs。
 */
export function resolveLlmProviderProfile(options: {
  baseUrl: string;
  profileId?: LlmProviderProfileId;
  enableThinking: boolean;
}): LlmProviderProfile {
  const id = options.profileId ?? inferLlmProviderProfileId(options.baseUrl);

  if (id === "nvidia") {
    return {
      id,
      preferJsonResponseFormat: false,
      disableThinking: !options.enableThinking,
      policy: NVIDIA_LLM_RATE_POLICY,
    };
  }

  if (id === "gemini") {
    return {
      id,
      preferJsonResponseFormat: true,
      disableThinking: false,
      policy: GEMINI_LLM_RATE_POLICY,
    };
  }

  return {
    id: "generic",
    preferJsonResponseFormat: true,
    disableThinking: false,
    policy: GENERIC_LLM_RATE_POLICY,
  };
}

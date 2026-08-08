/**
 * Resolve opaque LLM quota bucket identity + provider spacing policy（PR #35）。
 *
 * Bucket id 含 provider／baseUrl／credential fingerprint——不得輸出 raw API key。
 * Gemini quota 是 per project 不是 per key；fingerprint 只作 process 內 isolation，
 * 不能宣稱不同 key 必然不同 quota pool。
 */
import { createHash } from "node:crypto";
import { isNvidiaIntegrateApi } from "../routing/config.js";
import {
  GEMINI_LLM_RATE_POLICY,
  NVIDIA_LLM_RATE_POLICY,
  type LlmQuotaBucketPolicy,
} from "./llmRequestScheduler.js";

export type LlmQuotaProvider = "nvidia" | "gemini" | "other";

export type ResolvedLlmQuotaTarget = {
  provider: LlmQuotaProvider;
  /** Opaque id for scheduler state（safe for logs）. */
  bucket: string;
  policy: LlmQuotaBucketPolicy;
  /** Log-safe identity fragment（provider + base + masked fingerprint）. */
  logLabel: string;
};

export function credentialFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}

export function isGeminiOpenAiCompatibleApi(baseUrl: string): boolean {
  return baseUrl.includes("generativelanguage.googleapis.com");
}

export function resolveLlmQuotaTarget(baseUrl: string, apiKey: string): ResolvedLlmQuotaTarget {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const fingerprint = credentialFingerprint(apiKey);

  if (isNvidiaIntegrateApi(normalizedBase)) {
    return {
      provider: "nvidia",
      bucket: `nvidia:${normalizedBase}|${fingerprint}`,
      policy: NVIDIA_LLM_RATE_POLICY,
      logLabel: `nvidia|${normalizedBase}|fp=${fingerprint}`,
    };
  }

  if (isGeminiOpenAiCompatibleApi(normalizedBase)) {
    return {
      provider: "gemini",
      bucket: `gemini:${normalizedBase}|${fingerprint}`,
      policy: GEMINI_LLM_RATE_POLICY,
      logLabel: `gemini|${normalizedBase}|fp=${fingerprint}`,
    };
  }

  // 未知 provider：獨立 bucket，先套保守 NVIDIA spacing；日後再加專屬 policy（PR #35）。
  return {
    provider: "other",
    bucket: `other:${normalizedBase}|${fingerprint}`,
    policy: NVIDIA_LLM_RATE_POLICY,
    logLabel: `other|${normalizedBase}|fp=${fingerprint}`,
  };
}

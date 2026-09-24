/**
 * Resolve opaque LLM quota bucket identity + provider spacing policy（PR #35）。
 *
 * Bucket id 含 profile／baseUrl／credential fingerprint——不得輸出 raw API key。
 * 同一 baseUrl 若明示不同 profile，bucket 必須分開，否則 scheduler 會因 spacing 不一致丟錯。
 * Gemini quota 是 per project 不是 per key；fingerprint 只作 process 內 isolation，
 * 不能宣稱不同 key 必然不同 quota pool。
 */
import { createHash } from "node:crypto";
import {
  inferLlmProviderProfileId,
  resolveLlmProviderProfile,
  type LlmProviderProfile,
  type LlmProviderProfileId,
} from "./llmProviderProfile.js";
import type { LlmQuotaBucketPolicy } from "./llmRequestScheduler.js";

export type { LlmProviderProfile, LlmProviderProfileId };
export { isGeminiOpenAiCompatibleApi } from "./llmProviderProfile.js";

export type LlmQuotaProvider = LlmProviderProfileId;

export type ResolvedLlmQuotaTarget = {
  provider: LlmQuotaProvider;
  /** Opaque id for scheduler state（safe for logs）. */
  bucket: string;
  policy: LlmQuotaBucketPolicy;
  /** Log-safe identity fragment（profile + base + masked fingerprint）. */
  logLabel: string;
};

export function credentialFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
}

/**
 * `profile` 省略時依 baseUrl 推斷（未知 host 為 generic，不是 NVIDIA 2s）。
 * 呼叫端若已解析 env profile，必須傳入，否則明示 generic 仍會被 NVIDIA host 蓋掉。
 */
export function resolveLlmQuotaTarget(
  baseUrl: string,
  apiKey: string,
  profile?: LlmProviderProfile,
): ResolvedLlmQuotaTarget {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const resolved =
    profile ??
    resolveLlmProviderProfile({
      baseUrl: normalizedBase,
      profileId: inferLlmProviderProfileId(normalizedBase),
      enableThinking: false,
    });
  const fingerprint = credentialFingerprint(apiKey);

  return {
    provider: resolved.id,
    bucket: `${resolved.id}:${normalizedBase}|${fingerprint}`,
    policy: resolved.policy,
    logLabel: `${resolved.id}|${normalizedBase}|fp=${fingerprint}`,
  };
}

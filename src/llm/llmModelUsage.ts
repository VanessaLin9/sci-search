/**
 * 當日 LLM model 紀錄（PR #40）：digest footer 用 requested env + API `completion.model`。
 * 顯示層禁止硬編碼 muse／Gemini 等 provider id。
 */

export type LlmModelUsage = {
  /** Model id we sent on the request (that day's env／config). */
  requested: string;
  /** Unique API-returned model ids from completions that came back. */
  observed?: string[];
};

export type DigestSummarizeModels = {
  requested: number;
  failed: number;
  primary: LlmModelUsage & { succeeded: number };
  fallback?: LlmModelUsage & { succeeded: number };
};

export type DigestTranslateModels = {
  requested: number;
  succeeded: number;
  failed: number;
  model: LlmModelUsage;
};

export type DigestLlmModelsSnapshot = {
  spatial?: LlmModelUsage & { llmTagged?: number };
  summarize?: DigestSummarizeModels;
  translate?: DigestTranslateModels;
};

export function observedLlmModel(completion: { model?: string | null }): string | undefined {
  const value = completion.model?.trim();
  return value || undefined;
}

export function uniqueModels(models: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of models) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

export function llmModelUsage(
  requested: string,
  observed: Array<string | undefined | null> = [],
): LlmModelUsage {
  const unique = uniqueModels(observed);
  return unique.length > 0 ? { requested, observed: unique } : { requested };
}

/** Footer 顯示契約（PR #40）：有 observed 用 API 回傳 id；否則退回當天 requested env。 */
export function displayLlmModel(usage: LlmModelUsage): string {
  if (!usage.observed?.length) return usage.requested;
  if (usage.observed.length === 1) return usage.observed[0]!;
  return usage.observed.join(" · ");
}

export function requestedModelFromEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function noteObservedModel(
  sink: string[],
  completion: { model?: string | null },
): void {
  const observed = observedLlmModel(completion);
  if (observed) sink.push(observed);
}

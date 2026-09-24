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
  /** primary + fallback 成功篇數。舊 footer 在沒有 fallback 時仍用這個當分子。 */
  succeeded: number;
  failed: number;
  /** Primary model。歷史 papers.json 只寫這欄。 */
  model: LlmModelUsage;
  primarySucceeded?: number;
  fallback?: LlmModelUsage & { succeeded: number };
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

/** Persist 進來的 model blob fail-open：空字串／非字串／空 observed 丟掉，不擋整份 papers.json（PR #40）。 */
export function sanitizePersistedLlmModelUsage(raw: unknown): LlmModelUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const requested = typeof record.requested === "string" ? record.requested.trim() : "";
  if (!requested) return undefined;
  const observed = Array.isArray(record.observed)
    ? record.observed.filter((item): item is string => typeof item === "string")
    : [];
  return llmModelUsage(requested, observed);
}

export function sanitizeDigestLlmModelsSnapshot(raw: unknown): DigestLlmModelsSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const snapshot: DigestLlmModelsSnapshot = {};

  const spatialUsage = sanitizePersistedLlmModelUsage(record.spatial);
  if (spatialUsage) {
    const llmTagged = finiteNumber(
      record.spatial && typeof record.spatial === "object"
        ? (record.spatial as { llmTagged?: unknown }).llmTagged
        : undefined,
    );
    snapshot.spatial = llmTagged == null ? spatialUsage : { ...spatialUsage, llmTagged };
  }

  const summarize = sanitizeSummarizeModels(record.summarize);
  if (summarize) snapshot.summarize = summarize;

  const translate = sanitizeTranslateModels(record.translate);
  if (translate) snapshot.translate = translate;

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeSummarizeModels(raw: unknown): DigestSummarizeModels | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const requested = finiteNumber(record.requested);
  const failed = finiteNumber(record.failed);
  const primaryUsage = sanitizePersistedLlmModelUsage(record.primary);
  const primarySucceeded = finiteNumber(
    record.primary && typeof record.primary === "object"
      ? (record.primary as { succeeded?: unknown }).succeeded
      : undefined,
  );
  if (requested == null || failed == null || !primaryUsage || primarySucceeded == null) {
    return undefined;
  }

  const summarize: DigestSummarizeModels = {
    requested,
    failed,
    primary: { ...primaryUsage, succeeded: primarySucceeded },
  };

  const fallbackUsage = sanitizePersistedLlmModelUsage(record.fallback);
  const fallbackSucceeded = finiteNumber(
    record.fallback && typeof record.fallback === "object"
      ? (record.fallback as { succeeded?: unknown }).succeeded
      : undefined,
  );
  if (fallbackUsage && fallbackSucceeded != null) {
    summarize.fallback = { ...fallbackUsage, succeeded: fallbackSucceeded };
  }
  return summarize;
}

function sanitizeTranslateModels(raw: unknown): DigestTranslateModels | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const requested = finiteNumber(record.requested);
  const succeeded = finiteNumber(record.succeeded);
  const failed = finiteNumber(record.failed);
  const model = sanitizePersistedLlmModelUsage(record.model);
  // 舊 papers.json 只有 model／succeeded。缺 primarySucceeded 或 fallback 仍留這段，不能整段丟掉（PR #41）。
  if (requested == null || succeeded == null || failed == null || !model) return undefined;

  const translate: DigestTranslateModels = { requested, succeeded, failed, model };
  const primarySucceeded = finiteNumber(record.primarySucceeded);
  if (primarySucceeded != null) translate.primarySucceeded = primarySucceeded;

  const fallbackUsage = sanitizePersistedLlmModelUsage(record.fallback);
  const fallbackSucceeded = finiteNumber(
    record.fallback && typeof record.fallback === "object"
      ? (record.fallback as { succeeded?: unknown }).succeeded
      : undefined,
  );
  if (fallbackUsage && fallbackSucceeded != null) {
    translate.fallback = { ...fallbackUsage, succeeded: fallbackSucceeded };
  }
  return translate;
}


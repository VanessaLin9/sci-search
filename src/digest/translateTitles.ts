/**
 * Phase 2b：overflow（非 featured）批次翻英文標題 → `titleZh`。
 *
 * 失敗契約：
 * - 整批 HTTP／JSON 失敗 → 同一批改打 digest fallback endpoint（若有設定）
 * - fallback 也失敗 → 該批留英文標題，繼續下一批，不中斷 daily
 * - 部分 item schema invalid → 保留合法項；缺的 id 才送 fallback（PR #31 salvage）
 *
 * LLM HTTP 走 `callDigestChatCompletion`（gate=`digest-translate`）。
 * 逐項解析契約 owner：`parseTranslateBatchResponse`。
 */
import { callDigestChatCompletion } from "./callDigestChat.js";
import { getDigestLlmConfig, withDigestFallbackEndpoint, type DigestLlmConfig } from "./config.js";
import { extractDigestMessageContent } from "./extractDigestContent.js";
import { logDigest } from "./digestLog.js";
import { llmModelUsage, noteObservedModel, type DigestTranslateModels } from "../llm/llmModelUsage.js";
import {
  formatTranslateBatchSummary,
  parseTranslateBatchResponse,
} from "./parseTranslateBatchResponse.js";
import { planTranslateBatches } from "./planTranslateBatches.js";
import {
  buildDigestTranslateCompletionParams,
  estimateTranslateCompletionTokens,
} from "./translatePrompt.js";
import { toDigestTranslateInput } from "./toTranslateInput.js";
import type { DigestTranslateStats } from "./types.js";
import type { ClassifiedPaper } from "../types.js";

type TranslateItem = ReturnType<typeof toDigestTranslateInput>;

/** 僅處理非 featured 且 digestLine ≠ skip 的 overflow；失敗則該批不加 titleZh。 */
export async function translateOverflowTitles(options: {
  papers: ClassifiedPaper[];
  config?: DigestLlmConfig;
}): Promise<{
  titleZhById: Map<string, string>;
  stats: DigestTranslateStats;
  models: DigestTranslateModels;
}> {
  const overflow = options.papers.filter(
    (paper) => !paper.featured && paper.digestLine && paper.digestLine !== "skip",
  );
  const config = options.config ?? getDigestLlmConfig();
  const fallbackConfig = withDigestFallbackEndpoint(config);
  const titleZhById = new Map<string, string>();
  const primaryObserved: string[] = [];
  const fallbackObserved: string[] = [];

  if (overflow.length === 0) {
    return {
      titleZhById,
      stats: emptyTranslateStats(),
      models: translateModels({
        requested: 0,
        primarySucceeded: 0,
        fallbackSucceeded: 0,
        failed: 0,
        primaryModel: config.model,
        primaryObserved,
        fallbackConfig,
        fallbackObserved,
      }),
    };
  }

  const inputs = overflow.map(toDigestTranslateInput);
  const batches = planTranslateBatches(inputs, config.maxPapersPerBatch, config.maxInputTokens);
  const batchTotal = batches.length;
  let primarySucceeded = 0;
  let fallbackSucceeded = 0;
  let failed = 0;

  logDigest(
    `translate ${overflow.length} overflow title(s) in ${batchTotal} batch(es)` +
      ` · primary=${config.model}` +
      (fallbackConfig ? ` fallback=${fallbackConfig.model}` : " fallback=off"),
  );

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchLabel = batchTotal > 1 ? `translate ${index + 1}/${batchTotal}` : "translate 1/1";
    const outcome = await translateBatchWithFallback({
      batch,
      config,
      fallbackConfig,
      batchLabel,
      primaryObserved,
      fallbackObserved,
    });

    for (const [id, titleZh] of outcome.titleZhById) {
      titleZhById.set(id, titleZh);
    }
    primarySucceeded += outcome.primarySucceeded;
    fallbackSucceeded += outcome.fallbackSucceeded;
    failed += outcome.failedIds.length;
    if (outcome.failedIds.length > 0) {
      logDigest(
        `${batchLabel}: no translation for ${outcome.failedIds.length}: ${outcome.failedIds.join(", ")}`,
      );
    }
  }

  const llmTranslated = primarySucceeded + fallbackSucceeded;
  logDigest(
    `translate done: ${llmTranslated} LLM (primary=${primarySucceeded}, fallback=${fallbackSucceeded}), ${failed} without titleZh`,
  );

  return {
    titleZhById,
    stats: {
      requested: overflow.length,
      llmTranslated,
      primarySucceeded,
      fallbackSucceeded,
      failed,
    },
    models: translateModels({
      requested: overflow.length,
      primarySucceeded,
      fallbackSucceeded,
      failed,
      primaryModel: config.model,
      primaryObserved,
      fallbackConfig,
      fallbackObserved,
    }),
  };
}

function emptyTranslateStats(): DigestTranslateStats {
  return {
    requested: 0,
    llmTranslated: 0,
    primarySucceeded: 0,
    fallbackSucceeded: 0,
    failed: 0,
  };
}

type TranslateBatchOutcome = {
  titleZhById: Map<string, string>;
  failedIds: string[];
};

type BatchWithFallbackOutcome = {
  titleZhById: Map<string, string>;
  primarySucceeded: number;
  fallbackSucceeded: number;
  failedIds: string[];
};

async function translateBatchWithFallback(options: {
  batch: TranslateItem[];
  config: DigestLlmConfig;
  fallbackConfig: DigestLlmConfig | undefined;
  batchLabel: string;
  primaryObserved: string[];
  fallbackObserved: string[];
}): Promise<BatchWithFallbackOutcome> {
  let primary: TranslateBatchOutcome;
  try {
    primary = await translateBatchOnce(
      options.batch,
      options.config,
      options.batchLabel,
      options.primaryObserved,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!options.fallbackConfig) {
      logDigest(`${options.batchLabel}: failed (${message}); skip ${options.batch.length} paper(s)`);
      return {
        titleZhById: new Map(),
        primarySucceeded: 0,
        fallbackSucceeded: 0,
        failedIds: options.batch.map((item) => item.id),
      };
    }
    logDigest(
      `${options.batchLabel}: primary failed (${message}); fallback for ${options.batch.length} paper(s)`,
    );
    return retryMissingOnFallback({
      items: options.batch,
      kept: new Map(),
      primarySucceeded: 0,
      fallbackConfig: options.fallbackConfig,
      batchLabel: options.batchLabel,
      fallbackObserved: options.fallbackObserved,
    });
  }

  if (primary.failedIds.length === 0 || !options.fallbackConfig) {
    return {
      titleZhById: primary.titleZhById,
      primarySucceeded: primary.titleZhById.size,
      fallbackSucceeded: 0,
      failedIds: primary.failedIds,
    };
  }

  const missing = options.batch.filter((item) => primary.failedIds.includes(item.id));
  logDigest(
    `${options.batchLabel}: primary salvaged ${primary.titleZhById.size}; fallback for ${missing.length} paper(s)`,
  );
  return retryMissingOnFallback({
    items: missing,
    kept: primary.titleZhById,
    primarySucceeded: primary.titleZhById.size,
    fallbackConfig: options.fallbackConfig,
    batchLabel: options.batchLabel,
    fallbackObserved: options.fallbackObserved,
  });
}

async function retryMissingOnFallback(options: {
  items: TranslateItem[];
  kept: Map<string, string>;
  primarySucceeded: number;
  fallbackConfig: DigestLlmConfig;
  batchLabel: string;
  fallbackObserved: string[];
}): Promise<BatchWithFallbackOutcome> {
  try {
    const outcome = await translateBatchOnce(
      options.items,
      options.fallbackConfig,
      `${options.batchLabel} fallback`,
      options.fallbackObserved,
    );
    const titleZhById = new Map(options.kept);
    for (const [id, titleZh] of outcome.titleZhById) {
      titleZhById.set(id, titleZh);
    }
    return {
      titleZhById,
      primarySucceeded: options.primarySucceeded,
      fallbackSucceeded: outcome.titleZhById.size,
      failedIds: outcome.failedIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDigest(
      `${options.batchLabel}: fallback failed (${message}); ${options.items.length} paper(s) stay English`,
    );
    return {
      titleZhById: options.kept,
      primarySucceeded: options.primarySucceeded,
      fallbackSucceeded: 0,
      failedIds: options.items.map((item) => item.id),
    };
  }
}

function translateModels(options: {
  requested: number;
  primarySucceeded: number;
  fallbackSucceeded: number;
  failed: number;
  primaryModel: string;
  primaryObserved: string[];
  fallbackConfig: DigestLlmConfig | undefined;
  fallbackObserved: string[];
}): DigestTranslateModels {
  return {
    requested: options.requested,
    succeeded: options.primarySucceeded + options.fallbackSucceeded,
    failed: options.failed,
    model: llmModelUsage(options.primaryModel, options.primaryObserved),
    primarySucceeded: options.primarySucceeded,
    ...(options.fallbackConfig
      ? {
          fallback: {
            ...llmModelUsage(options.fallbackConfig.model, options.fallbackObserved),
            succeeded: options.fallbackSucceeded,
          },
        }
      : {}),
  };
}

async function translateBatchOnce(
  batch: ReturnType<typeof toDigestTranslateInput>[],
  config: ReturnType<typeof getDigestLlmConfig>,
  batchLabel: string,
  observedSink: string[],
): Promise<TranslateBatchOutcome> {
  const completion = await callDigestChatCompletion(
    config,
    (maxTokens, useJsonResponseFormat) =>
      buildDigestTranslateCompletionParams(batch, config, useJsonResponseFormat, maxTokens),
    {
      label: batchLabel,
      gate: "digest-translate",
      estimatedCompletionTokens: estimateTranslateCompletionTokens(batch.length),
      completionFloor: 1024,
    },
  );
  noteObservedModel(observedSink, completion);

  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
  const { content, usedReasoningFallback } = extractDigestMessageContent(completion.choices[0]?.message);
  if (usedReasoningFallback) {
    logDigest(`${batchLabel}: warning: JSON taken from reasoning_content`);
  }

  // 細節計數只進 log；persisted stats 另記 primary／fallback 成功數。
  const expectedIds = batch.map((item) => item.id);
  const parsed = parseTranslateBatchResponse(content, expectedIds);
  logDigest(
    `${batchLabel}: ${formatTranslateBatchSummary(parsed.summary)} (finish_reason=${finishReason})`,
  );

  for (const issue of parsed.issues) {
    if (issue.kind === "json_parse" || issue.kind === "schema_shape") {
      logDigest(`${batchLabel}: ${issue.kind}: ${issue.message}`);
      continue;
    }
    const idHint = issue.id ? ` id=${issue.id}` : "";
    logDigest(`${batchLabel}: ${issue.kind} at ${issue.path}${idHint}`);
  }

  // batchFailed → 外層改打 fallback；fallback 也失敗才整批維持英文。
  if (parsed.batchFailed) {
    throw new Error(
      `${batchLabel}: structured-output batch failed (${parsed.issues[0]?.kind ?? "unknown"})`,
    );
  }

  return { titleZhById: parsed.titleZhById, failedIds: parsed.failedIds };
}

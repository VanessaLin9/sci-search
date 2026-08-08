/**
 * Phase 2b：overflow（非 featured）批次翻英文標題 → `titleZh`。
 *
 * 失敗契約：單 batch 503／整批 JSON 失敗就 skip 該批（計入 failed），繼續下一批；
 * 部分 item schema invalid → partial salvage（只丟棄不安全項）（PR #31）。
 * **沒有** keyword／第二模型備援——郵件只顯示英文標題。HTTP 重試靠 `maxRetries`。
 *
 * LLM HTTP 走 `callDigestChatCompletion`（gate=`digest-translate`）；timing 見 `llmRequestTiming.ts`（PR #26）。
 * 逐項解析契約 owner：`parseTranslateBatchResponse`（PR #31）。
 */
import { callDigestChatCompletion } from "./callDigestChat.js";
import { getDigestLlmConfig } from "./config.js";
import { extractDigestMessageContent } from "./extractDigestContent.js";
import { logDigest } from "./digestLog.js";
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

/** 僅處理非 featured 且 digestLine ≠ skip 的 overflow；失敗則該批不加 titleZh。 */
export async function translateOverflowTitles(options: {
  papers: ClassifiedPaper[];
}): Promise<{
  titleZhById: Map<string, string>;
  stats: DigestTranslateStats;
}> {
  const overflow = options.papers.filter(
    (paper) => !paper.featured && paper.digestLine && paper.digestLine !== "skip",
  );
  const config = getDigestLlmConfig();
  const titleZhById = new Map<string, string>();
  if (overflow.length === 0) {
    return {
      titleZhById,
      stats: { requested: 0, llmTranslated: 0, failed: 0 },
    };
  }

  const inputs = overflow.map(toDigestTranslateInput);
  const batches = planTranslateBatches(inputs, config.maxPapersPerBatch, config.maxInputTokens);
  const batchTotal = batches.length;
  let llmTranslated = 0;
  let failed = 0;

  logDigest(`translate ${overflow.length} overflow title(s) in ${batchTotal} batch(es)`);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const batchLabel = batchTotal > 1 ? `translate ${index + 1}/${batchTotal}` : "translate 1/1";

    try {
      const outcome = await translateBatchOnce(batch, config, batchLabel);
      for (const [id, titleZh] of outcome.titleZhById) {
        titleZhById.set(id, titleZh);
        llmTranslated += 1;
      }
      failed += outcome.failedIds.length;
      if (outcome.failedIds.length > 0) {
        logDigest(
          `${batchLabel}: no translation for ${outcome.failedIds.length}: ${outcome.failedIds.join(", ")}`,
        );
      }
    } catch (error) {
      // 安靜 degrade：不 throw、不換模型，讓 daily 繼續寄。
      const message = error instanceof Error ? error.message : String(error);
      logDigest(`${batchLabel}: failed (${message}); skip ${batch.length} paper(s)`);
      failed += batch.length;
    }
  }

  logDigest(`translate done: ${llmTranslated} LLM, ${failed} without titleZh`);

  return {
    titleZhById,
    stats: {
      requested: overflow.length,
      llmTranslated,
      failed,
    },
  };
}

type TranslateBatchOutcome = {
  titleZhById: Map<string, string>;
  failedIds: string[];
};

async function translateBatchOnce(
  batch: ReturnType<typeof toDigestTranslateInput>[],
  config: ReturnType<typeof getDigestLlmConfig>,
  batchLabel: string,
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

  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
  const { content, usedReasoningFallback } = extractDigestMessageContent(completion.choices[0]?.message);
  if (usedReasoningFallback) {
    logDigest(`${batchLabel}: warning: JSON taken from reasoning_content`);
  }

  // 細節計數只進 log；persisted translate stats 仍是 requested/llmTranslated/failed（PR #31）。
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

  // batchFailed → 丟給外層 catch，整批維持英文（與 HTTP 失敗同契約）（PR #31）。
  if (parsed.batchFailed) {
    throw new Error(
      `${batchLabel}: structured-output batch failed (${parsed.issues[0]?.kind ?? "unknown"})`,
    );
  }

  return { titleZhById: parsed.titleZhById, failedIds: parsed.failedIds };
}

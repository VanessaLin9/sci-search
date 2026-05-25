import { z } from "zod";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { callDigestChatCompletion } from "./callDigestChat.js";
import { getDigestLlmConfig } from "./config.js";
import { extractDigestMessageContent } from "./extractDigestContent.js";
import { logDigest } from "./digestLog.js";
import { planTranslateBatches } from "./planTranslateBatches.js";
import {
  buildDigestTranslateCompletionParams,
  estimateTranslateCompletionTokens,
} from "./translatePrompt.js";
import { toDigestTranslateInput } from "./toTranslateInput.js";
import type { DigestTranslateStats } from "./types.js";
import type { ClassifiedPaper } from "../types.js";

const translateRowSchema = z.object({
  id: z.string(),
  title_zh: z.string().min(1),
});

const translateResponseSchema = z.object({
  results: z.array(translateRowSchema),
});

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
    (maxTokens) =>
      buildDigestTranslateCompletionParams(batch, config, config.preferJsonResponseFormat, maxTokens),
    {
      label: batchLabel,
      estimatedCompletionTokens: estimateTranslateCompletionTokens(batch.length),
      completionFloor: 1024,
    },
  );

  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
  const { content, usedReasoningFallback } = extractDigestMessageContent(completion.choices[0]?.message);
  if (usedReasoningFallback) {
    logDigest(`${batchLabel}: warning: JSON taken from reasoning_content`);
  }

  const parsed = translateResponseSchema.parse(parseJsonFromLlmContent(content));
  const itemIds = new Set(batch.map((item) => item.id));
  const titleZhById = new Map<string, string>();

  for (const row of parsed.results) {
    const id = row.id.trim();
    if (itemIds.has(id)) {
      titleZhById.set(id, row.title_zh.trim());
    }
  }

  const failedIds: string[] = [];
  for (const item of batch) {
    if (!titleZhById.has(item.id)) {
      failedIds.push(item.id);
    }
  }

  logDigest(
    `${batchLabel}: parsed ${titleZhById.size}/${batch.length} (finish_reason=${finishReason})`,
  );

  return { titleZhById, failedIds };
}

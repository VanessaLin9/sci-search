import { z } from "zod";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { callDigestChatCompletion } from "./callDigestChat.js";
import { getDigestLlmConfig } from "./config.js";
import { extractDigestMessageContent } from "./extractDigestContent.js";
import { logDigest } from "./digestLog.js";
import { runWithConcurrency } from "./runWithConcurrency.js";
import {
  buildDigestSummarizeCompletionParams,
  estimateSummarizeCompletionTokens,
} from "./summarizePrompt.js";
import { toDigestSummarizeInput } from "./toSummarizeInput.js";
import type { DigestSummarizeStats } from "./types.js";
import type { ClassifiedPaper, SourceScope } from "../types.js";

const summarizeResponseSchema = z.object({
  id: z.string(),
  title_zh: z.string().min(1),
  summary_zh: z.string().min(1),
  topic_tags: z.array(z.string()).min(1).max(8),
});

export type PaperSummarizeFields = {
  titleZh: string;
  summaryZh: string;
  topicTags: string[];
};

type SummarizeOneResult =
  | { ok: true; id: string; fields: PaperSummarizeFields }
  | { ok: false; id: string };

function summarizeLabel(index: number, total: number, paper: ClassifiedPaper, retry: boolean): string {
  const base = `summarize ${index + 1}/${total}`;
  const idHint = paper.doi ?? paper.id;
  return retry ? `${base} retry (${idHint})` : `${base} (${idHint})`;
}

async function summarizeOneFeaturedPaper(options: {
  paper: ClassifiedPaper;
  index: number;
  total: number;
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
  config: ReturnType<typeof getDigestLlmConfig>;
  retry?: boolean;
}): Promise<SummarizeOneResult> {
  const { paper, index, total, scopeBySourceId, config, retry = false } = options;
  const label = summarizeLabel(index, total, paper, retry);
  const input = toDigestSummarizeInput(paper, scopeBySourceId);

  try {
    const completion = await callDigestChatCompletion(
      config,
      (maxTokens) =>
        buildDigestSummarizeCompletionParams(input, config, config.preferJsonResponseFormat, maxTokens),
      {
        label,
        estimatedCompletionTokens: estimateSummarizeCompletionTokens(),
        completionFloor: 2048,
        timeoutMs: config.summarizeTimeoutMs,
        maxRetries: config.summarizeMaxRetries,
      },
    );

    const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
    const usage = completion.usage;
    const usageHint = usage
      ? `, tokens ${usage.completion_tokens ?? "?"} completion`
      : "";
    const { content, usedReasoningFallback } = extractDigestMessageContent(
      completion.choices[0]?.message,
    );
    if (usedReasoningFallback) {
      logDigest(`${label}: warning: JSON taken from reasoning_content`);
    }

    const parsed = summarizeResponseSchema.parse(parseJsonFromLlmContent(content));
    if (parsed.id !== paper.id) {
      throw new Error(`id mismatch (expected ${paper.id}, got ${parsed.id})`);
    }

    logDigest(`${label}: ok (${parsed.topic_tags.length} tags, finish_reason=${finishReason}${usageHint})`);
    return {
      ok: true,
      id: paper.id,
      fields: {
        titleZh: parsed.title_zh.trim(),
        summaryZh: parsed.summary_zh.trim(),
        topicTags: parsed.topic_tags.map((tag) => tag.trim()).filter(Boolean),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDigest(`${label}: failed (${message})`);
    return { ok: false, id: paper.id };
  }
}

export async function summarizeFeaturedPapers(options: {
  papers: ClassifiedPaper[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
}): Promise<{
  fieldsById: Map<string, PaperSummarizeFields>;
  stats: DigestSummarizeStats;
}> {
  const featured = options.papers.filter((paper) => paper.featured);
  const config = getDigestLlmConfig();
  const fieldsById = new Map<string, PaperSummarizeFields>();

  if (featured.length === 0) {
    return {
      fieldsById,
      stats: { requested: 0, llmSummarized: 0, failed: 0 },
    };
  }

  const concurrency = config.summarizeConcurrency;
  logDigest(
    `summarize ${featured.length} featured paper(s), concurrency ${concurrency}, timeout ${config.summarizeTimeoutMs}ms, retries ${config.summarizeMaxRetries}`,
  );

  const results = await runWithConcurrency(featured, concurrency, (paper, index) =>
    summarizeOneFeaturedPaper({
      paper,
      index,
      total: featured.length,
      scopeBySourceId: options.scopeBySourceId,
      config,
    }),
  );

  let llmSummarized = 0;
  let failed = 0;
  const failedPapers: ClassifiedPaper[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (result.ok) {
      fieldsById.set(result.id, result.fields);
      llmSummarized += 1;
    } else {
      failed += 1;
      failedPapers.push(featured[index]);
    }
  }

  if (failedPapers.length > 0) {
    logDigest(`summarize retrying ${failedPapers.length} failed paper(s) sequentially…`);
    for (const paper of failedPapers) {
      const index = featured.findIndex((item) => item.id === paper.id);
      const retryResult = await summarizeOneFeaturedPaper({
        paper,
        index: index >= 0 ? index : 0,
        total: featured.length,
        scopeBySourceId: options.scopeBySourceId,
        config,
        retry: true,
      });
      if (retryResult.ok) {
        fieldsById.set(retryResult.id, retryResult.fields);
        llmSummarized += 1;
        failed -= 1;
      }
    }
  }

  logDigest(`summarize done: ${llmSummarized} LLM, ${failed} failed`);

  return {
    fieldsById,
    stats: {
      requested: featured.length,
      llmSummarized,
      failed,
    },
  };
}

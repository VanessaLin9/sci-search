import { z } from "zod";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { planDigestTaggingBatches } from "./batchSizing.js";
import { callDigestTaggingCompletion } from "./callDigestCompletion.js";
import { extractDigestMessageContent } from "./extractDigestContent.js";
import { getDigestLlmConfig, maskApiKey } from "./config.js";
import { digestLineFromKeywords } from "./keywordDigestLine.js";
import { logDigest } from "./digestLog.js";
import { toDigestTaggingInput } from "./toTaggingInput.js";
import type { DigestTaggingInput, DigestTaggingStats } from "./types.js";
import { digestLineSchema } from "../domain/life-science/index.js";
import type { ClassifiedPaper, DigestLine, SourceScope } from "../types.js";

const taggingResultRowSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    digest_line: digestLineSchema,
  })
  .refine((row) => Boolean(row.id?.trim() || row.title?.trim()), {
    message: "each result needs id or title",
  });

const llmResponseSchema = z.object({
  results: z.array(taggingResultRowSchema),
});

export type TagTitlesWithLlmResult = {
  lineById: Map<string, DigestLine>;
  llmTaggedIds: Set<string>;
  stats: DigestTaggingStats;
};

type BatchTaggingOutcome = {
  lineById: Map<string, DigestLine>;
  llmTaggedIds: Set<string>;
  titleMatched: number;
  keywordFallbackIds: string[];
};

export async function tagTitlesWithLlm(options: {
  papers: ClassifiedPaper[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
}): Promise<TagTitlesWithLlmResult> {
  const { papers, scopeBySourceId } = options;
  const config = getDigestLlmConfig();
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));

  logDigest(`tagging endpoint ${config.baseUrl} · model ${config.model} · key ${maskApiKey(config.apiKey)}`);

  const inputs = papers.map((paper) => toDigestTaggingInput(paper, scopeBySourceId));
  const batches = planDigestTaggingBatches(inputs, {
    maxInputTokens: config.maxInputTokens,
    maxCompletionTokens: config.maxTokens,
    maxPapersPerBatch: config.maxPapersPerBatch,
  });

  const lineById = new Map<string, DigestLine>();
  const llmTaggedIds = new Set<string>();
  let llmTagged = 0;
  let fallback = 0;
  const batchTotal = batches.length;

  logDigest(`tagging ${papers.length} paper(s) in ${batchTotal} batch(es)`);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const batchLabel = batchTotal > 1 ? `batch ${index + 1}/${batchTotal}` : "batch 1/1";

    try {
      const outcome = await classifyTaggingBatch(batch, config, batchLabel);
      for (const [id, line] of outcome.lineById) {
        lineById.set(id, line);
      }
      for (const id of outcome.llmTaggedIds) {
        llmTaggedIds.add(id);
        llmTagged += 1;
      }
      for (const id of outcome.keywordFallbackIds) {
        const paper = paperById.get(id);
        if (!paper) continue;
        lineById.set(id, digestLineFromKeywords(paper));
        fallback += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDigest(`${batchLabel}: failed (${message}); keyword fallback for ${batch.length} paper(s)`);
      for (const item of batch) {
        const paper = paperById.get(item.id);
        if (!paper) continue;
        lineById.set(item.id, digestLineFromKeywords(paper));
        fallback += 1;
      }
    }
  }

  for (const paper of papers) {
    if (!lineById.has(paper.id)) {
      lineById.set(paper.id, digestLineFromKeywords(paper));
      fallback += 1;
    }
  }

  logDigest(`tagging done: ${llmTagged} LLM, ${fallback} keyword fallback`);

  return {
    lineById,
    llmTaggedIds,
    stats: {
      llmClassified: papers.length,
      llmTagged,
      fallback,
    },
  };
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveBatchTaggingResults(
  items: DigestTaggingInput[],
  rows: z.infer<typeof taggingResultRowSchema>[],
  batchLabel: string,
): BatchTaggingOutcome {
  const lineById = new Map<string, DigestLine>();
  const llmTaggedIds = new Set<string>();
  const itemIds = new Set(items.map((item) => item.id));
  let titleMatched = 0;

  for (const row of rows) {
    const id = row.id?.trim();
    if (id && itemIds.has(id)) {
      lineById.set(id, row.digest_line);
      llmTaggedIds.add(id);
    }
  }

  const titleToItemIds = new Map<string, string[]>();
  for (const item of items) {
    const key = normalizeTitle(item.title);
    const list = titleToItemIds.get(key) ?? [];
    list.push(item.id);
    titleToItemIds.set(key, list);
  }

  for (const row of rows) {
    const id = row.id?.trim();
    if (id && itemIds.has(id)) continue;

    const titleKey = row.title?.trim() ? normalizeTitle(row.title) : "";
    if (!titleKey) continue;

    const matches = titleToItemIds.get(titleKey) ?? [];
    if (matches.length !== 1) continue;

    const matchedId = matches[0];
    if (lineById.has(matchedId)) continue;

    lineById.set(matchedId, row.digest_line);
    llmTaggedIds.add(matchedId);
    titleMatched += 1;
  }

  const keywordFallbackIds: string[] = [];
  for (const item of items) {
    if (!lineById.has(item.id)) {
      keywordFallbackIds.push(item.id);
    }
  }

  if (titleMatched > 0) {
    logDigest(`${batchLabel}: matched ${titleMatched} paper(s) by title`);
  }
  if (keywordFallbackIds.length > 0) {
    logDigest(
      `${batchLabel}: keyword fallback for ${keywordFallbackIds.length} missing: ${keywordFallbackIds.join(", ")}`,
    );
  }

  const counts = { a: 0, b: 0, pre: 0, skip: 0 };
  for (const line of lineById.values()) {
    if (line === "line-a") counts.a += 1;
    else if (line === "line-b") counts.b += 1;
    else if (line === "preprint") counts.pre += 1;
    else counts.skip += 1;
  }
  logDigest(
    `${batchLabel}: parsed · line-a ${counts.a}, line-b ${counts.b}, preprint ${counts.pre}, skip ${counts.skip}`,
  );

  return { lineById, llmTaggedIds, titleMatched, keywordFallbackIds };
}

function mergeBatchOutcomes(a: BatchTaggingOutcome, b: BatchTaggingOutcome): BatchTaggingOutcome {
  const lineById = new Map(a.lineById);
  for (const [id, line] of b.lineById) {
    lineById.set(id, line);
  }
  const llmTaggedIds = new Set(a.llmTaggedIds);
  for (const id of b.llmTaggedIds) {
    llmTaggedIds.add(id);
  }
  return {
    lineById,
    llmTaggedIds,
    titleMatched: a.titleMatched + b.titleMatched,
    keywordFallbackIds: [...a.keywordFallbackIds, ...b.keywordFallbackIds],
  };
}

function shouldRetrySplitBatch(error: unknown, finishReason: string): boolean {
  if (finishReason === "length") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("no JSON object") || message.includes("reasoning only");
}

async function classifyTaggingBatch(
  items: DigestTaggingInput[],
  config: ReturnType<typeof getDigestLlmConfig>,
  batchLabel: string,
): Promise<BatchTaggingOutcome> {
  try {
    return await classifyTaggingBatchOnce(items, config, batchLabel);
  } catch (error) {
    if (items.length <= 1 || !shouldRetrySplitBatch(error, "unknown")) {
      throw error;
    }
    const mid = Math.ceil(items.length / 2);
    logDigest(`${batchLabel}: split retry ${items.length} → ${mid} + ${items.length - mid}`);
    const first = await classifyTaggingBatch(items.slice(0, mid), config, `${batchLabel}a`);
    const second = await classifyTaggingBatch(items.slice(mid), config, `${batchLabel}b`);
    return mergeBatchOutcomes(first, second);
  }
}

async function classifyTaggingBatchOnce(
  items: DigestTaggingInput[],
  config: ReturnType<typeof getDigestLlmConfig>,
  batchLabel: string,
): Promise<BatchTaggingOutcome> {
  const completion = await callDigestTaggingCompletion(items, config, { label: batchLabel });
  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";

  let content: string;
  let usedReasoningFallback: boolean;
  try {
    ({ content, usedReasoningFallback } = extractDigestMessageContent(completion.choices[0]?.message));
  } catch (extractError) {
    if (items.length > 1 && shouldRetrySplitBatch(extractError, finishReason)) {
      throw extractError;
    }
    throw extractError;
  }

  if (usedReasoningFallback) {
    logDigest(`${batchLabel}: warning: JSON taken from reasoning_content`);
  }

  let parsed;
  try {
    parsed = llmResponseSchema.parse(parseJsonFromLlmContent(content));
  } catch (parseError) {
    const preview = content.trim().slice(0, 400);
    const wrapped = new Error(
      `${batchLabel}: invalid JSON (finish_reason=${finishReason}, ${content.length} chars): ${preview}${content.length > 400 ? "…" : ""}`,
      { cause: parseError },
    );
    if (items.length > 1 && shouldRetrySplitBatch(wrapped, finishReason)) {
      throw wrapped;
    }
    throw wrapped;
  }

  return resolveBatchTaggingResults(items, parsed.results, batchLabel);
}

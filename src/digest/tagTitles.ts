import { z } from "zod";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { planDigestTaggingBatches } from "./batchSizing.js";
import {
  callDigestTaggingCompletion,
  extractDigestMessageContent,
} from "./callDigestCompletion.js";
import { getDigestLlmConfig, maskApiKey } from "./config.js";
import { digestLineFromKeywords } from "./keywordDigestLine.js";
import { logDigest } from "./digestLog.js";
import { toDigestTaggingInput } from "./toTaggingInput.js";
import type { DigestTaggingInput, DigestTaggingStats } from "./types.js";
import type { ClassifiedPaper, DigestLine, SourceScope } from "../types.js";

const digestLineSchema = z.enum(["line-a", "line-b", "preprint", "skip"]);

const llmResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      digest_line: digestLineSchema,
    }),
  ),
});

export type TagTitlesWithLlmResult = {
  lineById: Map<string, DigestLine>;
  llmTaggedIds: Set<string>;
  stats: DigestTaggingStats;
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
      const batchLines = await classifyTaggingBatch(batch, config, batchLabel);
      for (const [id, line] of batchLines) {
        lineById.set(id, line);
        llmTaggedIds.add(id);
        llmTagged += 1;
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

async function classifyTaggingBatch(
  items: DigestTaggingInput[],
  config: ReturnType<typeof getDigestLlmConfig>,
  batchLabel: string,
): Promise<Map<string, DigestLine>> {
  const completion = await callDigestTaggingCompletion(items, config, { label: batchLabel });
  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
  const { content, usedReasoningFallback } = extractDigestMessageContent(
    completion.choices[0]?.message,
  );

  if (usedReasoningFallback) {
    logDigest(`${batchLabel}: warning: used reasoning_content as message body`);
  }

  let parsed;
  try {
    parsed = llmResponseSchema.parse(parseJsonFromLlmContent(content));
  } catch (parseError) {
    const preview = content.trim().slice(0, 400);
    throw new Error(
      `${batchLabel}: invalid JSON (finish_reason=${finishReason}, ${content.length} chars): ${preview}${content.length > 400 ? "…" : ""}`,
      { cause: parseError },
    );
  }

  const lineById = new Map<string, DigestLine>();
  for (const row of parsed.results) {
    lineById.set(row.id, row.digest_line);
  }

  const missingIds = items.filter((item) => !lineById.has(item.id)).map((item) => item.id);
  if (missingIds.length > 0) {
    throw new Error(`Digest tagging missing ids: ${missingIds.join(", ")}`);
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

  return lineById;
}

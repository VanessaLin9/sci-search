/**
 * Phase 2b：以 ROUTING_LLM_MODEL 對非預印本打 spatial_confidence，再派生 A/B。
 *
 * 失敗契約：單 batch／單篇失敗 → keyword fallback（PRIMARY_KEYWORDS → A，否則 B），
 * 不中斷後續 batch；預印本不進此 classifier。
 */
import { z } from "zod";
import { loadDigestFileConfig } from "../config.js";
import { applySpatialBatchRows } from "../domain/life-science/digest/applySpatialBatchRows.js";
import type { DigestTaggingStats } from "../domain/life-science/digest/resolveDigestLines.js";
import { isPreprintSource } from "../domain/life-science/sources.js";
import { extractLlmJsonContent, shouldRetrySplitLlmBatch } from "../llm/extractLlmJsonContent.js";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { getRoutingLlmConfig, maskApiKey } from "../routing/config.js";
import { logRouting } from "../routing/routingLog.js";
import { callSpatialClassifyCompletion } from "./callSpatialCompletion.js";
import { digestLineFromKeywords } from "./keywordDigestLine.js";
import { planSpatialClassifyBatches } from "./spatialBatchSizing.js";
import type { SpatialClassifyInput } from "./spatialTypes.js";
import { toSpatialClassifyInput } from "./toSpatialInput.js";
import type { ClassifiedPaper, DigestLine } from "../types.js";

const spatialResultRowSchema = z.object({
  id: z.string(),
  spatial_confidence: z.number(),
});

const llmResponseSchema = z.object({
  results: z.array(spatialResultRowSchema),
});

type MainLine = Extract<DigestLine, "line-a" | "line-b">;

export type ClassifySpatialWithLlmResult = {
  lineById: Map<string, MainLine>;
  llmClassifiedIds: Set<string>;
  stats: DigestTaggingStats;
};

type BatchSpatialOutcome = {
  lineById: Map<string, MainLine>;
  llmClassifiedIds: Set<string>;
  keywordFallbackIds: string[];
  failures: number;
};

function mainLineFromKeywords(paper: ClassifiedPaper): MainLine {
  const line = digestLineFromKeywords(paper);
  return line === "line-a" ? "line-a" : "line-b";
}

function countLines(lineById: ReadonlyMap<string, MainLine>): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const line of lineById.values()) {
    if (line === "line-a") a += 1;
    else b += 1;
  }
  return { a, b };
}

/** 只分類非預印本；呼叫端再 `resolveDigestLines` 合併（含 preprint 硬鎖）。 */
export async function classifySpatialWithLlm(options: {
  papers: ClassifiedPaper[];
}): Promise<ClassifySpatialWithLlmResult> {
  const { papers } = options;
  const routingConfig = getRoutingLlmConfig();
  const digestFile = loadDigestFileConfig();
  const threshold = digestFile.spatialConfidenceThreshold;
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));

  const candidates = papers.filter((paper) => !isPreprintSource(paper.sourceId));

  logRouting(
    `spatial-classify endpoint ${routingConfig.baseUrl} · model ${routingConfig.model} · key ${maskApiKey(routingConfig.apiKey)} · threshold ${threshold}`,
  );

  const inputs = candidates.map(toSpatialClassifyInput);
  const batches = planSpatialClassifyBatches(inputs, {
    maxInputTokens: digestFile.maxInputTokens,
    maxCompletionTokens: routingConfig.maxTokens,
    // Abstracts are large; reuse digest batch cap rather than routing's title-only 40.
    maxPapersPerBatch: digestFile.maxPapersPerBatch,
  });

  const lineById = new Map<string, MainLine>();
  const llmClassifiedIds = new Set<string>();
  let llmTagged = 0;
  let fallback = 0;
  let failures = 0;
  let llmLineA = 0;
  let llmLineB = 0;
  let fallbackLineA = 0;
  let fallbackLineB = 0;
  const batchTotal = batches.length;

  logRouting(
    `spatial-classify ${candidates.length} non-preprint paper(s) in ${batchTotal} batch(es) (${papers.length - candidates.length} preprint skipped)`,
  );

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const batchLabel =
      batchTotal > 1 ? `spatial batch ${index + 1}/${batchTotal}` : "spatial batch 1/1";

    try {
      const outcome = await classifySpatialBatch(batch, threshold, batchLabel);
      for (const [id, line] of outcome.lineById) {
        lineById.set(id, line);
        llmClassifiedIds.add(id);
        llmTagged += 1;
        if (line === "line-a") llmLineA += 1;
        else llmLineB += 1;
      }
      failures += outcome.failures;
      for (const id of outcome.keywordFallbackIds) {
        const paper = paperById.get(id);
        if (!paper) continue;
        const line = mainLineFromKeywords(paper);
        lineById.set(id, line);
        fallback += 1;
        if (line === "line-a") fallbackLineA += 1;
        else fallbackLineB += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logRouting(`${batchLabel}: failed (${message}); keyword fallback for ${batch.length} paper(s)`);
      failures += batch.length;
      for (const item of batch) {
        const paper = paperById.get(item.id);
        if (!paper) continue;
        const line = mainLineFromKeywords(paper);
        lineById.set(item.id, line);
        fallback += 1;
        if (line === "line-a") fallbackLineA += 1;
        else fallbackLineB += 1;
      }
    }
  }

  for (const paper of candidates) {
    if (!lineById.has(paper.id)) {
      const line = mainLineFromKeywords(paper);
      lineById.set(paper.id, line);
      fallback += 1;
      failures += 1;
      if (line === "line-a") fallbackLineA += 1;
      else fallbackLineB += 1;
    }
  }

  logRouting(
    `spatial-classify done: LLM A ${llmLineA} / B ${llmLineB}, keyword fallback A ${fallbackLineA} / B ${fallbackLineB}, failures ${failures}`,
  );

  return {
    lineById,
    llmClassifiedIds,
    stats: {
      threshold,
      llmClassified: candidates.length,
      llmTagged,
      llmLineA,
      llmLineB,
      fallback,
      fallbackLineA,
      fallbackLineB,
      failures,
    },
  };
}

function resolveBatchSpatialResults(
  items: SpatialClassifyInput[],
  rows: z.infer<typeof spatialResultRowSchema>[],
  threshold: number,
  batchLabel: string,
): BatchSpatialOutcome {
  const applied = applySpatialBatchRows(
    items.map((item) => item.id),
    rows,
    threshold,
  );

  if (applied.keywordFallbackIds.length > 0) {
    logRouting(
      `${batchLabel}: keyword fallback for ${applied.keywordFallbackIds.length} missing/invalid: ${applied.keywordFallbackIds.join(", ")}`,
    );
  }

  const counts = countLines(applied.lineById);
  logRouting(`${batchLabel}: parsed · line-a ${counts.a}, line-b ${counts.b}`);

  return applied;
}

function mergeBatchOutcomes(a: BatchSpatialOutcome, b: BatchSpatialOutcome): BatchSpatialOutcome {
  const lineById = new Map(a.lineById);
  for (const [id, line] of b.lineById) {
    lineById.set(id, line);
  }
  const llmClassifiedIds = new Set(a.llmClassifiedIds);
  for (const id of b.llmClassifiedIds) {
    llmClassifiedIds.add(id);
  }
  return {
    lineById,
    llmClassifiedIds,
    keywordFallbackIds: [...a.keywordFallbackIds, ...b.keywordFallbackIds],
    failures: a.failures + b.failures,
  };
}

async function classifySpatialBatch(
  items: SpatialClassifyInput[],
  threshold: number,
  batchLabel: string,
): Promise<BatchSpatialOutcome> {
  try {
    return await classifySpatialBatchOnce(items, threshold, batchLabel);
  } catch (error) {
    if (items.length <= 1 || !shouldRetrySplitLlmBatch(error, "unknown")) {
      throw error;
    }
    const mid = Math.ceil(items.length / 2);
    logRouting(`${batchLabel}: split retry ${items.length} → ${mid} + ${items.length - mid}`);
    const first = await classifySpatialBatch(items.slice(0, mid), threshold, `${batchLabel}a`);
    const second = await classifySpatialBatch(items.slice(mid), threshold, `${batchLabel}b`);
    return mergeBatchOutcomes(first, second);
  }
}

async function classifySpatialBatchOnce(
  items: SpatialClassifyInput[],
  threshold: number,
  batchLabel: string,
): Promise<BatchSpatialOutcome> {
  const config = getRoutingLlmConfig();
  const completion = await callSpatialClassifyCompletion(items, config, { label: batchLabel });
  const finishReason = completion.choices[0]?.finish_reason ?? "unknown";

  let content: string;
  let usedReasoningFallback: boolean;
  try {
    ({ content, usedReasoningFallback } = extractLlmJsonContent(completion.choices[0]?.message));
  } catch (extractError) {
    if (items.length > 1 && shouldRetrySplitLlmBatch(extractError, finishReason)) {
      throw extractError;
    }
    throw extractError;
  }

  if (usedReasoningFallback) {
    logRouting(`${batchLabel}: warning: JSON taken from reasoning_content`);
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
    if (items.length > 1 && shouldRetrySplitLlmBatch(wrapped, finishReason)) {
      throw wrapped;
    }
    throw wrapped;
  }

  return resolveBatchSpatialResults(items, parsed.results, threshold, batchLabel);
}

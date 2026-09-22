/**
 * Phase 2b digest 編排：spatial classify → featured 選取 → summarize → overflow translate。
 *
 * 失敗契約（與 routing degrade 同精神：寧可缺繁中，也不中斷 daily）：
 * - spatial classify 整段掛掉 → keyword digestLine（PRIMARY → A，否則 B）
 * - summarize 失敗 → featured 仍寄出，缺 titleZh/summaryZh（郵件可回退英文 abstract）
 * - translate 失敗 → overflow 只留英文標題，無備援模型／關鍵字翻譯
 * - A/B 不再由第二個 digest tagging LLM 決定（PR #38）
 */
import { loadDigestFileConfig } from "../config.js";
import {
  applyKeywordDigestFallback,
  emptyDigestSelectionStats,
  emptyDigestTaggingStats,
  keywordFallbackTaggingStats,
  resolveDigestLines,
} from "../domain/life-science/digest/resolveDigestLines.js";
import {
  buildSourcePriorityById,
  selectFeatured,
} from "../domain/life-science/digest/selection.js";
import { fallbackDigestLine } from "../domain/life-science/fallbackDigestLine.js";
import { shouldSkipForDigest } from "../domain/life-science/digest/skipNonResearch.js";
import { isPreprintSource } from "../domain/life-science/sources.js";
import { classifySpatialWithLlm } from "./classifySpatial.js";
import { isDigestLlmEnabled } from "./config.js";
import { logDigest } from "./digestLog.js";
import { summarizeFeaturedPapers } from "./summarizePapers.js";
import { translateOverflowTitles } from "./translateTitles.js";
import type { DigestPhaseResult, DigestSummarizeStats, DigestTranslateStats } from "./types.js";
import type { ClassifiedPaper, Source, SourceScope } from "../types.js";
import {
  llmModelUsage,
  requestedModelFromEnv,
  type DigestLlmModelsSnapshot,
  type DigestSummarizeModels,
  type DigestTranslateModels,
  type LlmModelUsage,
} from "../llm/llmModelUsage.js";

function applySummarizeFields(
  papers: ClassifiedPaper[],
  fieldsById: Map<string, { titleZh: string; summaryZh: string; topicTags: string[] }>,
): ClassifiedPaper[] {
  return papers.map((paper) => {
    const fields = fieldsById.get(paper.id);
    if (!fields) return paper;
    return {
      ...paper,
      titleZh: fields.titleZh,
      summaryZh: fields.summaryZh,
      topicTags: fields.topicTags,
    };
  });
}

function applyOverflowTitleZh(
  papers: ClassifiedPaper[],
  titleZhById: Map<string, string>,
): ClassifiedPaper[] {
  return papers.map((paper) => {
    const titleZh = titleZhById.get(paper.id);
    if (!titleZh) return paper;
    return { ...paper, titleZh };
  });
}

const emptySummarizeStats = (): DigestSummarizeStats => ({
  requested: 0,
  llmSummarized: 0,
  primarySucceeded: 0,
  fallbackSucceeded: 0,
  failed: 0,
});

const emptyTranslateStats = (): DigestTranslateStats => ({
  requested: 0,
  llmTranslated: 0,
  failed: 0,
});

function keywordFallbackStatsForPapers(
  papers: ClassifiedPaper[],
  threshold: number,
  options?: { failures?: number },
): ReturnType<typeof keywordFallbackTaggingStats> {
  let lineA = 0;
  let lineB = 0;
  let classified = 0;
  for (const paper of papers) {
    if (isPreprintSource(paper.sourceId)) continue;
    if (shouldSkipForDigest(paper)) continue;
    classified += 1;
    const line = fallbackDigestLine(paper);
    if (line === "line-a") lineA += 1;
    else lineB += 1;
  }
  return keywordFallbackTaggingStats(classified, {
    threshold,
    lineA,
    lineB,
    failures: options?.failures ?? 0,
  });
}

/** Phase 2b 入口：LLM 關閉或失敗時仍產出可寄的 papers + stats。 */
export async function runDigestPhase(options: {
  papers: ClassifiedPaper[];
  sources: Source[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
}): Promise<DigestPhaseResult> {
  const { papers, sources, scopeBySourceId } = options;
  const { maxFeatured, overflowShowTitleZh, spatialConfidenceThreshold } = loadDigestFileConfig();
  const priorityBySourceId = buildSourcePriorityById(sources);
  const llmTagging = isDigestLlmEnabled();

  if (papers.length === 0) {
    return {
      enabled: true,
      llmTagging,
      papers: [],
      tagging: emptyDigestTaggingStats(spatialConfidenceThreshold),
      selection: emptyDigestSelectionStats(),
      summarize: emptySummarizeStats(),
      translate: emptyTranslateStats(),
    };
  }

  let tagged: ClassifiedPaper[];
  let taggingStats: DigestPhaseResult["tagging"];
  let spatialModel: DigestLlmModelsSnapshot["spatial"] = undefined;

  if (llmTagging) {
    try {
      const { lineById, llmClassifiedIds, stats, model } = await classifySpatialWithLlm({ papers });
      tagged = resolveDigestLines(papers, lineById, llmClassifiedIds);
      taggingStats = stats;
      spatialModel = { ...model, llmTagged: stats.llmTagged };
    } catch (error) {
      console.warn(
        "Spatial classifier failed entirely; using keyword fallback:",
        error instanceof Error ? error.message : error,
      );
      tagged = applyKeywordDigestFallback(papers);
      // Whole-stage throw（缺 key／model 等）：failures = 受影響的非預印本數；LLM 關閉路徑仍為 0（PR #38）。
      taggingStats = keywordFallbackStatsForPapers(papers, spatialConfidenceThreshold, {
        failures: papers.filter(
          (paper) => !isPreprintSource(paper.sourceId) && !shouldSkipForDigest(paper),
        ).length,
      });
      spatialModel = requestedUsage("ROUTING_LLM_MODEL", { llmTagged: 0 });
    }
  } else {
    logDigest("LLM digest disabled (set ENABLE_LLM_DIGEST=1); spatial classify uses keyword fallback");
    tagged = applyKeywordDigestFallback(papers);
    taggingStats = keywordFallbackStatsForPapers(papers, spatialConfidenceThreshold);
  }

  const { papers: selected, stats: selectionStats, diagnostics } = selectFeatured(tagged, {
    maxFeatured,
    priorityBySourceId,
  });

  logDigest(
    `selection: ${selectionStats.featured} featured, ${selectionStats.overflow} overflow, ${selectionStats.skip} skip (max ${maxFeatured})`,
  );
  logDigest(
    `selection pools: featured A ${selectionStats.featuredLineA} / B ${selectionStats.featuredLineB} / preprint ${selectionStats.featuredPreprint}; ` +
      `overflow A ${selectionStats.overflowLineA} / B ${selectionStats.overflowLineB} / preprint ${selectionStats.overflowPreprint}`,
  );
  logDigest(
    `selection: featured ineligible: ${diagnostics.featuredIneligibleMissingAbstract} missing abstract` +
      (selectionStats.featured < maxFeatured
        ? selectionStats.candidates < maxFeatured
          ? ` (featured underfilled: only ${selectionStats.candidates} candidates)`
          : ` (featured underfilled: only ${selectionStats.candidates - diagnostics.featuredIneligibleMissingAbstract} eligible candidates)`
        : ""),
  );

  let enriched: ClassifiedPaper[] = selected;
  let summarizeStats = emptySummarizeStats();
  let translateStats = emptyTranslateStats();
  let summarizeModels: DigestSummarizeModels | undefined;
  let translateModels: DigestTranslateModels | undefined;

  if (llmTagging) {
    try {
      const { fieldsById, stats, models } = await summarizeFeaturedPapers({
        papers: selected,
        scopeBySourceId,
      });
      enriched = applySummarizeFields(enriched, fieldsById);
      summarizeStats = stats;
      summarizeModels = models;
    } catch (error) {
      console.warn(
        "Digest summarize failed entirely:",
        error instanceof Error ? error.message : error,
      );
      const featuredCount = selected.filter((paper) => paper.featured).length;
      summarizeStats = {
        requested: featuredCount,
        llmSummarized: 0,
        primarySucceeded: 0,
        fallbackSucceeded: 0,
        failed: featuredCount,
      };
      summarizeModels = fallbackSummarizeModels(featuredCount);
    }

    if (overflowShowTitleZh) {
      try {
        const { titleZhById, stats, models } = await translateOverflowTitles({ papers: enriched });
        enriched = applyOverflowTitleZh(enriched, titleZhById);
        translateStats = stats;
        translateModels = models;
      } catch (error) {
        console.warn(
          "Digest translate failed entirely:",
          error instanceof Error ? error.message : error,
        );
        const overflowCount = enriched.filter(
          (paper) => !paper.featured && paper.digestLine && paper.digestLine !== "skip",
        ).length;
        translateStats = {
          requested: overflowCount,
          llmTranslated: 0,
          failed: overflowCount,
        };
        translateModels = fallbackTranslateModels(overflowCount);
      }
    }
  }

  return {
    enabled: true,
    llmTagging,
    papers: enriched,
    tagging: taggingStats,
    selection: selectionStats,
    summarize: summarizeStats,
    translate: translateStats,
    models: buildDigestModelsSnapshot({
      llmTagging,
      spatial: spatialModel,
      summarize: summarizeModels,
      translate: translateModels,
    }),
  };
}

function requestedUsage<T extends Record<string, unknown>>(
  envName: string,
  extra: T,
): (LlmModelUsage & T) | undefined {
  const requested = requestedModelFromEnv(envName);
  if (!requested) return undefined;
  return { ...llmModelUsage(requested), ...extra };
}

function fallbackSummarizeModels(featuredCount: number): DigestSummarizeModels | undefined {
  const primary = requestedModelFromEnv("DIGEST_LLM_MODEL");
  if (!primary) return undefined;
  const fallbackRequested = requestedModelFromEnv("DIGEST_LLM_FALLBACK_MODEL");
  return {
    requested: featuredCount,
    failed: featuredCount,
    primary: { ...llmModelUsage(primary), succeeded: 0 },
    ...(fallbackRequested
      ? { fallback: { ...llmModelUsage(fallbackRequested), succeeded: 0 } }
      : {}),
  };
}

function fallbackTranslateModels(overflowCount: number): DigestTranslateModels | undefined {
  const requested = requestedModelFromEnv("DIGEST_LLM_MODEL");
  if (!requested) return undefined;
  return {
    requested: overflowCount,
    succeeded: 0,
    failed: overflowCount,
    model: llmModelUsage(requested),
  };
}

function buildDigestModelsSnapshot(input: {
  llmTagging: boolean;
  spatial?: DigestLlmModelsSnapshot["spatial"];
  summarize?: DigestSummarizeModels;
  translate?: DigestTranslateModels;
}): DigestLlmModelsSnapshot | undefined {
  if (!input.llmTagging) return undefined;
  const snapshot: DigestLlmModelsSnapshot = {};
  if (input.spatial) snapshot.spatial = input.spatial;
  if (input.summarize) snapshot.summarize = input.summarize;
  if (input.translate) snapshot.translate = input.translate;
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

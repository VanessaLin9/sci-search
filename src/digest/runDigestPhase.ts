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
import { isDigestLlmEnabled } from "./config.js";
import { logDigest } from "./digestLog.js";
import { summarizeFeaturedPapers } from "./summarizePapers.js";
import { tagTitlesWithLlm } from "./tagTitles.js";
import { translateOverflowTitles } from "./translateTitles.js";
import type { DigestPhaseResult, DigestSummarizeStats, DigestTranslateStats } from "./types.js";
import type { ClassifiedPaper, Source, SourceScope } from "../types.js";

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
  failed: 0,
});

const emptyTranslateStats = (): DigestTranslateStats => ({
  requested: 0,
  llmTranslated: 0,
  failed: 0,
});

export async function runDigestPhase(options: {
  papers: ClassifiedPaper[];
  sources: Source[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
}): Promise<DigestPhaseResult> {
  const { papers, sources, scopeBySourceId } = options;
  const { maxFeatured, overflowShowTitleZh } = loadDigestFileConfig();
  const priorityBySourceId = buildSourcePriorityById(sources);
  const llmTagging = isDigestLlmEnabled();

  if (papers.length === 0) {
    return {
      enabled: true,
      llmTagging,
      papers: [],
      tagging: emptyDigestTaggingStats(),
      selection: emptyDigestSelectionStats(),
      summarize: emptySummarizeStats(),
      translate: emptyTranslateStats(),
    };
  }

  let tagged: ClassifiedPaper[];
  let taggingStats: DigestPhaseResult["tagging"];

  if (llmTagging) {
    try {
      const { lineById, llmTaggedIds, stats } = await tagTitlesWithLlm({ papers, scopeBySourceId });
      tagged = resolveDigestLines(papers, lineById, llmTaggedIds);
      taggingStats = stats;
    } catch (error) {
      console.warn(
        "Digest LLM tagging failed entirely; using keyword fallback:",
        error instanceof Error ? error.message : error,
      );
      tagged = applyKeywordDigestFallback(papers);
      taggingStats = keywordFallbackTaggingStats(papers.length);
    }
  } else {
    logDigest("LLM tagging disabled (set ENABLE_LLM_DIGEST=1); using keyword fallback");
    tagged = applyKeywordDigestFallback(papers);
    taggingStats = keywordFallbackTaggingStats(papers.length);
  }

  const { papers: selected, stats: selectionStats } = selectFeatured(tagged, {
    maxFeatured,
    priorityBySourceId,
  });

  logDigest(
    `selection: ${selectionStats.featured} featured, ${selectionStats.overflow} overflow, ${selectionStats.skip} skip (max ${maxFeatured})`,
  );

  let enriched = selected;
  let summarizeStats = emptySummarizeStats();
  let translateStats = emptyTranslateStats();

  if (llmTagging) {
    try {
      const { fieldsById, stats } = await summarizeFeaturedPapers({
        papers: selected,
        scopeBySourceId,
      });
      enriched = applySummarizeFields(enriched, fieldsById);
      summarizeStats = stats;
    } catch (error) {
      console.warn(
        "Digest summarize failed entirely:",
        error instanceof Error ? error.message : error,
      );
      summarizeStats = {
        requested: selected.filter((paper) => paper.featured).length,
        llmSummarized: 0,
        failed: selected.filter((paper) => paper.featured).length,
      };
    }

    if (overflowShowTitleZh) {
      try {
        const { titleZhById, stats } = await translateOverflowTitles({ papers: enriched });
        enriched = applyOverflowTitleZh(enriched, titleZhById);
        translateStats = stats;
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
  };
}

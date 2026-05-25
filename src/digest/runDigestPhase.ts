import { digestLineFromKeywords } from "./keywordDigestLine.js";
import { isDigestLlmEnabled } from "./config.js";
import { logDigest } from "./digestLog.js";
import { selectFeaturedPapers, buildSourcePriorityById } from "./selectFeatured.js";
import { tagTitlesWithLlm } from "./tagTitles.js";
import type { DigestPhaseResult } from "./types.js";
import type { ClassifiedPaper, DigestLine, DigestTaggingMethod, Source, SourceScope } from "../types.js";
import { loadDigestFileConfig } from "../config.js";

function applyDigestLines(
  papers: ClassifiedPaper[],
  lineById: Map<string, DigestLine>,
  llmTaggedIds: Set<string>,
): ClassifiedPaper[] {
  return papers.map((paper) => ({
    ...paper,
    digestLine: lineById.get(paper.id) ?? digestLineFromKeywords(paper),
    digestTaggingMethod: (llmTaggedIds.has(paper.id) ? "llm" : "keyword-fallback") satisfies DigestTaggingMethod,
  }));
}

function tagWithKeywordFallback(papers: ClassifiedPaper[]): ClassifiedPaper[] {
  return papers.map((paper) => ({
    ...paper,
    digestLine: digestLineFromKeywords(paper),
    digestTaggingMethod: "keyword-fallback" as const,
  }));
}

export async function runDigestPhase(options: {
  papers: ClassifiedPaper[];
  sources: Source[];
  scopeBySourceId: ReadonlyMap<string, SourceScope>;
}): Promise<DigestPhaseResult> {
  const { papers, sources, scopeBySourceId } = options;
  const { maxFeatured } = loadDigestFileConfig();
  const priorityBySourceId = buildSourcePriorityById(sources);
  const llmTagging = isDigestLlmEnabled();

  if (papers.length === 0) {
    return {
      enabled: true,
      llmTagging,
      papers: [],
      tagging: { llmClassified: 0, llmTagged: 0, fallback: 0 },
      selection: {
        total: 0,
        candidates: 0,
        featured: 0,
        overflow: 0,
        lineA: 0,
        lineB: 0,
        preprint: 0,
        skip: 0,
      },
    };
  }

  let tagged: ClassifiedPaper[];
  let taggingStats: DigestPhaseResult["tagging"];

  if (llmTagging) {
    try {
      const { lineById, llmTaggedIds, stats } = await tagTitlesWithLlm({ papers, scopeBySourceId });
      tagged = applyDigestLines(papers, lineById, llmTaggedIds);
      taggingStats = stats;
    } catch (error) {
      console.warn(
        "Digest LLM tagging failed entirely; using keyword fallback:",
        error instanceof Error ? error.message : error,
      );
      tagged = tagWithKeywordFallback(papers);
      taggingStats = {
        llmClassified: 0,
        llmTagged: 0,
        fallback: papers.length,
      };
    }
  } else {
    logDigest("LLM tagging disabled (set ENABLE_LLM_DIGEST=1); using keyword fallback");
    tagged = tagWithKeywordFallback(papers);
    taggingStats = {
      llmClassified: 0,
      llmTagged: 0,
      fallback: papers.length,
    };
  }

  const { papers: selected, stats: selectionStats } = selectFeaturedPapers(tagged, {
    maxFeatured,
    priorityBySourceId,
  });

  logDigest(
    `selection: ${selectionStats.featured} featured, ${selectionStats.overflow} overflow, ${selectionStats.skip} skip (max ${maxFeatured})`,
  );

  return {
    enabled: true,
    llmTagging,
    papers: selected,
    tagging: taggingStats,
    selection: selectionStats,
  };
}

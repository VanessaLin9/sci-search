import type { ClassifiedPaper, DigestLine, Source } from "../types.js";
import type { DigestSelectionStats } from "./types.js";

const LINE_RANK: Record<DigestLine, number> = {
  "line-a": 0,
  "line-b": 1,
  preprint: 2,
  skip: 99,
};

export function buildSourcePriorityById(sources: Source[]): ReadonlyMap<string, number> {
  return new Map(sources.map((source) => [source.id, source.priority]));
}

/** Same ordering as featured selection (line → source priority → title). */
export function sortPapersByDigestRank(
  papers: ClassifiedPaper[],
  priorityBySourceId: ReadonlyMap<string, number>,
): ClassifiedPaper[] {
  return [...papers].sort((a, b) => compareForFeatured(a, b, priorityBySourceId));
}

function compareForFeatured(
  a: ClassifiedPaper,
  b: ClassifiedPaper,
  priorityBySourceId: ReadonlyMap<string, number>,
): number {
  const lineA = a.digestLine ?? "skip";
  const lineB = b.digestLine ?? "skip";
  const lineDiff = LINE_RANK[lineA] - LINE_RANK[lineB];
  if (lineDiff !== 0) return lineDiff;

  const priorityA = priorityBySourceId.get(a.sourceId) ?? 999;
  const priorityB = priorityBySourceId.get(b.sourceId) ?? 999;
  if (priorityA !== priorityB) return priorityA - priorityB;

  return a.title.localeCompare(b.title);
}

export function selectFeaturedPapers(
  papers: ClassifiedPaper[],
  options: {
    maxFeatured: number;
    priorityBySourceId: ReadonlyMap<string, number>;
  },
): { papers: ClassifiedPaper[]; stats: DigestSelectionStats } {
  const candidates = papers.filter((paper) => paper.digestLine && paper.digestLine !== "skip");
  const sorted = [...candidates].sort((a, b) =>
    compareForFeatured(a, b, options.priorityBySourceId),
  );
  const featuredIds = new Set(sorted.slice(0, options.maxFeatured).map((paper) => paper.id));

  const lineCounts = { lineA: 0, lineB: 0, preprint: 0, skip: 0 };
  for (const paper of papers) {
    const line = paper.digestLine ?? "skip";
    if (line === "line-a") lineCounts.lineA += 1;
    else if (line === "line-b") lineCounts.lineB += 1;
    else if (line === "preprint") lineCounts.preprint += 1;
    else lineCounts.skip += 1;
  }

  const updated = papers.map((paper) => ({
    ...paper,
    featured: featuredIds.has(paper.id),
  }));

  return {
    papers: updated,
    stats: {
      total: papers.length,
      candidates: candidates.length,
      featured: featuredIds.size,
      overflow: Math.max(0, candidates.length - featuredIds.size),
      ...lineCounts,
    },
  };
}

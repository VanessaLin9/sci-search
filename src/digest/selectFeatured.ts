import {
  buildSourcePriorityById,
  compareForFeatured,
  DIGEST_LINE_RANK,
  selectFeatured,
  sortPapersByDigestRank,
  type DigestSelectionStats,
} from "../domain/life-science/digest/selection.js";
import type { ClassifiedPaper, Source } from "../types.js";

export {
  buildSourcePriorityById,
  compareForFeatured,
  DIGEST_LINE_RANK as LINE_RANK,
  sortPapersByDigestRank,
  type DigestSelectionStats,
};

/** @deprecated Use selectFeatured from domain policy. */
export function selectFeaturedPapers(
  papers: ClassifiedPaper[],
  options: {
    maxFeatured: number;
    priorityBySourceId: ReadonlyMap<string, number>;
  },
): { papers: ClassifiedPaper[]; stats: DigestSelectionStats } {
  return selectFeatured(papers, options);
}

export { selectFeatured };

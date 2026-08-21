import type { ClassifiedPaper } from "../types.js";
import type { SpatialClassifyInput } from "./spatialTypes.js";

const MAX_ABSTRACT_CHARS = 2_000;

/** 空間分類 payload：只有 title/abstract/journal；刻意不含 source_id，避免預印本身份滲進空間判斷（PR #38）。 */
export function toSpatialClassifyInput(paper: ClassifiedPaper): SpatialClassifyInput {
  const abstract = paper.abstract?.trim();
  return {
    id: paper.id,
    title: paper.title,
    journal: paper.journal,
    abstract:
      abstract && abstract.length > MAX_ABSTRACT_CHARS
        ? `${abstract.slice(0, MAX_ABSTRACT_CHARS)}…`
        : abstract,
  };
}

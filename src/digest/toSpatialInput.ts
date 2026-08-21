import type { ClassifiedPaper } from "../types.js";
import type { SpatialClassifyInput } from "./spatialTypes.js";

const MAX_ABSTRACT_CHARS = 2_000;

/** Non-preprint spatial classifier payload: title + abstract + journal only（無 source_id）。 */
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

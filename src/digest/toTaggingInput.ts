import type { ClassifiedPaper, SourceScope } from "../types.js";
import type { DigestTaggingInput } from "./types.js";

const MAX_ABSTRACT_CHARS = 2_000;

export function toDigestTaggingInput(
  paper: ClassifiedPaper,
  scopeBySourceId: ReadonlyMap<string, SourceScope>,
): DigestTaggingInput {
  const scope = scopeBySourceId.get(paper.sourceId) ?? "life-science-only";
  const abstract = paper.abstract?.trim();
  return {
    id: paper.id,
    title: paper.title,
    journal: paper.journal,
    source_id: paper.sourceId,
    scope,
    abstract:
      abstract && abstract.length > MAX_ABSTRACT_CHARS
        ? `${abstract.slice(0, MAX_ABSTRACT_CHARS)}…`
        : abstract,
  };
}

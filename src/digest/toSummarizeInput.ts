import type { ClassifiedPaper, SourceScope } from "../types.js";
import type { DigestSummarizeInput } from "./types.js";

const MAX_ABSTRACT_CHARS = 2_000;

export function toDigestSummarizeInput(
  paper: ClassifiedPaper,
  scopeBySourceId: ReadonlyMap<string, SourceScope>,
): DigestSummarizeInput {
  const scope = scopeBySourceId.get(paper.sourceId) ?? "life-science-only";
  const abstract = paper.abstract?.trim();
  return {
    id: paper.id,
    title: paper.title,
    journal: paper.journal,
    source_id: paper.sourceId,
    scope,
    digest_line: paper.digestLine ?? "line-b",
    abstract:
      abstract && abstract.length > MAX_ABSTRACT_CHARS
        ? `${abstract.slice(0, MAX_ABSTRACT_CHARS)}…`
        : abstract,
  };
}

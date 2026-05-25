import type { ClassifiedPaper, DigestLine } from "../types.js";

/** Keyword/section fallback when digest LLM is off or missing a verdict. */
export function digestLineFromKeywords(paper: ClassifiedPaper): DigestLine {
  if (paper.sourceId === "biorxiv") {
    return "preprint";
  }
  if (paper.section === "single-cell-spatial") {
    return "line-a";
  }
  return "line-b";
}

import type { DigestLine, PaperSection } from "./types.js";

export type DigestLineFallbackInput = {
  sourceId: string;
  section: PaperSection;
};

/** Keyword/section fallback when digest LLM is off or missing a verdict. */
export function fallbackDigestLine(paper: DigestLineFallbackInput): DigestLine {
  if (paper.sourceId === "biorxiv") {
    return "preprint";
  }
  if (paper.section === "single-cell-spatial") {
    return "line-a";
  }
  return "line-b";
}

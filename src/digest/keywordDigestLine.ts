import { fallbackDigestLine } from "../domain/life-science/fallbackDigestLine.js";
import type { ClassifiedPaper, DigestLine } from "../types.js";

/** Keyword/section fallback when digest LLM is off or missing a verdict. */
export function digestLineFromKeywords(paper: ClassifiedPaper): DigestLine {
  return fallbackDigestLine(paper);
}

export { fallbackDigestLine };

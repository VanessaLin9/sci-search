import { fallbackDigestLine } from "../fallbackDigestLine.js";
import type { DigestLine, DigestTaggingMethod } from "../types.js";

type DigestTaggedPaper = {
  id: string;
  sourceId: string;
  section: import("../types.js").PaperSection;
  digestLine?: DigestLine;
  digestTaggingMethod?: DigestTaggingMethod;
};

/** Merge LLM digest lines with keyword fallback (INV-030). */
export function resolveDigestLines<P extends DigestTaggedPaper>(
  papers: P[],
  lineById: ReadonlyMap<string, DigestLine>,
  llmTaggedIds: ReadonlySet<string>,
): Array<P & { digestLine: DigestLine; digestTaggingMethod: DigestTaggingMethod }> {
  return papers.map((paper) => ({
    ...paper,
    digestLine: lineById.get(paper.id) ?? fallbackDigestLine(paper),
    digestTaggingMethod: llmTaggedIds.has(paper.id) ? "llm" : "keyword-fallback",
  }));
}

export function applyKeywordDigestFallback<P extends DigestTaggedPaper>(
  papers: P[],
): Array<P & { digestLine: DigestLine; digestTaggingMethod: "keyword-fallback" }> {
  return papers.map((paper) => ({
    ...paper,
    digestLine: fallbackDigestLine(paper),
    digestTaggingMethod: "keyword-fallback" as const,
  }));
}

export type DigestTaggingStats = {
  llmClassified: number;
  llmTagged: number;
  fallback: number;
};

export const emptyDigestTaggingStats = (): DigestTaggingStats => ({
  llmClassified: 0,
  llmTagged: 0,
  fallback: 0,
});

export const keywordFallbackTaggingStats = (paperCount: number): DigestTaggingStats => ({
  llmClassified: 0,
  llmTagged: 0,
  fallback: paperCount,
});

export const emptyDigestSelectionStats = (): import("./selection.js").DigestSelectionStats => ({
  total: 0,
  candidates: 0,
  featured: 0,
  overflow: 0,
  lineA: 0,
  lineB: 0,
  preprint: 0,
  skip: 0,
});

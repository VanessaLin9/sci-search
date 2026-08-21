import { fallbackDigestLine } from "../fallbackDigestLine.js";
import { isPreprintSource } from "../sources.js";
import type { DigestLine, DigestTaggingMethod } from "../types.js";

type DigestTaggedPaper = {
  id: string;
  sourceId: string;
  section: import("../types.js").PaperSection;
  digestLine?: DigestLine;
  digestTaggingMethod?: DigestTaggingMethod;
};

/**
 * 由空間分類結果派生 digestLine（不再接受第二個 LLM 的 line-a/line-b 標籤）（PR #38）。
 * 預印本來源硬鎖 `preprint`（PR #10）；非預印本只用 classification map 的 A/B。
 */
export function resolveDigestLines<P extends DigestTaggedPaper>(
  papers: P[],
  lineById: ReadonlyMap<string, Extract<DigestLine, "line-a" | "line-b">>,
  llmClassifiedIds: ReadonlySet<string>,
): Array<P & { digestLine: DigestLine; digestTaggingMethod: DigestTaggingMethod }> {
  return papers.map((paper) => {
    if (isPreprintSource(paper.sourceId)) {
      return {
        ...paper,
        digestLine: "preprint" as const,
        digestTaggingMethod: "keyword-fallback" as const,
      };
    }

    const digestLine = lineById.get(paper.id) ?? fallbackDigestLine(paper);
    const normalizedLine: Extract<DigestLine, "line-a" | "line-b"> =
      digestLine === "line-a" ? "line-a" : "line-b";
    return {
      ...paper,
      digestLine: normalizedLine,
      digestTaggingMethod: llmClassifiedIds.has(paper.id) ? "llm" : "keyword-fallback",
    };
  });
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

/** Spatial classifier 觀測欄位；仍寫進 `digest.tagging` 以維持舊 papers.json schema 相容（PR #38）。 */
export type DigestTaggingStats = {
  threshold: number;
  llmClassified: number;
  llmTagged: number;
  llmLineA: number;
  llmLineB: number;
  fallback: number;
  fallbackLineA: number;
  fallbackLineB: number;
  failures: number;
};

export const emptyDigestTaggingStats = (threshold = 0): DigestTaggingStats => ({
  threshold,
  llmClassified: 0,
  llmTagged: 0,
  llmLineA: 0,
  llmLineB: 0,
  fallback: 0,
  fallbackLineA: 0,
  fallbackLineB: 0,
  failures: 0,
});

export const keywordFallbackTaggingStats = (
  paperCount: number,
  options?: {
    threshold?: number;
    lineA?: number;
    lineB?: number;
  },
): DigestTaggingStats => ({
  threshold: options?.threshold ?? 0,
  llmClassified: 0,
  llmTagged: 0,
  llmLineA: 0,
  llmLineB: 0,
  fallback: paperCount,
  fallbackLineA: options?.lineA ?? 0,
  fallbackLineB: options?.lineB ?? 0,
  failures: 0,
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
  featuredLineA: 0,
  featuredLineB: 0,
  featuredPreprint: 0,
  overflowLineA: 0,
  overflowLineB: 0,
  overflowPreprint: 0,
});

import type { LifeScienceKeywordsConfig } from "./keywords.js";
import type { PaperSection } from "./types.js";

export function matchKeywords(text: string, keywords: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

/** Priority: primary keyword hits → single-cell-spatial; else biology → biology; else other. */
export function classifySection(primaryMatches: string[], biologyMatches: string[]): PaperSection {
  if (primaryMatches.length > 0) return "single-cell-spatial";
  if (biologyMatches.length > 0) return "biology";
  return "other";
}

export type KeywordClassifiedFields = {
  matchedKeywords: string[];
  section: PaperSection;
};

export function classifyPaperKeywords<P extends { title: string; abstract?: string }>(
  paper: P,
  keywords: LifeScienceKeywordsConfig,
): P & KeywordClassifiedFields {
  const searchableText = [paper.title, paper.abstract].filter(Boolean).join(" ");
  const primaryMatches = matchKeywords(searchableText, keywords.primary);
  const biologyMatches = matchKeywords(searchableText, keywords.biology);

  return {
    ...paper,
    matchedKeywords: [...primaryMatches, ...biologyMatches],
    section: classifySection(primaryMatches, biologyMatches),
  };
}

export function classifyPapersWithKeywords<P extends { title: string; abstract?: string }>(
  papers: P[],
  keywords: LifeScienceKeywordsConfig,
): Array<P & KeywordClassifiedFields> {
  return papers.map((paper) => classifyPaperKeywords(paper, keywords));
}

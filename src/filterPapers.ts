import { PAPER_SECTIONS, classifySection, matchKeywords } from "./domain/life-science/index.js";
import type { ClassifiedPaper, Paper, PaperSection } from "./types.js";
import { formatInTimeZone } from "date-fns-tz";
import { TIME_ZONE } from "./date.js";

const SECTIONS: PaperSection[] = [...PAPER_SECTIONS];

export { matchKeywords, classifySection as classifyPaperSection };

export function dedupePapers(papers: Paper[]): Paper[] {
  const seen = new Set<string>();
  const result: Paper[] = [];

  for (const paper of papers) {
    if (seen.has(paper.id)) continue;
    seen.add(paper.id);
    result.push(paper);
  }

  return result;
}

export function isPaperOnReportDate(paper: Paper, reportDate: string): boolean {
  return formatInTimeZone(paper.publishedDate, TIME_ZONE, "yyyy-MM-dd") === reportDate;
}

export function filterPapersByDate(papers: Paper[], targetDate: string): Paper[] {
  return papers.filter((paper) => isPaperOnReportDate(paper, targetDate));
}

export function countPapersBySection(papers: ClassifiedPaper[]): Record<PaperSection, number> {
  const counts: Record<PaperSection, number> = {
    "single-cell-spatial": 0,
    biology: 0,
    other: 0,
  };

  for (const paper of papers) {
    counts[paper.section] += 1;
  }

  return counts;
}

export function getPaperSections(): PaperSection[] {
  return SECTIONS;
}

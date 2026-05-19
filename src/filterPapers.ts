import type { Paper } from "./types.js";
import { formatInTimeZone } from "date-fns-tz";

const TIME_ZONE = "Asia/Taipei";

export function matchKeywords(text: string, keywords: string[]): string[] {
  const haystack = text.toLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

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

export function filterPapersByDate(papers: Paper[], targetDate: string): Paper[] {
  return papers.filter((paper) => formatInTimeZone(paper.publishedDate, TIME_ZONE, "yyyy-MM-dd") === targetDate);
}

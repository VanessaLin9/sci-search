import type { Paper } from "../types.js";

/** bioRxiv subject label from normalize (`record.category` → `articleType`). */
export function biorxivPaperCategory(paper: Paper): string {
  return paper.articleType?.trim() || "unknown";
}

export function countPapersByCategory(papers: readonly Paper[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const paper of papers) {
    const category = biorxivPaperCategory(paper);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

export function formatCategoryCounts(counts: ReadonlyMap<string, number>): string {
  if (counts.size === 0) return "none";
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, count]) => `${category}=${count}`)
    .join(", ");
}

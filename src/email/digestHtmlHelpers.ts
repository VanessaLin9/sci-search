import { sortPapersByDigestRank } from "../digest/selectFeatured.js";
import type { ClassifiedPaper } from "../types.js";
import { escapeHtml } from "./escapeHtml.js";

export function sortPapersForDisplay(
  papers: ClassifiedPaper[],
  priorityBySourceId?: ReadonlyMap<string, number>,
): ClassifiedPaper[] {
  if (priorityBySourceId) {
    return sortPapersByDigestRank(papers, priorityBySourceId);
  }
  return [...papers].sort((a, b) => a.title.localeCompare(b.title));
}

export function paperDoi(paper: ClassifiedPaper): string | undefined {
  const doi = paper.doi?.trim();
  if (doi) return doi;
  const id = paper.id.trim();
  if (id.includes("/")) return id;
  return undefined;
}

export function renderJournalDoiLine(paper: ClassifiedPaper): string {
  const journal = escapeHtml(paper.journal);
  const doi = paperDoi(paper);
  if (!doi) {
    return `<p style="margin:0 0 10px;font-size:12px;color:#888;">${journal}</p>`;
  }
  const doiUrl = `https://doi.org/${encodeURIComponent(doi)}`;
  return `<p style="margin:0 0 10px;font-size:12px;color:#888;">${journal} · <a href="${escapeHtml(doiUrl)}" style="color:#888;text-decoration:none;" target="_blank" rel="noopener noreferrer">${escapeHtml(doi)}</a></p>`;
}

export function renderTopicTags(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  const chips = tags
    .map(
      (tag) =>
        `<span style="display:inline-block;font-size:11px;padding:1px 7px;margin:0 4px 4px 0;border-radius:8px;background:#f0efe8;color:#555;border:1px solid #e2e2dc;">${escapeHtml(tag)}</span>`,
    )
    .join("");
  return `<div style="margin:4px 0 8px 0;">${chips}</div>`;
}

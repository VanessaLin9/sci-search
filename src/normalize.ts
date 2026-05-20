import type { Item } from "rss-parser";
import type { Paper, Source } from "./types.js";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildPaperId(paper: Pick<Paper, "doi" | "url" | "title">): string {
  if (paper.doi) return paper.doi.toLowerCase();
  if (paper.url) return paper.url;
  return normalizeWhitespace(paper.title).toLowerCase();
}

export function normalizeRssItemToPaper(item: Item, source: Source): Paper | null {
  const title = item.title ? normalizeWhitespace(item.title) : "";
  const url = item.link?.trim() ?? "";
  const publishedDate = item.isoDate ?? item.pubDate ?? "";

  if (!title || !url || !publishedDate) {
    return null;
  }

  const paper: Paper = {
    id: buildPaperId({
      title,
      url,
      doi: item.guid,
    }),
    title,
    journal: source.name,
    publishedDate,
    url,
    doi: item.guid,
    abstract: item.contentSnippet ?? item.summary,
    sourceId: source.id,
    matchedKeywords: [],
    section: "other",
  };

  return paper;
}

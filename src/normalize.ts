import type { Item } from "rss-parser";
import { extractDoi } from "./doi.js";
import { extractRssAbstract, shouldSkipRssItem } from "./normalizers/rss/index.js";
import { normalizeWhitespace, stripInlineHtml } from "./normalizers/shared.js";
import type { Paper, Source } from "./types.js";

type RssItemWithCustomFields = Item & {
  dcIdentifier?: string;
  source?: string;
};

export { extractDoi, normalizeWhitespace, stripInlineHtml };

function normalizeRssTitle(raw: string): string {
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return stripInlineHtml(raw);
  }
  return normalizeWhitespace(raw);
}

export function buildPaperId(paper: Pick<Paper, "doi" | "url" | "title">): string {
  if (paper.doi) return paper.doi.toLowerCase();
  if (paper.url) return paper.url;
  return normalizeWhitespace(paper.title).toLowerCase();
}

export function normalizeRssItemToPaper(item: RssItemWithCustomFields, source: Source): Paper | null {
  const title = item.title ? normalizeRssTitle(item.title) : "";
  const url = item.link?.trim() ?? "";
  const publishedDate = item.isoDate ?? item.pubDate ?? "";
  if (shouldSkipRssItem(source.id, item)) {
    return null;
  }

  const doi =
    extractDoi(item.guid) ??
    extractDoi(item.dcIdentifier) ??
    extractDoi(item.source) ??
    extractDoi(item.link);

  if (!title || !url || !publishedDate) {
    return null;
  }

  const paper: Paper = {
    id: buildPaperId({
      title,
      url,
      doi,
    }),
    title,
    journal: source.name,
    publishedDate,
    url,
    doi,
    abstract: extractRssAbstract(source.id, item),
    sourceId: source.id,
  };

  return paper;
}

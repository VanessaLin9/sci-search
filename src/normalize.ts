import type { Item } from "rss-parser";
import { extractRssAbstract } from "./normalizers/rss/index.js";
import { normalizeWhitespace } from "./normalizers/shared.js";
import type { Paper, Source } from "./types.js";

type RssItemWithCustomFields = Item & {
  source?: string;
};

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;

export { normalizeWhitespace };

export function buildPaperId(paper: Pick<Paper, "doi" | "url" | "title">): string {
  if (paper.doi) return paper.doi.toLowerCase();
  if (paper.url) return paper.url;
  return normalizeWhitespace(paper.title).toLowerCase();
}

export function extractDoi(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.match(DOI_PATTERN)?.[0];
}

export function normalizeRssItemToPaper(item: RssItemWithCustomFields, source: Source): Paper | null {
  const title = item.title ? normalizeWhitespace(item.title) : "";
  const url = item.link?.trim() ?? "";
  const publishedDate = item.isoDate ?? item.pubDate ?? "";
  const doi = extractDoi(item.guid) ?? extractDoi(item.source);

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
    matchedKeywords: [],
    section: "other",
  };

  return paper;
}

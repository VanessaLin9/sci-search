import { buildPaperId } from "../normalize.js";
import { matchKeywords, type LifeScienceKeywordsConfig } from "../domain/life-science/index.js";
import { normalizeWhitespace } from "./shared.js";
import type { Paper, Source } from "../types.js";

export type BiorxivRecord = {
  title?: string;
  authors?: string;
  doi?: string;
  date?: string;
  version?: string;
  abstract?: string;
  category?: string;
  type?: string;
};

export function parseBiorxivAuthors(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const authors = raw
    .split(";")
    .map((author) => normalizeWhitespace(author))
    .filter(Boolean);
  return authors.length > 0 ? authors : undefined;
}

export function buildBiorxivPaperUrl(doi: string, version: string | undefined): string {
  const trimmedDoi = doi.trim();
  const versionSuffix = version?.trim() ? `v${version.trim()}` : "";
  return `https://www.biorxiv.org/content/${trimmedDoi}${versionSuffix}`;
}

export function normalizeBiorxivRecordToPaper(
  record: BiorxivRecord,
  source: Source,
): Paper | null {
  const title = record.title ? normalizeWhitespace(record.title) : "";
  const doi = record.doi?.trim() ?? "";
  const publishedDate = record.date?.trim() ?? "";
  if (!title || !doi || !publishedDate) {
    return null;
  }

  const url = buildBiorxivPaperUrl(doi, record.version);
  const abstract = record.abstract?.trim() ? normalizeWhitespace(record.abstract) : undefined;

  return {
    id: buildPaperId({ title, url, doi }),
    title,
    journal: source.name,
    publishedDate,
    url,
    doi,
    abstract,
    authors: parseBiorxivAuthors(record.authors),
    articleType: record.category?.trim() || record.type?.trim() || undefined,
    sourceId: source.id,
  };
}

/** Keep bioRxiv preprints whose title/abstract hit primary (single-cell/spatial) keywords. */
export function paperMatchesPrimaryKeywords(
  paper: Pick<Paper, "title" | "abstract">,
  keywords: LifeScienceKeywordsConfig,
): boolean {
  const searchableText = [paper.title, paper.abstract].filter(Boolean).join(" ");
  return matchKeywords(searchableText, keywords.primary).length > 0;
}

export function filterBiorxivPapersByPrimaryKeywords(
  papers: Paper[],
  keywords: LifeScienceKeywordsConfig,
): Paper[] {
  return papers.filter((paper) => paperMatchesPrimaryKeywords(paper, keywords));
}

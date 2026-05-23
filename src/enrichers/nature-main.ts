import { fetchHtml } from "../fetchHtml.js";
import { isNatureRssTeaserAbstract } from "../normalizers/rss/nature-encoded.js";
import type { Paper } from "../types.js";
import { extractNatureDcType } from "./htmlMeta.js";
import { extractNatureMethodsAbstractFromHtml } from "./nature-methods.js";

/** dc.type values we drop from the Nature main-journal feed. */
const EXCLUDED_DC_TYPES = new Set(
  [
    "Book Review",
    "Nature Podcast",
    "Nature Careers Podcast",
    "Futures",
    "Editorial",
    "Comment",
    "World View",
    "Career Column",
    "Books & Arts",
    "Outlook",
    "News & Views",
    "News Feature",
    "Publisher Correction",
    "Author Correction",
    "Corrigendum",
    "Erratum",
  ].map((value) => value.toLowerCase()),
);

export function isNatureMainIncludedType(dcType: string | undefined): boolean {
  const normalized = dcType?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  return !EXCLUDED_DC_TYPES.has(normalized);
}

/**
 * Nature main RSS has no dc:type and mixes magazine items with research.
 * Fetch article HTML once for type gating and abstract enrichment.
 */
export async function enrichNatureMainPaper(paper: Paper): Promise<Paper | null> {
  const html = await fetchHtml(paper.url);
  const articleType = extractNatureDcType(html);

  if (!isNatureMainIncludedType(articleType)) {
    return null;
  }

  const existing = paper.abstract?.trim();
  let abstract = existing;
  if (!existing || isNatureRssTeaserAbstract(existing)) {
    abstract = extractNatureMethodsAbstractFromHtml(html) ?? existing;
  }

  return {
    ...paper,
    articleType,
    abstract: abstract?.trim() || undefined,
  };
}

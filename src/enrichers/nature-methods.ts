import { fetchHtml } from "../fetchHtml.js";
import { isNatureRssTeaserAbstract } from "../normalizers/rss/nature-encoded.js";
import { normalizeWhitespace } from "../normalizers/shared.js";
import type { Paper } from "../types.js";
import {
  extractMetaByName,
  extractMetaByProperty,
  extractNatureAbs1Section,
} from "./htmlMeta.js";

export function extractNatureMethodsAbstractFromHtml(html: string): string | undefined {
  const candidates = [
    extractMetaByName(html, "description"),
    extractMetaByName(html, "dc.description"),
    extractMetaByProperty(html, "og:description"),
    extractNatureAbs1Section(html),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWhitespace(candidate ?? "");
    if (normalized) return normalized;
  }

  return undefined;
}

/** Works for any nature.com article URL (Nature, Nature Methods, …). */
export async function enrichNatureMethodsPaper(paper: Paper): Promise<Paper> {
  const existing = paper.abstract?.trim();
  if (existing && !isNatureRssTeaserAbstract(existing)) return paper;

  const html = await fetchHtml(paper.url);
  const abstract = extractNatureMethodsAbstractFromHtml(html);
  if (!abstract) return paper;

  return { ...paper, abstract };
}

import type { Item } from "rss-parser";
import { extractDoi } from "./doi.js";
import { extractRssAbstract } from "./normalizers/rss/index.js";
import { isNatureBiotechnologySkippedItem } from "./normalizers/rss/nature-biotechnology.js";
import { isNatureCellBiologySkippedItem } from "./normalizers/rss/nature-cell-biology.js";
import { isNatureNeuroscienceSkippedItem } from "./normalizers/rss/nature-neuroscience.js";
import { isNatureCommunicationsSkippedItem } from "./normalizers/rss/nature-communications.js";
import { isNatureEcologyEvolutionSkippedItem } from "./normalizers/rss/nature-ecology-evolution.js";
import { isNatureImmunologySkippedItem } from "./normalizers/rss/nature-immunology.js";
import { isNatureMicrobiologySkippedItem } from "./normalizers/rss/nature-microbiology.js";
import { isPnasEditorialRssItem } from "./normalizers/rss/pnas.js";
import { normalizeWhitespace } from "./normalizers/shared.js";
import type { Paper, Source } from "./types.js";

type RssItemWithCustomFields = Item & {
  source?: string;
};

export { extractDoi, normalizeWhitespace };

export function buildPaperId(paper: Pick<Paper, "doi" | "url" | "title">): string {
  if (paper.doi) return paper.doi.toLowerCase();
  if (paper.url) return paper.url;
  return normalizeWhitespace(paper.title).toLowerCase();
}

export function normalizeRssItemToPaper(item: RssItemWithCustomFields, source: Source): Paper | null {
  const title = item.title ? normalizeWhitespace(item.title) : "";
  const url = item.link?.trim() ?? "";
  const publishedDate = item.isoDate ?? item.pubDate ?? "";
  if (source.id === "pnas" && isPnasEditorialRssItem(item)) {
    return null;
  }

  if (source.id === "nature-communications" && isNatureCommunicationsSkippedItem(item)) {
    return null;
  }

  if (source.id === "nature-ecology-evolution" && isNatureEcologyEvolutionSkippedItem(item)) {
    return null;
  }

  if (source.id === "nature-biotechnology" && isNatureBiotechnologySkippedItem(item)) {
    return null;
  }

  if (source.id === "nature-cell-biology" && isNatureCellBiologySkippedItem(item)) {
    return null;
  }

  if (source.id === "nature-neuroscience" && isNatureNeuroscienceSkippedItem(item)) {
    return null;
  }

  if (source.id === "nature-immunology" && isNatureImmunologySkippedItem(item)) {
    return null;
  }

  if (source.id === "nature-microbiology" && isNatureMicrobiologySkippedItem(item)) {
    return null;
  }

  const doi =
    extractDoi(item.guid) ??
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
    matchedKeywords: [],
    section: "other",
  };

  return paper;
}

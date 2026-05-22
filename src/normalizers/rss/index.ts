import type { Item } from "rss-parser";
import { extractDefaultRssAbstract } from "./default.js";
import { extractNatureMethodsAbstract } from "./nature-methods.js";
import { extractPlosBiologyAbstract } from "./plos-biology.js";
import { extractPnasAbstract } from "./pnas.js";

export type RssAbstractExtractor = (item: Item) => string | undefined;

const RSS_ABSTRACT_EXTRACTORS: Record<string, RssAbstractExtractor> = {
  "nature-methods": extractNatureMethodsAbstract,
  "plos-biology": extractPlosBiologyAbstract,
  "pnas": extractPnasAbstract,
};

export function extractRssAbstract(sourceId: string, item: Item): string | undefined {
  const extractor = RSS_ABSTRACT_EXTRACTORS[sourceId] ?? extractDefaultRssAbstract;
  return extractor(item);
}

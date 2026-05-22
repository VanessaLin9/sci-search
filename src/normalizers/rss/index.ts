import type { Item } from "rss-parser";
import { extractDefaultRssAbstract } from "./default.js";
import { extractNatureCommunicationsAbstract } from "./nature-communications.js";
import { extractNatureBiotechnologyAbstract } from "./nature-biotechnology.js";
import { extractNatureEcologyEvolutionAbstract } from "./nature-ecology-evolution.js";
import { extractNatureMethodsAbstract } from "./nature-methods.js";
import { extractPlosBiologyAbstract } from "./plos-biology.js";
import { extractPnasAbstract } from "./pnas.js";
import { extractScienceAbstract } from "./science.js";

export type RssAbstractExtractor = (item: Item) => string | undefined;

const RSS_ABSTRACT_EXTRACTORS: Record<string, RssAbstractExtractor> = {
  "nature": extractNatureMethodsAbstract,
  "nature-methods": extractNatureMethodsAbstract,
  "nature-genetics": extractNatureMethodsAbstract,
  "nature-communications": extractNatureCommunicationsAbstract,
  "nature-ecology-evolution": extractNatureEcologyEvolutionAbstract,
  "nature-biotechnology": extractNatureBiotechnologyAbstract,
  "plos-biology": extractPlosBiologyAbstract,
  "pnas": extractPnasAbstract,
  "science": extractScienceAbstract,
};

export function extractRssAbstract(sourceId: string, item: Item): string | undefined {
  const extractor = RSS_ABSTRACT_EXTRACTORS[sourceId] ?? extractDefaultRssAbstract;
  return extractor(item);
}

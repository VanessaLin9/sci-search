import type { Item } from "rss-parser";
import { extractDefaultRssAbstract } from "./default.js";
import {
  extractNatureCommunicationsAbstract,
  isNatureCommunicationsSkippedItem,
} from "./nature-communications.js";
import {
  extractNatureBiotechnologyAbstract,
  isNatureBiotechnologySkippedItem,
} from "./nature-biotechnology.js";
import {
  extractNatureCellBiologyAbstract,
  isNatureCellBiologySkippedItem,
} from "./nature-cell-biology.js";
import {
  extractNatureNeuroscienceAbstract,
  isNatureNeuroscienceSkippedItem,
} from "./nature-neuroscience.js";
import {
  extractNatureEcologyEvolutionAbstract,
  isNatureEcologyEvolutionSkippedItem,
} from "./nature-ecology-evolution.js";
import {
  extractNatureImmunologyAbstract,
  isNatureImmunologySkippedItem,
} from "./nature-immunology.js";
import {
  extractNatureMicrobiologyAbstract,
  isNatureMicrobiologySkippedItem,
} from "./nature-microbiology.js";
import { extractNatureMainAbstract } from "./nature.js";
import { extractNatureMethodsAbstract } from "./nature-methods.js";
import { extractPlosBiologyAbstract } from "./plos-biology.js";
import { extractPnasAbstract, isPnasEditorialRssItem } from "./pnas.js";
import { extractScienceAdvancesAbstract } from "./science-advances.js";
import { extractScienceAbstract } from "./science.js";

export type RssAbstractExtractor = (item: Item) => string | undefined;
export type RssSkipRule = (item: Item) => boolean;

const RSS_SKIP_RULES: Record<string, RssSkipRule> = {
  "pnas": isPnasEditorialRssItem,
  "nature-communications": isNatureCommunicationsSkippedItem,
  "nature-ecology-evolution": isNatureEcologyEvolutionSkippedItem,
  "nature-biotechnology": isNatureBiotechnologySkippedItem,
  "nature-cell-biology": isNatureCellBiologySkippedItem,
  "nature-neuroscience": isNatureNeuroscienceSkippedItem,
  "nature-immunology": isNatureImmunologySkippedItem,
  "nature-microbiology": isNatureMicrobiologySkippedItem,
};

const RSS_ABSTRACT_EXTRACTORS: Record<string, RssAbstractExtractor> = {
  "nature": extractNatureMainAbstract,
  "nature-methods": extractNatureMethodsAbstract,
  "nature-genetics": extractNatureMethodsAbstract,
  "nature-communications": extractNatureCommunicationsAbstract,
  "nature-ecology-evolution": extractNatureEcologyEvolutionAbstract,
  "nature-biotechnology": extractNatureBiotechnologyAbstract,
  "nature-cell-biology": extractNatureCellBiologyAbstract,
  "nature-neuroscience": extractNatureNeuroscienceAbstract,
  "nature-immunology": extractNatureImmunologyAbstract,
  "nature-microbiology": extractNatureMicrobiologyAbstract,
  "plos-biology": extractPlosBiologyAbstract,
  "pnas": extractPnasAbstract,
  "science": extractScienceAbstract,
  "science-advances": extractScienceAdvancesAbstract,
};

export function shouldSkipRssItem(sourceId: string, item: Item): boolean {
  const skipRule = RSS_SKIP_RULES[sourceId];
  return skipRule ? skipRule(item) : false;
}

export function extractRssAbstract(sourceId: string, item: Item): string | undefined {
  const extractor = RSS_ABSTRACT_EXTRACTORS[sourceId] ?? extractDefaultRssAbstract;
  return extractor(item);
}

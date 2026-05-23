import type { Item } from "rss-parser";
import { extractDefaultRssAbstract } from "./default.js";
import { extractNatureCommunicationsAbstract } from "./nature-communications.js";
import { extractNatureBiotechnologyAbstract } from "./nature-biotechnology.js";
import { extractNatureCellBiologyAbstract } from "./nature-cell-biology.js";
import { extractNatureNeuroscienceAbstract } from "./nature-neuroscience.js";
import { extractNatureEcologyEvolutionAbstract } from "./nature-ecology-evolution.js";
import { extractNatureImmunologyAbstract } from "./nature-immunology.js";
import { extractNatureMicrobiologyAbstract } from "./nature-microbiology.js";
import { extractNatureMethodsAbstract } from "./nature-methods.js";
import { extractPlosBiologyAbstract } from "./plos-biology.js";
import { extractPnasAbstract } from "./pnas.js";
import { extractScienceAdvancesAbstract } from "./science-advances.js";
import { extractScienceAbstract } from "./science.js";

export type RssAbstractExtractor = (item: Item) => string | undefined;

const RSS_ABSTRACT_EXTRACTORS: Record<string, RssAbstractExtractor> = {
  "nature": extractNatureMethodsAbstract,
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

export function extractRssAbstract(sourceId: string, item: Item): string | undefined {
  const extractor = RSS_ABSTRACT_EXTRACTORS[sourceId] ?? extractDefaultRssAbstract;
  return extractor(item);
}

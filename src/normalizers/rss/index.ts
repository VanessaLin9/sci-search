import type { Item } from "rss-parser";
import {
  RSS_ABSTRACT_EXTRACTOR_REGISTRY,
  RSS_SKIP_RULE_REGISTRY,
  type RssAbstractExtractorKind,
  type RssSkipRuleKind,
} from "../../domain/life-science/feeds/registries.js";
import { isNatureEncodedSkippedItem } from "../../domain/life-science/feeds/natureSkipPolicy.js";
import { extractDefaultRssAbstract } from "./default.js";
import {
  extractNatureCommunicationsAbstract,
} from "./nature-communications.js";
import {
  extractNatureBiotechnologyAbstract,
} from "./nature-biotechnology.js";
import {
  extractNatureCellBiologyAbstract,
} from "./nature-cell-biology.js";
import {
  extractNatureNeuroscienceAbstract,
} from "./nature-neuroscience.js";
import {
  extractNatureEcologyEvolutionAbstract,
} from "./nature-ecology-evolution.js";
import {
  extractNatureImmunologyAbstract,
} from "./nature-immunology.js";
import {
  extractNatureMicrobiologyAbstract,
} from "./nature-microbiology.js";
import { extractNatureMainAbstract } from "./nature.js";
import { extractNatureMethodsAbstract } from "./nature-methods.js";
import { extractPlosBiologyAbstract } from "./plos-biology.js";
import { extractPnasAbstract, isPnasEditorialRssItem } from "./pnas.js";
import { extractScienceAdvancesAbstract } from "./science-advances.js";
import { extractScienceAbstract } from "./science.js";

export type RssAbstractExtractor = (item: Item) => string | undefined;
export type RssSkipRule = (item: Item) => boolean;

const RSS_SKIP_RULE_IMPLEMENTATIONS: Record<RssSkipRuleKind, RssSkipRule> = {
  "pnas-editorial": isPnasEditorialRssItem,
  "nature-encoded": isNatureEncodedSkippedItem,
};

const RSS_ABSTRACT_EXTRACTOR_IMPLEMENTATIONS: Record<RssAbstractExtractorKind, RssAbstractExtractor> = {
  "nature-main": extractNatureMainAbstract,
  "nature-methods": extractNatureMethodsAbstract,
  "nature-communications": extractNatureCommunicationsAbstract,
  "nature-ecology-evolution": extractNatureEcologyEvolutionAbstract,
  "nature-biotechnology": extractNatureBiotechnologyAbstract,
  "nature-cell-biology": extractNatureCellBiologyAbstract,
  "nature-neuroscience": extractNatureNeuroscienceAbstract,
  "nature-immunology": extractNatureImmunologyAbstract,
  "nature-microbiology": extractNatureMicrobiologyAbstract,
  "plos-biology": extractPlosBiologyAbstract,
  pnas: extractPnasAbstract,
  science: extractScienceAbstract,
  "science-advances": extractScienceAdvancesAbstract,
};

const RSS_SKIP_RULES = Object.fromEntries(
  Object.entries(RSS_SKIP_RULE_REGISTRY).map(([sourceId, ruleKind]) => [
    sourceId,
    RSS_SKIP_RULE_IMPLEMENTATIONS[ruleKind],
  ]),
) as Record<keyof typeof RSS_SKIP_RULE_REGISTRY, RssSkipRule>;

const RSS_ABSTRACT_EXTRACTORS = Object.fromEntries(
  Object.entries(RSS_ABSTRACT_EXTRACTOR_REGISTRY).map(([sourceId, extractorKind]) => [
    sourceId,
    RSS_ABSTRACT_EXTRACTOR_IMPLEMENTATIONS[extractorKind],
  ]),
) as Record<keyof typeof RSS_ABSTRACT_EXTRACTOR_REGISTRY, RssAbstractExtractor>;

export function shouldSkipRssItem(sourceId: string, item: Item): boolean {
  const skipRule = RSS_SKIP_RULES[sourceId as keyof typeof RSS_SKIP_RULES];
  return skipRule ? skipRule(item) : false;
}

export function extractRssAbstract(sourceId: string, item: Item): string | undefined {
  const extractor =
    RSS_ABSTRACT_EXTRACTORS[sourceId as keyof typeof RSS_ABSTRACT_EXTRACTORS] ??
    extractDefaultRssAbstract;
  return extractor(item);
}

export { RSS_SKIP_RULE_REGISTRY, RSS_ABSTRACT_EXTRACTOR_REGISTRY };

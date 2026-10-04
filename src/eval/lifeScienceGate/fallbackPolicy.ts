import type { RoutingKeywordsConfig } from "../../domain/life-science/routing/keywordFallbackMatcher.js";
import { contentHash } from "./hash.js";

export const LIFE_SCIENCE_GATE_FALLBACK_POLICY_ID = "routing-keyword-fallback-v1" as const;

export type FallbackPolicySnapshot = {
  id: typeof LIFE_SCIENCE_GATE_FALLBACK_POLICY_ID;
  hash: string;
  keywords: RoutingKeywordsConfig;
};

export function fallbackPolicyHash(keywords: RoutingKeywordsConfig): string {
  return contentHash({
    includeStems: [...keywords.includeStems],
    includeTerms: [...keywords.includeTerms],
    sharedIncludeTerms: [...keywords.sharedIncludeTerms],
    excludeTerms: [...keywords.excludeTerms],
    excludePhrases: [...keywords.excludePhrases],
  });
}

export function snapshotFallbackPolicy(keywords: RoutingKeywordsConfig): FallbackPolicySnapshot {
  return {
    id: LIFE_SCIENCE_GATE_FALLBACK_POLICY_ID,
    hash: fallbackPolicyHash(keywords),
    keywords: {
      includeStems: [...keywords.includeStems],
      includeTerms: [...keywords.includeTerms],
      sharedIncludeTerms: [...keywords.sharedIncludeTerms],
      excludeTerms: [...keywords.excludeTerms],
      excludePhrases: [...keywords.excludePhrases],
    },
  };
}

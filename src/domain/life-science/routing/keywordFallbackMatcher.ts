import type { LifeScienceRoutingVerdict } from "../types.js";
import { normalizeRoutingKeywordStem, stemRoutingTitle, tokenizeRoutingTitle } from "./keywordTokenize.js";

export type RoutingKeywordsConfig = {
  includeStems: readonly string[];
  includeTerms: readonly string[];
  sharedIncludeTerms: readonly string[];
  excludeTerms: readonly string[];
  excludePhrases: readonly string[];
};

export type RoutingKeywordMatchResult = {
  verdict: Extract<LifeScienceRoutingVerdict, "yes" | "no">;
  matchedIncludes: string[];
  matchedExcludes: string[];
};

function normalizeHaystack(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ");
}

function findPhraseMatches(haystack: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => haystack.includes(phrase.toLowerCase()));
}

function findTermMatches(haystack: string, terms: readonly string[]): string[] {
  return terms.filter((term) => haystack.includes(term.toLowerCase()));
}

function findStemMatches(titleStems: Set<string>, stems: readonly string[]): string[] {
  const normalized = new Set(stems.map((stem) => normalizeRoutingKeywordStem(stem)));
  return [...normalized].filter((stem) => titleStems.has(stem));
}

function collectIncludeMatches(
  title: string,
  haystack: string,
  titleStems: Set<string>,
  config: RoutingKeywordsConfig,
): { matchedIncludes: string[]; termLevelIncludes: string[] } {
  const stemIncludes = findStemMatches(titleStems, config.includeStems);
  const termIncludes = findTermMatches(haystack, [...config.includeTerms, ...config.sharedIncludeTerms]);
  const tokenIncludes = tokenizeRoutingTitle(title).filter((token) =>
    config.includeTerms.some((term) => term.toLowerCase() === token),
  );
  return {
    matchedIncludes: [...new Set([...stemIncludes, ...termIncludes, ...tokenIncludes])],
    termLevelIncludes: [...new Set([...termIncludes, ...tokenIncludes])],
  };
}

/**
 * Broad-science LLM degrade 時的標題規則（PR #19）：
 * include hit → yes；否則 no（偏 precision，避免亂救）。
 * 強排除仍否決「只有過寬 stem」的命中（quantum + regulat）；term-level include
 * 與 exclude 同時命中時改為 yes（organoid + deep learning、malaria + climate）。
 */
export function matchRoutingKeywordFallback(
  title: string,
  config: RoutingKeywordsConfig,
): RoutingKeywordMatchResult {
  const haystack = normalizeHaystack(title);
  const titleStems = stemRoutingTitle(title);

  const phraseExcludes = findPhraseMatches(haystack, config.excludePhrases);
  const termExcludes = findTermMatches(haystack, config.excludeTerms);
  const matchedExcludes = [...phraseExcludes, ...termExcludes];
  const { matchedIncludes, termLevelIncludes } = collectIncludeMatches(
    title,
    haystack,
    titleStems,
    config,
  );

  if (matchedExcludes.length > 0 && termLevelIncludes.length === 0) {
    return { verdict: "no", matchedIncludes: [], matchedExcludes };
  }

  if (matchedIncludes.length > 0) {
    return { verdict: "yes", matchedIncludes, matchedExcludes };
  }

  return { verdict: "no", matchedIncludes: [], matchedExcludes: [] };
}

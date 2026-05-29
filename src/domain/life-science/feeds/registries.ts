/** Canonical RSS skip-rule registry: sourceId → rule kind (INV-049). Wired in src/normalizers/rss/index.ts. */
export const RSS_SKIP_RULE_REGISTRY = {
  pnas: "pnas-editorial",
  "nature-communications": "nature-encoded",
  "nature-ecology-evolution": "nature-encoded",
  "nature-biotechnology": "nature-encoded",
  "nature-cell-biology": "nature-encoded",
  "nature-neuroscience": "nature-encoded",
  "nature-immunology": "nature-encoded",
  "nature-microbiology": "nature-encoded",
} as const;

export type RssSkipRuleKind = (typeof RSS_SKIP_RULE_REGISTRY)[keyof typeof RSS_SKIP_RULE_REGISTRY];

/** Canonical RSS abstract extractor registry: sourceId → extractor kind (INV-051). */
export const RSS_ABSTRACT_EXTRACTOR_REGISTRY = {
  nature: "nature-main",
  "nature-methods": "nature-methods",
  "nature-genetics": "nature-methods",
  "nature-communications": "nature-communications",
  "nature-ecology-evolution": "nature-ecology-evolution",
  "nature-biotechnology": "nature-biotechnology",
  "nature-cell-biology": "nature-cell-biology",
  "nature-neuroscience": "nature-neuroscience",
  "nature-immunology": "nature-immunology",
  "nature-microbiology": "nature-microbiology",
  "plos-biology": "plos-biology",
  pnas: "pnas",
  science: "science",
  "science-advances": "science-advances",
} as const;

export type RssAbstractExtractorKind =
  (typeof RSS_ABSTRACT_EXTRACTOR_REGISTRY)[keyof typeof RSS_ABSTRACT_EXTRACTOR_REGISTRY];

/** Canonical paper enricher registry: sourceId → enricher kind (INV-052). */
export const PAPER_ENRICHER_REGISTRY = {
  nature: "nature-main",
  "nature-methods": "nature-methods",
  "nature-genetics": "nature-methods",
  "nature-communications": "nature-methods",
  "nature-ecology-evolution": "nature-methods",
  "nature-biotechnology": "nature-methods",
  "nature-cell-biology": "nature-methods",
  "nature-neuroscience": "nature-methods",
  "nature-immunology": "nature-methods",
  "nature-microbiology": "nature-methods",
  pnas: "pnas",
  science: "science",
  "science-advances": "science-advances",
} as const;

export type PaperEnricherKind = (typeof PAPER_ENRICHER_REGISTRY)[keyof typeof PAPER_ENRICHER_REGISTRY];

/** Phase 2 routing: broad-science feeds need title-only LLM life-science gate. */
export const SOURCE_SCOPES = ["life-science-only", "broad-science"] as const;

/** Keyword buckets; maps to digest line-a fallback when section is single-cell-spatial. */
export const PAPER_SECTIONS = ["single-cell-spatial", "biology", "other"] as const;

/** Phase 2b digest: main-line bucket for email layout and featured selection. */
export const DIGEST_LINES = ["line-a", "line-b", "preprint", "skip"] as const;

export const DIGEST_TAGGING_METHODS = ["llm", "keyword-fallback"] as const;

/** Phase 2a: is this paper life-science relevant? */
export const LIFE_SCIENCE_ROUTING_VERDICTS = ["yes", "no", "not_sure"] as const;

export const LIFE_SCIENCE_ROUTING_METHODS = ["scope-default", "llm"] as const;

export const LIFE_SCIENCE_ROUTING_EXCLUSION_REASON = "life-science-routing" as const;

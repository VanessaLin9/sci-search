import type {
  DIGEST_LINES,
  DIGEST_TAGGING_METHODS,
  LIFE_SCIENCE_ROUTING_METHODS,
  LIFE_SCIENCE_ROUTING_VERDICTS,
  PAPER_SECTIONS,
  SOURCE_SCOPES,
} from "./constants.js";

export type SourceScope = (typeof SOURCE_SCOPES)[number];

export type PaperSection = (typeof PAPER_SECTIONS)[number];

export type DigestLine = (typeof DIGEST_LINES)[number];

export type DigestTaggingMethod = (typeof DIGEST_TAGGING_METHODS)[number];

export type LifeScienceRoutingVerdict = (typeof LIFE_SCIENCE_ROUTING_VERDICTS)[number];

export type LifeScienceRoutingMethod = (typeof LIFE_SCIENCE_ROUTING_METHODS)[number];

export type LifeScienceRouting = {
  verdict: LifeScienceRoutingVerdict;
  method: LifeScienceRoutingMethod;
};

/** Domain fields added after keyword classify and digest phases. */
export type LifeSciencePaperView = {
  matchedKeywords: string[];
  section: PaperSection;
  /** Phase 2b: email main line (A/B/preprint); set after LLM tag or keyword fallback. */
  digestLine?: DigestLine;
  digestTaggingMethod?: DigestTaggingMethod;
  /** Top N papers with full 繁中 summary in the email body. */
  featured?: boolean;
  titleZh?: string;
  summaryZh?: string;
  /** English topic tags for featured cards. */
  topicTags?: string[];
};

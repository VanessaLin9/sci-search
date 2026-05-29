export {
  BIOLOGY_KEYWORDS,
  LIFE_SCIENCE_KEYWORDS,
  PRIMARY_KEYWORDS,
  type LifeScienceKeywordsConfig,
} from "./keywords.js";
export { DIGEST_LINES } from "./constants.js";
export {
  LIFE_SCIENCE_DIGEST_POLICY,
  MAX_FEATURED,
  type LifeScienceDigestPolicy,
} from "./digestPolicy.js";
export {
  DEFAULT_DIGEST_SUBJECT_PREFIX,
  DIGEST_PRODUCT_NAME,
  LIFE_SCIENCE_EMAIL_BRANDING,
  type LifeScienceEmailBranding,
} from "./emailBranding.js";
export { DEFAULT_RSS_SOURCE_IDS, SOURCE_SCOPE_BY_ID, type DefaultRssSourceId } from "./sources.js";
export { PAPER_SECTIONS } from "./constants.js";
export { SOURCE_SCOPES, LIFE_SCIENCE_ROUTING_EXCLUSION_REASON } from "./constants.js";
export {
  digestLineSchema,
  digestTaggingMethodSchema,
  lifeScienceRoutingExclusionReasonSchema,
  lifeScienceRoutingExclusionVerdictSchema,
  lifeScienceRoutingMethodSchema,
  lifeScienceRoutingSchema,
  lifeScienceRoutingVerdictSchema,
  paperSectionSchema,
  sourceScopeSchema,
} from "./schemas.js";
export type {
  DigestLine,
  DigestTaggingMethod,
  LifeSciencePaperView,
  LifeScienceRouting,
  LifeScienceRoutingMethod,
  LifeScienceRoutingVerdict,
  PaperSection,
  SourceScope,
} from "./types.js";

export type {
  BroadScienceRoutingInput,
  ExcludedPaper,
  LifeScienceRoutingResult,
  LifeScienceRoutingStats,
} from "./routing/types.js";

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

export {
  classifyPaperKeywords,
  classifyPapersWithKeywords,
  classifySection,
  matchKeywords,
  type KeywordClassifiedFields,
} from "./classifyKeywords.js";
export { fallbackDigestLine, type DigestLineFallbackInput } from "./fallbackDigestLine.js";
export { resolveSourceScope } from "./resolveSourceScope.js";
export { ROUTING_SYSTEM_PROMPT } from "./prompts/routing.system.js";
export { DIGEST_TAGGING_SYSTEM_PROMPT } from "./prompts/tagging.system.js";
export { DIGEST_SUMMARIZE_SYSTEM_PROMPT } from "./prompts/summarize.system.js";
export { DIGEST_TRANSLATE_SYSTEM_PROMPT } from "./prompts/translate.system.js";

export {
  buildSourceScopeById,
  getSourceScope,
  passesScopeDefault,
} from "./routing/sourceScope.js";
export { isLifeScienceRoutingEnabled } from "./routing/config.js";
export {
  applyScopeDefaultRouting,
  assembleRoutingResult,
  emptyRoutingStats,
  mergeBroadScienceRoutingResults,
  routingResultWhenDisabled,
  splitPapersByRoutingScope,
} from "./routing/route.js";

export {
  applyKeywordDigestFallback,
  emptyDigestSelectionStats,
  emptyDigestTaggingStats,
  keywordFallbackTaggingStats,
  resolveDigestLines,
  type DigestTaggingStats as DomainDigestTaggingStats,
} from "./digest/resolveDigestLines.js";
export {
  buildSourcePriorityById,
  compareForFeatured,
  DIGEST_LINE_RANK,
  selectFeatured,
  sortPapersByDigestRank,
  type DigestSelectionStats,
} from "./digest/selection.js";

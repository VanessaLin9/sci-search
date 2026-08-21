import { DEFAULT_SPATIAL_CONFIDENCE_THRESHOLD } from "./digest/spatialConfidence.js";

/** Product rule: at most this many featured cards in the life-science digest email. */
export const MAX_FEATURED = 12;

export type LifeScienceDigestPolicy = {
  maxFeatured: number;
  /** LLM spatial_confidence ≥ threshold → main line A; else B. */
  spatialConfidenceThreshold: number;
};

export const LIFE_SCIENCE_DIGEST_POLICY: LifeScienceDigestPolicy = {
  maxFeatured: MAX_FEATURED,
  spatialConfidenceThreshold: DEFAULT_SPATIAL_CONFIDENCE_THRESHOLD,
};

export { DEFAULT_SPATIAL_CONFIDENCE_THRESHOLD };

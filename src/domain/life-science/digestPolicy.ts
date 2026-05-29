/** Product rule: at most this many featured cards in the life-science digest email. */
export const MAX_FEATURED = 12;

export type LifeScienceDigestPolicy = {
  maxFeatured: number;
};

export const LIFE_SCIENCE_DIGEST_POLICY: LifeScienceDigestPolicy = {
  maxFeatured: MAX_FEATURED,
};

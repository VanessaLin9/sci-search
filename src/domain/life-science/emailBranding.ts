/** Traditional Chinese product name and default email subject prefix. */
export const DIGEST_PRODUCT_NAME = "每日科學期刊摘要";

export const DEFAULT_DIGEST_SUBJECT_PREFIX = DIGEST_PRODUCT_NAME;

export type LifeScienceEmailBranding = {
  fromName: string;
  subjectPrefix: string;
};

export const LIFE_SCIENCE_EMAIL_BRANDING: LifeScienceEmailBranding = {
  fromName: DIGEST_PRODUCT_NAME,
  subjectPrefix: DEFAULT_DIGEST_SUBJECT_PREFIX,
};

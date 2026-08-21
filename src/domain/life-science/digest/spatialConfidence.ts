import type { DigestLine } from "../types.js";

/** 初版門檻 0.75；必須與 config/digest.json + LIFE_SCIENCE_DIGEST_POLICY 對齊，不可散落 hardcode（PR #38）。 */
export const DEFAULT_SPATIAL_CONFIDENCE_THRESHOLD = 0.75;

export function isValidSpatialConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * 將 LLM spatial_confidence 映射到主線 A/B（PR #38）。
 * `confidence >= threshold` → line-a；否則 line-b。分數是模型判斷，不宣稱為嚴格機率。
 */
export function digestLineFromSpatialConfidence(
  confidence: number,
  threshold: number,
): Extract<DigestLine, "line-a" | "line-b"> {
  if (!isValidSpatialConfidence(confidence)) {
    throw new Error(`spatial_confidence out of range: ${String(confidence)}`);
  }
  if (!(Number.isFinite(threshold) && threshold >= 0 && threshold <= 1)) {
    throw new Error(`spatialConfidenceThreshold out of range: ${String(threshold)}`);
  }
  return confidence >= threshold ? "line-a" : "line-b";
}

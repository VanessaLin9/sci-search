import type { DigestLine } from "../types.js";

/** Initial product threshold; calibrate later via regression fixtures. */
export const DEFAULT_SPATIAL_CONFIDENCE_THRESHOLD = 0.75;

export function isValidSpatialConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Map LLM spatial_confidence to main-line A/B.
 * `confidence >= threshold` → line-a; otherwise line-b.
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

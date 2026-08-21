import type { DigestLine } from "../types.js";
import { digestLineFromSpatialConfidence, isValidSpatialConfidence } from "./spatialConfidence.js";

type MainLine = Extract<DigestLine, "line-a" | "line-b">;

export type SpatialBatchRow = {
  id: string;
  spatial_confidence: number;
};

export type AppliedSpatialBatch = {
  lineById: Map<string, MainLine>;
  llmClassifiedIds: Set<string>;
  keywordFallbackIds: string[];
  failures: number;
};

/**
 * Apply one LLM spatial batch payload to requested ids.
 * Missing / invalid / out-of-range confidence / duplicate id → keywordFallbackIds（caller fills keyword A/B）。
 * Duplicate id 視為該 paper 的 malformed response（PR #38）：不可 silently keep first。
 */
export function applySpatialBatchRows(
  itemIds: readonly string[],
  rows: readonly SpatialBatchRow[],
  threshold: number,
): AppliedSpatialBatch {
  const lineById = new Map<string, MainLine>();
  const llmClassifiedIds = new Set<string>();
  const itemIdSet = new Set(itemIds);
  const duplicateIds = new Set<string>();
  let failures = 0;

  for (const row of rows) {
    const id = row.id?.trim();
    if (!id || !itemIdSet.has(id)) {
      failures += 1;
      continue;
    }
    if (!isValidSpatialConfidence(row.spatial_confidence)) {
      continue;
    }
    if (duplicateIds.has(id)) {
      continue;
    }
    if (lineById.has(id) || llmClassifiedIds.has(id)) {
      // Second (or later) row for the same id: drop the earlier LLM verdict and fallback.
      duplicateIds.add(id);
      lineById.delete(id);
      llmClassifiedIds.delete(id);
      continue;
    }
    lineById.set(id, digestLineFromSpatialConfidence(row.spatial_confidence, threshold));
    llmClassifiedIds.add(id);
  }

  const keywordFallbackIds: string[] = [];
  for (const id of itemIds) {
    if (!lineById.has(id)) {
      keywordFallbackIds.push(id);
      failures += 1;
    }
  }

  return { lineById, llmClassifiedIds, keywordFallbackIds, failures };
}

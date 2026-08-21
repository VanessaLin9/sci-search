import { SPATIAL_CLASSIFIER_SYSTEM_PROMPT } from "./spatialPrompt.js";
import type { SpatialClassifyInput } from "./spatialTypes.js";

const CHARS_PER_TOKEN = 4;
const COMPLETION_HEADROOM = 0.92;

export function estimateSpatialClassifyRequestTokens(items: SpatialClassifyInput[]): number {
  const userPayload = JSON.stringify({ papers: items });
  const charCount = SPATIAL_CLASSIFIER_SYSTEM_PROMPT.length + userPayload.length + 48;
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

export function estimateSpatialClassifyCompletionTokens(paperCount: number): number {
  if (paperCount === 0) return 0;
  // id + float JSON is small; reasoning-heavy models may spend more before emitting JSON.
  return 300 + paperCount * 120;
}

function spatialCompletionFits(paperCount: number, maxCompletionTokens: number): boolean {
  return (
    estimateSpatialClassifyCompletionTokens(paperCount) <=
    maxCompletionTokens * COMPLETION_HEADROOM
  );
}

export function planSpatialClassifyBatches(
  items: SpatialClassifyInput[],
  options: {
    maxInputTokens: number;
    maxCompletionTokens: number;
    maxPapersPerBatch: number;
  },
): SpatialClassifyInput[][] {
  if (items.length === 0) return [];

  const batches: SpatialClassifyInput[][] = [];
  let current: SpatialClassifyInput[] = [];

  for (const paper of items) {
    const candidate = [...current, paper];
    const overInput = estimateSpatialClassifyRequestTokens(candidate) > options.maxInputTokens;
    const overCount = candidate.length > options.maxPapersPerBatch;
    const overCompletion = !spatialCompletionFits(candidate.length, options.maxCompletionTokens);

    if (current.length > 0 && (overInput || overCount || overCompletion)) {
      batches.push(current);
      current = [paper];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

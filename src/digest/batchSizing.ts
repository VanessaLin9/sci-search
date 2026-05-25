import { DIGEST_TAGGING_SYSTEM_PROMPT } from "./taggingPrompt.js";
import type { DigestTaggingInput } from "./types.js";

const CHARS_PER_TOKEN = 4;
const COMPLETION_HEADROOM = 0.92;

export function estimateDigestTaggingRequestTokens(items: DigestTaggingInput[]): number {
  const userPayload = JSON.stringify({ papers: items });
  const charCount = DIGEST_TAGGING_SYSTEM_PROMPT.length + userPayload.length + 48;
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

export function estimateDigestTaggingCompletionTokens(paperCount: number): number {
  if (paperCount === 0) return 0;
  // Compact JSON is small; reasoning-heavy models may spend far more before emitting JSON.
  return 400 + paperCount * 280;
}

function taggingCompletionFits(paperCount: number, maxCompletionTokens: number): boolean {
  return (
    estimateDigestTaggingCompletionTokens(paperCount) <= maxCompletionTokens * COMPLETION_HEADROOM
  );
}

export function planDigestTaggingBatches(
  items: DigestTaggingInput[],
  options: {
    maxInputTokens: number;
    maxCompletionTokens: number;
    maxPapersPerBatch: number;
  },
): DigestTaggingInput[][] {
  if (items.length === 0) return [];

  const batches: DigestTaggingInput[][] = [];
  let current: DigestTaggingInput[] = [];

  for (const paper of items) {
    const candidate = [...current, paper];
    const overInput = estimateDigestTaggingRequestTokens(candidate) > options.maxInputTokens;
    const overCount = candidate.length > options.maxPapersPerBatch;
    const overCompletion = !taggingCompletionFits(candidate.length, options.maxCompletionTokens);

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

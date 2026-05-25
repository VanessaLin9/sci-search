import { DIGEST_TRANSLATE_SYSTEM_PROMPT } from "./translatePrompt.js";
import type { DigestTranslateInput } from "./types.js";

const CHARS_PER_TOKEN = 4;

function estimateTranslateRequestTokens(items: DigestTranslateInput[]): number {
  const userPayload = JSON.stringify({ papers: items });
  const charCount = DIGEST_TRANSLATE_SYSTEM_PROMPT.length + userPayload.length + 48;
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

export function planTranslateBatches(
  items: DigestTranslateInput[],
  maxPapersPerBatch: number,
  maxInputTokens: number,
): DigestTranslateInput[][] {
  if (items.length === 0) return [];

  const batches: DigestTranslateInput[][] = [];
  let current: DigestTranslateInput[] = [];

  for (const item of items) {
    const candidate = [...current, item];
    const overCount = candidate.length > maxPapersPerBatch;
    const overInput = estimateTranslateRequestTokens(candidate) > maxInputTokens;

    if (current.length > 0 && (overCount || overInput)) {
      batches.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

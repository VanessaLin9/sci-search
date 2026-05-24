import { ROUTING_SYSTEM_PROMPT } from "./routingPrompt.js";
import type { BroadScienceRoutingInput } from "./types.js";

/** Rough English-ish token estimate (no tiktoken dependency). */
const CHARS_PER_TOKEN = 4;

const COMPLETION_HEADROOM = 0.92;

export function estimateRoutingRequestTokens(items: BroadScienceRoutingInput[]): number {
  const userPayload = JSON.stringify({ papers: items });
  const charCount = ROUTING_SYSTEM_PROMPT.length + userPayload.length + 32;
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/** JSON verdict list only; leave headroom for long DOIs and occasional extra prose. */
export function estimateRoutingCompletionTokens(paperCount: number): number {
  if (paperCount === 0) return 0;
  return 200 + paperCount * 72;
}

export function routingCompletionFits(
  paperCount: number,
  maxCompletionTokens: number,
): boolean {
  return estimateRoutingCompletionTokens(paperCount) <= maxCompletionTokens * COMPLETION_HEADROOM;
}

export type RoutingBatchPlan = {
  batches: BroadScienceRoutingInput[][];
  estimatedInputTokens: number[];
  estimatedCompletionTokens: number[];
};

/**
 * Pack papers under input and completion token budgets, capped by maxPapersPerBatch.
 */
export function planRoutingBatches(
  items: BroadScienceRoutingInput[],
  options: {
    maxInputTokens: number;
    maxCompletionTokens: number;
    maxPapersPerBatch: number;
  },
): RoutingBatchPlan {
  if (items.length === 0) {
    return { batches: [], estimatedInputTokens: [], estimatedCompletionTokens: [] };
  }

  const batches: BroadScienceRoutingInput[][] = [];
  const estimatedInputTokens: number[] = [];
  const estimatedCompletionTokens: number[] = [];
  let current: BroadScienceRoutingInput[] = [];

  for (const paper of items) {
    const candidate = [...current, paper];
    const overInput = estimateRoutingRequestTokens(candidate) > options.maxInputTokens;
    const overCount = candidate.length > options.maxPapersPerBatch;
    const overCompletion = !routingCompletionFits(candidate.length, options.maxCompletionTokens);

    if (current.length > 0 && (overInput || overCount || overCompletion)) {
      batches.push(current);
      estimatedInputTokens.push(estimateRoutingRequestTokens(current));
      estimatedCompletionTokens.push(estimateRoutingCompletionTokens(current.length));
      current = [paper];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    batches.push(current);
    estimatedInputTokens.push(estimateRoutingRequestTokens(current));
    estimatedCompletionTokens.push(estimateRoutingCompletionTokens(current.length));
  }

  return { batches, estimatedInputTokens, estimatedCompletionTokens };
}

import { BIORXIV_GATE_SYSTEM_PROMPT } from "./gatePrompt.js";
import type { BiorxivGateInput } from "./types.js";

const CHARS_PER_TOKEN = 4;
const COMPLETION_HEADROOM = 0.92;

export function estimateBiorxivGateRequestTokens(items: BiorxivGateInput[]): number {
  const userPayload = JSON.stringify({ papers: items });
  const charCount = BIORXIV_GATE_SYSTEM_PROMPT.length + userPayload.length + 32;
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

export function estimateBiorxivGateCompletionTokens(paperCount: number): number {
  if (paperCount === 0) return 0;
  return 200 + paperCount * 72;
}

export function resolveBiorxivGateCompletionMaxTokens(
  estimated: number,
  configCap: number,
  floor = 640,
): number {
  if (estimated <= 0) {
    return Math.min(configCap, floor);
  }
  const withHeadroom = Math.max(Math.ceil(estimated * 1.35), estimated + 400, floor);
  return Math.min(configCap, withHeadroom);
}

function gateCompletionFits(paperCount: number, maxCompletionTokens: number): boolean {
  return estimateBiorxivGateCompletionTokens(paperCount) <= maxCompletionTokens * COMPLETION_HEADROOM;
}

export type BiorxivGateBatchPlan = {
  batches: BiorxivGateInput[][];
  estimatedInputTokens: number[];
  estimatedCompletionTokens: number[];
};

export function planBiorxivGateBatches(
  items: BiorxivGateInput[],
  options: {
    maxInputTokens: number;
    maxCompletionTokens: number;
    maxPapersPerBatch: number;
  },
): BiorxivGateBatchPlan {
  if (items.length === 0) {
    return { batches: [], estimatedInputTokens: [], estimatedCompletionTokens: [] };
  }

  const batches: BiorxivGateInput[][] = [];
  const estimatedInputTokens: number[] = [];
  const estimatedCompletionTokens: number[] = [];
  let current: BiorxivGateInput[] = [];

  for (const paper of items) {
    const candidate = [...current, paper];
    const overInput = estimateBiorxivGateRequestTokens(candidate) > options.maxInputTokens;
    const overCount = candidate.length > options.maxPapersPerBatch;
    const overCompletion = !gateCompletionFits(candidate.length, options.maxCompletionTokens);

    if (current.length > 0 && (overInput || overCount || overCompletion)) {
      batches.push(current);
      estimatedInputTokens.push(estimateBiorxivGateRequestTokens(current));
      estimatedCompletionTokens.push(estimateBiorxivGateCompletionTokens(current.length));
      current = [paper];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    batches.push(current);
    estimatedInputTokens.push(estimateBiorxivGateRequestTokens(current));
    estimatedCompletionTokens.push(estimateBiorxivGateCompletionTokens(current.length));
  }

  return { batches, estimatedInputTokens, estimatedCompletionTokens };
}

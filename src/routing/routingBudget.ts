import type { Clock } from "./clock.js";

/** Shared deadline for one `classifyBroadSciencePapers()` LLM stage. */
export const DEFAULT_ROUTING_STAGE_BUDGET_MS = 5 * 60 * 1000;

/** Skip issuing a provider call when remaining budget is below this. */
export const MIN_USEFUL_REQUEST_MS = 1_000;

export type RoutingBudget = {
  readonly totalMs: number;
  readonly deadlineMs: number;
  remainingMs(): number;
  hasBudgetFor(ms: number): boolean;
  /** `min(configuredTimeoutMs, remainingMs)`, or 0 when remaining is exhausted. */
  requestTimeoutMs(configuredTimeoutMs: number): number;
  canStartRequest(): boolean;
};

export function createRoutingBudget(
  clock: Clock,
  budgetMs: number = DEFAULT_ROUTING_STAGE_BUDGET_MS,
): RoutingBudget {
  const startedAt = clock.now();
  const totalMs = Math.max(0, budgetMs);
  const deadlineMs = startedAt + totalMs;

  return {
    totalMs,
    deadlineMs,
    remainingMs() {
      return Math.max(0, deadlineMs - clock.now());
    },
    hasBudgetFor(ms: number) {
      return this.remainingMs() >= ms;
    },
    requestTimeoutMs(configuredTimeoutMs: number) {
      const remaining = this.remainingMs();
      if (remaining <= 0) return 0;
      return Math.min(configuredTimeoutMs, remaining);
    },
    canStartRequest() {
      return this.remainingMs() >= MIN_USEFUL_REQUEST_MS;
    },
  };
}

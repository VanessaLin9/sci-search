import type { Clock } from "./clock.js";

/**
 * Shared deadline for one `classifyBroadSciencePapers()` LLM stage（PR #28）。
 * 涵蓋 top-level batch、missing-retry、JSON fallback、split、backoff 與 in-flight request；
 * 避免只做 request 前檢查、實際等待卻越過 stage 上限。
 */
export const DEFAULT_ROUTING_STAGE_BUDGET_MS = 5 * 60 * 1000;

/** 剩餘時間低於此就不發 request，直接 keyword fallback（PR #28）。 */
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

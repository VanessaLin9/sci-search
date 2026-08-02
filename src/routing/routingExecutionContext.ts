import type { Clock } from "./clock.js";
import { createRoutingBudget, type RoutingBudget } from "./routingBudget.js";
import { RATE_LIMIT_JITTER_MAX_MS } from "./routingRetryPolicy.js";

export type RoutingStopReason =
  | "timeout"
  | "network"
  | "persistent_rate_limit"
  | "persistent_5xx"
  | "auth"
  | "config"
  | "budget_exhausted";

export type RoutingStageDiagnostics = {
  requestCount: number;
  timeoutCount: number;
  networkErrorCount: number;
  rateLimitCount: number;
  serverErrorCount: number;
  parseFailureCount: number;
  llmClassifiedCount: number;
  keywordFallbackCount: number;
  stopReason: RoutingStopReason | null;
  elapsedMs: number;
};

export type RoutingExecutionContext = {
  clock: Clock;
  budget: RoutingBudget;
  jitterMs: () => number;
  diagnostics: Omit<RoutingStageDiagnostics, "llmClassifiedCount" | "keywordFallbackCount" | "elapsedMs"> & {
    startedAtMs: number;
  };
  stopReason: RoutingStopReason | null;
  canCallProvider(): boolean;
  openBreaker(reason: RoutingStopReason): void;
  noteRequest(): void;
  noteTimeout(): void;
  noteNetworkError(): void;
  noteRateLimit(): void;
  noteServerError(): void;
  noteParseFailure(): void;
  snapshot(llmClassifiedCount: number, keywordFallbackCount: number): RoutingStageDiagnostics;
};

export type CreateRoutingExecutionContextOptions = {
  clock: Clock;
  budgetMs?: number;
  /** Deterministic jitter for tests; defaults to `[0, RATE_LIMIT_JITTER_MAX_MS)`. */
  jitterMs?: () => number;
};

export function createRoutingExecutionContext(
  options: CreateRoutingExecutionContextOptions,
): RoutingExecutionContext {
  const { clock } = options;
  const budget = createRoutingBudget(clock, options.budgetMs);
  const jitterMs =
    options.jitterMs ?? (() => Math.floor(Math.random() * (RATE_LIMIT_JITTER_MAX_MS + 1)));

  const diagnostics = {
    startedAtMs: clock.now(),
    requestCount: 0,
    timeoutCount: 0,
    networkErrorCount: 0,
    rateLimitCount: 0,
    serverErrorCount: 0,
    parseFailureCount: 0,
    stopReason: null as RoutingStopReason | null,
  };

  const ctx: RoutingExecutionContext = {
    clock,
    budget,
    jitterMs,
    diagnostics,
    get stopReason() {
      return diagnostics.stopReason;
    },
    canCallProvider() {
      return diagnostics.stopReason === null;
    },
    openBreaker(reason: RoutingStopReason) {
      if (diagnostics.stopReason === null) {
        diagnostics.stopReason = reason;
      }
    },
    noteRequest() {
      diagnostics.requestCount += 1;
    },
    noteTimeout() {
      diagnostics.timeoutCount += 1;
    },
    noteNetworkError() {
      diagnostics.networkErrorCount += 1;
    },
    noteRateLimit() {
      diagnostics.rateLimitCount += 1;
    },
    noteServerError() {
      diagnostics.serverErrorCount += 1;
    },
    noteParseFailure() {
      diagnostics.parseFailureCount += 1;
    },
    snapshot(llmClassifiedCount: number, keywordFallbackCount: number) {
      return {
        requestCount: diagnostics.requestCount,
        timeoutCount: diagnostics.timeoutCount,
        networkErrorCount: diagnostics.networkErrorCount,
        rateLimitCount: diagnostics.rateLimitCount,
        serverErrorCount: diagnostics.serverErrorCount,
        parseFailureCount: diagnostics.parseFailureCount,
        llmClassifiedCount,
        keywordFallbackCount,
        stopReason: diagnostics.stopReason,
        elapsedMs: Math.max(0, clock.now() - diagnostics.startedAtMs),
      };
    },
  };

  return ctx;
}

export function formatRoutingStageSummary(diagnostics: RoutingStageDiagnostics): string {
  const stop = diagnostics.stopReason ?? "none";
  return (
    `stage summary · llm=${diagnostics.llmClassifiedCount} keyword_fallback=${diagnostics.keywordFallbackCount} ` +
    `requests=${diagnostics.requestCount} ` +
    `timeout=${diagnostics.timeoutCount} network=${diagnostics.networkErrorCount} ` +
    `429=${diagnostics.rateLimitCount} 5xx=${diagnostics.serverErrorCount} parse=${diagnostics.parseFailureCount} ` +
    `stop=${stop} elapsed=${(diagnostics.elapsedMs / 1000).toFixed(1)}s`
  );
}

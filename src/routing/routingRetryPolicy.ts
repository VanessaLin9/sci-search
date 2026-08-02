import { MIN_USEFUL_REQUEST_MS } from "./routingBudget.js";

export const DEFAULT_RATE_LIMIT_WAIT_MS = 30_000;
export const MAX_RATE_LIMIT_WAIT_MS = 60_000;
export const RATE_LIMIT_JITTER_MAX_MS = 1_000;
/** Short, bounded backoff for a single 5xx retry — not an exponential chain. */
export const SERVER_ERROR_BACKOFF_MS = 1_000;
/** Binary-split depth cap for length/parse recoveries (does not apply to transport failures). */
export const MAX_SPLIT_DEPTH = 3;

export type RateLimitWaitPlan = {
  waitMs: number;
  source: "retry-after" | "reset-hint" | "default";
};

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, unknown>;
  const direct = record[name] ?? record[name.toLowerCase()];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct) && typeof direct[0] === "string") return direct[0];
  return null;
}

/**
 * Parse Retry-After as delta-seconds or HTTP-date.
 * Returns null when absent or unusable.
 */
export function parseRetryAfterMs(headers: unknown, nowMs: number): number | null {
  const raw = headerValue(headers, "retry-after");
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

/** Optional provider reset hints (seconds-until-reset style). */
export function parseResetHintMs(headers: unknown): number | null {
  for (const name of [
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "x-ratelimit-reset",
  ]) {
    const raw = headerValue(headers, name);
    if (!raw) continue;
    const trimmed = raw.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const asSeconds = Number(trimmed);
      // Heuristic: values that look like unix timestamps are ignored; prefer deltas.
      if (asSeconds > 1_000_000_000) continue;
      return Math.max(0, Math.round(asSeconds * 1000));
    }
  }
  return null;
}

export function planRateLimitWait(options: {
  headers: unknown;
  nowMs: number;
  jitterMs: () => number;
}): RateLimitWaitPlan {
  const retryAfter = parseRetryAfterMs(options.headers, options.nowMs);
  if (retryAfter != null) {
    return {
      waitMs: Math.min(MAX_RATE_LIMIT_WAIT_MS, retryAfter),
      source: "retry-after",
    };
  }

  const resetHint = parseResetHintMs(options.headers);
  if (resetHint != null) {
    return {
      waitMs: Math.min(MAX_RATE_LIMIT_WAIT_MS, resetHint),
      source: "reset-hint",
    };
  }

  const jitter = Math.max(0, Math.min(RATE_LIMIT_JITTER_MAX_MS, options.jitterMs()));
  return {
    waitMs: Math.min(MAX_RATE_LIMIT_WAIT_MS, DEFAULT_RATE_LIMIT_WAIT_MS + jitter),
    source: "default",
  };
}

/** True when remaining budget can cover wait + one useful request. */
export function canAffordWaitAndRequest(remainingMs: number, waitMs: number): boolean {
  return remainingMs >= waitMs + MIN_USEFUL_REQUEST_MS;
}

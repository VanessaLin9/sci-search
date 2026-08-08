/**
 * Process-wide, quota-bucket-aware LLM request-start scheduler.
 *
 * Checkpoint 1（shared rate limiter）：只提供 queue／spacing／429 cooldown primitives。
 * 尚未接 production transport callers——那是 Checkpoint 2。
 *
 * Contracts:
 * - `schedule()` Promise = 排隊 + execute settled（成功／失敗／取消），不是只 enqueue。
 * - Spacing 以 request **start** 計算；長 request 可 overlap。
 * - 不同 bucket 完全獨立（lastStart / blockedUntil 不共用）。
 * - 429 → bucket-wide cooldown，再把原始 error rethrow；scheduler 不自動無限 retry。
 */
import type { Clock } from "../routing/clock.js";
import { systemClock } from "../routing/clock.js";
import { classifyRoutingFailure } from "../routing/classifyRoutingFailure.js";
import { planRateLimitWait } from "../routing/routingRetryPolicy.js";

/** NVIDIA integrate API：保守 2,000 ms start-to-start（~30 RPM；quota 40 RPM）。 */
export const NVIDIA_MIN_START_INTERVAL_MS = 2_000;
/** Gemini project：保守 5,000 ms start-to-start（~12 RPM；AI Studio active 15 RPM）。 */
export const GEMINI_MIN_START_INTERVAL_MS = 5_000;

export type LlmQuotaBucketPolicy = {
  minStartIntervalMs: number;
};

export type LlmRequestSchedulerErrorKind = "deadline" | "aborted" | "invariant";

export class LlmRequestSchedulerError extends Error {
  readonly kind: LlmRequestSchedulerErrorKind;

  constructor(kind: LlmRequestSchedulerErrorKind, message: string) {
    super(message);
    this.name = "LlmRequestSchedulerError";
    this.kind = kind;
  }
}

export type ScheduleLlmRequestOptions<T> = {
  /** Opaque quota identity（provider/base/credential fingerprint）；同 id 共用 spacing／cooldown。 */
  bucket: string;
  /** Absolute deadline on the injected clock；permit 前超時則永不 execute。 */
  deadlineAtMs?: number;
  signal?: AbortSignal;
  execute: () => Promise<T>;
};

export type LlmRequestScheduler = {
  schedule: <T>(options: ScheduleLlmRequestOptions<T>) => Promise<T>;
  /** Test／觀測：該 bucket 目前 blockedUntil（無 cooldown 時為 0）。 */
  getBlockedUntilMs: (bucket: string) => number;
  /** Test／觀測：queue 深度（不含 in-flight）。 */
  getQueueSize: (bucket: string) => number;
};

export type CreateLlmRequestSchedulerOptions = {
  clock?: Clock;
  /** Injected jitter for default 429 wait（tests: `() => 0`）。 */
  jitterMs?: () => number;
  /** Per-bucket spacing policy；未知 bucket 用 defaultMinStartIntervalMs。 */
  bucketPolicies?: Readonly<Record<string, LlmQuotaBucketPolicy>>;
  defaultMinStartIntervalMs?: number;
};

type QueueItem<T> = {
  bucketId: string;
  execute: () => Promise<T>;
  deadlineAtMs?: number;
  signal?: AbortSignal;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
  abortListener?: () => void;
  /** Wakes an in-progress queue wait when the item is cancelled. */
  cancelWait?: () => void;
};

type BucketState = {
  id: string;
  minStartIntervalMs: number;
  lastStartMs: number | null;
  blockedUntilMs: number;
  queue: QueueItem<unknown>[];
  pumping: boolean;
};

function abortError(signal?: AbortSignal): LlmRequestSchedulerError {
  if (typeof signal?.reason === "string" && signal.reason.trim()) {
    return new LlmRequestSchedulerError("aborted", signal.reason);
  }
  return new LlmRequestSchedulerError("aborted", "LLM request aborted while queued");
}

function deadlineError(): LlmRequestSchedulerError {
  return new LlmRequestSchedulerError(
    "deadline",
    "LLM request deadline reached while queued; request was not sent",
  );
}

function clearAbortListener(item: { signal?: AbortSignal; abortListener?: () => void }): void {
  if (item.signal && item.abortListener) {
    item.signal.removeEventListener("abort", item.abortListener);
  }
  item.abortListener = undefined;
}

function settleResolve<T>(item: QueueItem<T>, value: T): void {
  if (item.settled) return;
  item.settled = true;
  clearAbortListener(item);
  item.resolve(value);
}

function settleReject(item: QueueItem<unknown>, reason: unknown): void {
  if (item.settled) return;
  item.settled = true;
  clearAbortListener(item);
  item.reject(reason);
}

function removeFromQueue(bucket: BucketState, item: QueueItem<unknown>): void {
  const index = bucket.queue.indexOf(item);
  if (index >= 0) bucket.queue.splice(index, 1);
}

export function createLlmRequestScheduler(
  options: CreateLlmRequestSchedulerOptions = {},
): LlmRequestScheduler {
  const clock = options.clock ?? systemClock;
  const jitterMs = options.jitterMs ?? (() => Math.floor(Math.random() * 1_000));
  const bucketPolicies = options.bucketPolicies ?? {};
  const defaultMinStartIntervalMs =
    options.defaultMinStartIntervalMs ?? NVIDIA_MIN_START_INTERVAL_MS;

  const buckets = new Map<string, BucketState>();

  function getOrCreateBucket(bucketId: string): BucketState {
    const existing = buckets.get(bucketId);
    if (existing) return existing;
    const policy = bucketPolicies[bucketId];
    const created: BucketState = {
      id: bucketId,
      minStartIntervalMs: policy?.minStartIntervalMs ?? defaultMinStartIntervalMs,
      lastStartMs: null,
      blockedUntilMs: 0,
      queue: [],
      pumping: false,
    };
    buckets.set(bucketId, created);
    return created;
  }

  function applyRateLimitCooldown(bucket: BucketState, error: unknown): void {
    const failure = classifyRoutingFailure(error);
    if (failure.kind !== "rate_limit") return;
    const plan = planRateLimitWait({
      headers: failure.headers,
      nowMs: clock.now(),
      jitterMs,
    });
    const nextBlockedUntil = clock.now() + plan.waitMs;
    bucket.blockedUntilMs = Math.max(bucket.blockedUntilMs, nextBlockedUntil);
  }

  function itemIsExpired(item: QueueItem<unknown>, now: number): boolean {
    return item.deadlineAtMs != null && now >= item.deadlineAtMs;
  }

  function earliestStartMs(bucket: BucketState, now: number): number {
    const spacingEarliest =
      bucket.lastStartMs == null ? now : bucket.lastStartMs + bucket.minStartIntervalMs;
    return Math.max(spacingEarliest, bucket.blockedUntilMs, now);
  }

  function rejectQueuedItem(item: QueueItem<unknown>, reason: unknown): void {
    removeFromQueue(getOrCreateBucket(item.bucketId), item);
    item.cancelWait?.();
    settleReject(item, reason);
  }

  async function waitUntil(targetMs: number, item: QueueItem<unknown>): Promise<"ready" | "cancel"> {
    while (true) {
      if (item.settled) return "cancel";
      if (item.signal?.aborted) {
        rejectQueuedItem(item, abortError(item.signal));
        return "cancel";
      }
      const now = clock.now();
      if (itemIsExpired(item, now)) {
        rejectQueuedItem(item, deadlineError());
        return "cancel";
      }
      const remaining = targetMs - now;
      if (remaining <= 0) return "ready";
      const deadlineCap =
        item.deadlineAtMs != null ? Math.max(0, item.deadlineAtMs - now) : remaining;
      const sleepMs = Math.min(remaining, deadlineCap);
      if (sleepMs <= 0) {
        rejectQueuedItem(item, deadlineError());
        return "cancel";
      }

      const waitResult = await sleepUntilCancelable(clock, sleepMs, item);
      if (waitResult === "cancel") {
        if (!item.settled) {
          if (item.signal?.aborted) {
            rejectQueuedItem(item, abortError(item.signal));
          } else if (itemIsExpired(item, clock.now())) {
            rejectQueuedItem(item, deadlineError());
          }
        }
        return "cancel";
      }
    }
  }

  async function runExecute(bucket: BucketState, item: QueueItem<unknown>): Promise<void> {
    try {
      const value = await item.execute();
      settleResolve(item, value);
    } catch (error) {
      applyRateLimitCooldown(bucket, error);
      settleReject(item, error);
    }
  }

  async function pump(bucket: BucketState): Promise<void> {
    if (bucket.pumping) return;
    bucket.pumping = true;
    try {
      while (bucket.queue.length > 0) {
        const item = bucket.queue[0]!;
        if (item.settled) {
          removeFromQueue(bucket, item);
          continue;
        }
        if (item.signal?.aborted) {
          rejectQueuedItem(item, abortError(item.signal));
          continue;
        }
        const now = clock.now();
        if (itemIsExpired(item, now)) {
          rejectQueuedItem(item, deadlineError());
          continue;
        }

        const earliest = earliestStartMs(bucket, now);
        if (item.deadlineAtMs != null && earliest > item.deadlineAtMs) {
          rejectQueuedItem(item, deadlineError());
          continue;
        }

        if (earliest > now) {
          const waitResult = await waitUntil(earliest, item);
          if (waitResult === "cancel") continue;
          // Cooldown／abort／新 item 可能在 sleep 期間改變狀態；重算。
          continue;
        }

        // Grant start permit（start-to-start；不等 execute 完成）。
        bucket.queue.shift();
        clearAbortListener(item);
        bucket.lastStartMs = clock.now();
        void runExecute(bucket, item);
      }
    } catch (error) {
      // Fail-safe：pump invariant 失敗時清掉仍在 queue 的 item，避免 silent drop。
      const reason =
        error instanceof LlmRequestSchedulerError
          ? error
          : new LlmRequestSchedulerError(
              "invariant",
              error instanceof Error ? error.message : String(error),
            );
      while (bucket.queue.length > 0) {
        const item = bucket.queue.shift()!;
        settleReject(item, reason);
      }
    } finally {
      bucket.pumping = false;
      if (bucket.queue.length > 0) {
        void pump(bucket);
      }
    }
  }

  function enqueue<T>(options: ScheduleLlmRequestOptions<T>): Promise<T> {
    const bucket = getOrCreateBucket(options.bucket);

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        bucketId: options.bucket,
        execute: options.execute,
        deadlineAtMs: options.deadlineAtMs,
        signal: options.signal,
        resolve,
        reject,
        settled: false,
      };

      if (options.signal?.aborted) {
        settleReject(item as QueueItem<unknown>, abortError(options.signal));
        return;
      }
      const now = clock.now();
      if (itemIsExpired(item as QueueItem<unknown>, now)) {
        settleReject(item as QueueItem<unknown>, deadlineError());
        return;
      }

      if (options.signal) {
        const onAbort = () => {
          // In-flight：留给 execute／AbortSignal；queued：移出且永不執行。
          if (item.settled) {
            item.cancelWait?.();
            return;
          }
          if (bucket.queue.includes(item as QueueItem<unknown>)) {
            rejectQueuedItem(item as QueueItem<unknown>, abortError(options.signal));
          }
        };
        item.abortListener = onAbort;
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      bucket.queue.push(item as QueueItem<unknown>);
      void pump(bucket);
    });
  }

  return {
    schedule: enqueue,
    getBlockedUntilMs: (bucketId: string) => getOrCreateBucket(bucketId).blockedUntilMs,
    getQueueSize: (bucketId: string) => getOrCreateBucket(bucketId).queue.length,
  };
}

async function sleepUntilCancelable(
  clock: Clock,
  ms: number,
  item: QueueItem<unknown>,
): Promise<"ready" | "cancel"> {
  if (item.settled || item.signal?.aborted) return "cancel";
  if (ms <= 0) return "ready";

  return new Promise<"ready" | "cancel">((resolve) => {
    let finished = false;
    let onAbort: (() => void) | undefined;
    const finish = (result: "ready" | "cancel") => {
      if (finished) return;
      finished = true;
      item.cancelWait = undefined;
      if (item.signal && onAbort) {
        item.signal.removeEventListener("abort", onAbort);
      }
      resolve(result);
    };
    onAbort = () => finish("cancel");
    item.cancelWait = () => finish("cancel");
    item.signal?.addEventListener("abort", onAbort, { once: true });
    void clock.sleep(ms).then(
      () => finish(item.settled || item.signal?.aborted ? "cancel" : "ready"),
      () => finish("cancel"),
    );
  });
}

let sharedScheduler: LlmRequestScheduler | null = null;

/** Process-wide singleton；routing／digest／gate 同 quota identity 必須共用。 */
export function getSharedLlmRequestScheduler(): LlmRequestScheduler {
  if (!sharedScheduler) {
    sharedScheduler = createLlmRequestScheduler({
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
        gemini: { minStartIntervalMs: GEMINI_MIN_START_INTERVAL_MS },
      },
    });
  }
  return sharedScheduler;
}

/** Test-only：避免跨用例污染 shared singleton。 */
export function resetSharedLlmRequestSchedulerForTests(): void {
  sharedScheduler = null;
}

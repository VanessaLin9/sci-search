/**
 * Process-wide, quota-bucket-aware LLM request-start scheduler（PR #35）。
 *
 * Checkpoint 1：只提供 queue／spacing／429 cooldown primitives；尚未接 production transport。
 * 事故教訓：單一 caller 對 429 自行 sleep 不足——同 quota pool 的其他 gate／worker 仍會繼續送。
 *
 * Contracts:
 * - `schedule()` Promise = 排隊 + execute settled（成功／失敗／取消），不是只 enqueue。
 * - Spacing 以 request **start** 計算；長 request 可 overlap（rate ≠ completion serialization）。
 * - Bucket id = opaque quota identity；spacing policy 必須另外傳入，不得用 id 字面值推 provider。
 * - 不同 bucket 完全獨立（lastStart / blockedUntil 不共用；NVIDIA 429 不得擋 Gemini）。
 * - 429 → bucket-wide cooldown，再把原始 error rethrow；scheduler 不自動無限 retry。
 */
import type { Clock } from "../routing/clock.js";
import { systemClock } from "../routing/clock.js";
import { classifyRoutingFailure } from "../routing/classifyRoutingFailure.js";
import {
  planRateLimitWait,
  type RateLimitWaitPlan,
} from "../routing/routingRetryPolicy.js";

/** NVIDIA integrate API：保守 2,000 ms start-to-start（~30 RPM；quota 40 RPM）。 */
export const NVIDIA_MIN_START_INTERVAL_MS = 2_000;
/** Gemini project：保守 5,000 ms start-to-start（~12 RPM；AI Studio active 15 RPM）。 */
export const GEMINI_MIN_START_INTERVAL_MS = 5_000;

export type LlmQuotaBucketPolicy = {
  minStartIntervalMs: number;
};

/** Built-in NVIDIA spacing policy（可掛在任意 fingerprinted NVIDIA quota id）。 */
export const NVIDIA_LLM_RATE_POLICY: LlmQuotaBucketPolicy = {
  minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS,
};

/** Built-in Gemini spacing policy（可掛在任意 fingerprinted Gemini project id）。 */
export const GEMINI_LLM_RATE_POLICY: LlmQuotaBucketPolicy = {
  minStartIntervalMs: GEMINI_MIN_START_INTERVAL_MS,
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

/** Permit 發放當下的觀測資訊（queue wait vs HTTP duration 分離；PR #35）。 */
export type LlmSchedulePermitContext = {
  queuedMs: number;
  /** Grant 是否曾被 bucket-wide 429 cooldown 延後（相對 spacing）。 */
  waitedForCooldown: boolean;
  /** 與同 bucket 前一發 start 的間隔；首發為 null。 */
  gapMs: number | null;
};

/** Emitted when a 429 updates（or attempts to update）bucket-wide cooldown（PR #35）。 */
export type LlmCooldownUpdateEvent = {
  bucket: string;
  source: RateLimitWaitPlan["source"];
  waitMs: number;
  previousBlockedUntilMs: number;
  blockedUntilMs: number;
  /** False when a shorter plan did not move blockedUntil. */
  changed: boolean;
};

export type ScheduleLlmRequestOptions<T> = {
  /**
   * Opaque quota identity（provider/base/credential fingerprint）。
   * 同 id 共用 spacing／cooldown；不得用此字串推導 provider policy。
   */
  bucket: string;
  /**
   * Start-spacing policy for this quota bucket（PR #35）。
   * 與 bucket id 分離：fingerprinted Gemini id 仍可掛 GEMINI_LLM_RATE_POLICY。
   * 同一 bucket 後續 schedule 的 policy 必須一致。
   */
  policy: LlmQuotaBucketPolicy;
  /** Absolute deadline on the injected clock；permit 前超時則永不 execute。 */
  deadlineAtMs?: number;
  signal?: AbortSignal;
  execute: (context: LlmSchedulePermitContext) => Promise<T>;
  /** Observability for terminal 429（不等下一發 permit 才看得到 cooldown）（PR #35）。 */
  onCooldownUpdate?: (event: LlmCooldownUpdateEvent) => void;
};

export type LlmRequestScheduler = {
  schedule: <T>(options: ScheduleLlmRequestOptions<T>) => Promise<T>;
  /** Test／觀測：該 bucket 目前 blockedUntil（無此 bucket 時為 0）。 */
  getBlockedUntilMs: (bucket: string) => number;
  /** Test／觀測：queue 深度（不含 in-flight；無此 bucket 時為 0）。 */
  getQueueSize: (bucket: string) => number;
};

export type CreateLlmRequestSchedulerOptions = {
  clock?: Clock;
  /** Injected jitter for default 429 wait（tests: `() => 0`）。 */
  jitterMs?: () => number;
};

type QueueItem<T> = {
  bucketId: string;
  execute: (context: LlmSchedulePermitContext) => Promise<T>;
  enqueuedAtMs: number;
  deadlineAtMs?: number;
  signal?: AbortSignal;
  onCooldownUpdate?: (event: LlmCooldownUpdateEvent) => void;
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
    "LLM request deadline reached while queued for rate limit; request was not sent",
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

function validatePolicy(policy: LlmQuotaBucketPolicy): number {
  const interval = policy.minStartIntervalMs;
  if (!Number.isFinite(interval) || interval < 0) {
    throw new LlmRequestSchedulerError(
      "invariant",
      `invalid LLM rate policy minStartIntervalMs=${String(interval)}`,
    );
  }
  return interval;
}

export function createLlmRequestScheduler(
  options: CreateLlmRequestSchedulerOptions = {},
): LlmRequestScheduler {
  const clock = options.clock ?? systemClock;
  const jitterMs = options.jitterMs ?? (() => Math.floor(Math.random() * 1_000));

  const buckets = new Map<string, BucketState>();

  function getBucket(bucketId: string): BucketState | undefined {
    return buckets.get(bucketId);
  }

  function getOrCreateBucket(bucketId: string, policy: LlmQuotaBucketPolicy): BucketState {
    const minStartIntervalMs = validatePolicy(policy);
    const existing = buckets.get(bucketId);
    if (existing) {
      // 同一 quota identity 不得中途換 spacing，避免「fingerprint id + 錯 policy」 silently 降級（PR #35）。
      if (existing.minStartIntervalMs !== minStartIntervalMs) {
        throw new LlmRequestSchedulerError(
          "invariant",
          `LLM quota bucket "${bucketId}" already uses minStartIntervalMs=${existing.minStartIntervalMs}, ` +
            `got ${minStartIntervalMs}`,
        );
      }
      return existing;
    }
    const created: BucketState = {
      id: bucketId,
      minStartIntervalMs,
      lastStartMs: null,
      blockedUntilMs: 0,
      queue: [],
      pumping: false,
    };
    buckets.set(bucketId, created);
    return created;
  }

  function applyRateLimitCooldown(
    bucket: BucketState,
    error: unknown,
    onCooldownUpdate?: (event: LlmCooldownUpdateEvent) => void,
  ): void {
    // 重用 routing 的 429 header／default+jitter 政策，避免另寫一套不一致的 parser（PR #35）。
    const failure = classifyRoutingFailure(error);
    if (failure.kind !== "rate_limit") return;
    const plan = planRateLimitWait({
      headers: failure.headers,
      nowMs: clock.now(),
      jitterMs,
    });
    const previousBlockedUntilMs = bucket.blockedUntilMs;
    // 較短的新 cooldown 不得覆蓋較長既有 blockedUntil（PR #35）。
    const nextBlockedUntil = clock.now() + plan.waitMs;
    bucket.blockedUntilMs = Math.max(bucket.blockedUntilMs, nextBlockedUntil);
    // Observer 失敗不得阻斷 settle；cooldown 狀態已更新（PR #35）。
    try {
      onCooldownUpdate?.({
        bucket: bucket.id,
        source: plan.source,
        waitMs: plan.waitMs,
        previousBlockedUntilMs,
        blockedUntilMs: bucket.blockedUntilMs,
        changed: bucket.blockedUntilMs !== previousBlockedUntilMs,
      });
    } catch {
      // best-effort diagnostics only
    }
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
    const bucket = getBucket(item.bucketId);
    if (bucket) removeFromQueue(bucket, item);
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

  async function runExecute(
    bucket: BucketState,
    item: QueueItem<unknown>,
    context: LlmSchedulePermitContext,
  ): Promise<void> {
    try {
      const value = await item.execute(context);
      settleResolve(item, value);
    } catch (error) {
      // void runExecute：cooldown／observer 若 throw 會讓 schedule() 永遠 pending（PR #35）。
      try {
        applyRateLimitCooldown(bucket, error, item.onCooldownUpdate);
      } catch {
        // best-effort：仍必須把原始 error 交回 caller
      }
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

        // Grant 後立刻可排下一發的 spacing；不等 execute 完成（PR #35）。
        bucket.queue.shift();
        clearAbortListener(item);
        const startAt = clock.now();
        const spacingEarliest =
          bucket.lastStartMs == null
            ? item.enqueuedAtMs
            : bucket.lastStartMs + bucket.minStartIntervalMs;
        const context: LlmSchedulePermitContext = {
          queuedMs: Math.max(0, startAt - item.enqueuedAtMs),
          waitedForCooldown: bucket.blockedUntilMs > spacingEarliest,
          gapMs: bucket.lastStartMs == null ? null : startAt - bucket.lastStartMs,
        };
        bucket.lastStartMs = startAt;
        void runExecute(bucket, item, context);
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
    return new Promise<T>((resolve, reject) => {
      let bucket: BucketState;
      try {
        bucket = getOrCreateBucket(options.bucket, options.policy);
      } catch (error) {
        reject(error);
        return;
      }

      const item: QueueItem<T> = {
        bucketId: options.bucket,
        execute: options.execute,
        enqueuedAtMs: clock.now(),
        deadlineAtMs: options.deadlineAtMs,
        signal: options.signal,
        onCooldownUpdate: options.onCooldownUpdate,
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
    getBlockedUntilMs: (bucketId: string) => getBucket(bucketId)?.blockedUntilMs ?? 0,
    getQueueSize: (bucketId: string) => getBucket(bucketId)?.queue.length ?? 0,
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

/** Process-wide singleton：routing／digest client 即使是不同 OpenAI instance，同 quota 仍須共用（PR #35）。 */
export function getSharedLlmRequestScheduler(): LlmRequestScheduler {
  if (!sharedScheduler) {
    sharedScheduler = createLlmRequestScheduler();
  }
  return sharedScheduler;
}

/** Test-only：避免跨用例污染 shared singleton。 */
export function resetSharedLlmRequestSchedulerForTests(): void {
  sharedScheduler = null;
}

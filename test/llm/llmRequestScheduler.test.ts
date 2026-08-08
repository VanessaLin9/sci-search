import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RateLimitError } from "openai/core/error.js";
import {
  createLlmRequestScheduler,
  GEMINI_MIN_START_INTERVAL_MS,
  LlmRequestSchedulerError,
  NVIDIA_MIN_START_INTERVAL_MS,
  resetSharedLlmRequestSchedulerForTests,
} from "../../src/llm/llmRequestScheduler.js";
import { DEFAULT_RATE_LIMIT_WAIT_MS } from "../../src/routing/routingRetryPolicy.js";
import type { Clock } from "../../src/routing/clock.js";
import { createFakeClock } from "../routing/helpers/fakeClock.js";

function rateLimitError(retryAfterSeconds?: number): RateLimitError {
  const headers =
    retryAfterSeconds == null
      ? new Headers()
      : new Headers({ "retry-after": String(retryAfterSeconds) });
  return new RateLimitError(429, { message: "rate limited" }, "rate limited", headers);
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Sleep 不自動前進；測試可在排隊中觀察狀態，再 `advance` 放行。 */
function createManualClock(startMs = 1_000_000): Clock & {
  advance(ms: number): void;
  readonly pendingSleeps: number[];
} {
  let now = startMs;
  const waiters: { until: number; resolve: () => void }[] = [];
  const pendingSleeps: number[] = [];

  return {
    get pendingSleeps() {
      return pendingSleeps;
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
      const ready = waiters.filter((waiter) => waiter.until <= now);
      for (const waiter of ready) {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        waiter.resolve();
      }
    },
    async sleep(ms: number) {
      pendingSleeps.push(ms);
      const until = now + ms;
      if (until <= now) return;
      await new Promise<void>((resolve) => {
        waiters.push({ until, resolve });
      });
    },
  };
}

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("llmRequestScheduler", { concurrency: false }, () => {
  test("same bucket spaces request starts by min interval (NVIDIA 2s)", async () => {
    const clock = createFakeClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
      },
    });
    const starts: number[] = [];

    const first = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push(clock.now());
        return "a";
      },
    });
    const second = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push(clock.now());
        return "b";
      },
    });

    assert.deepEqual(await Promise.all([first, second]), ["a", "b"]);
    assert.equal(starts.length, 2);
    assert.ok(starts[1]! - starts[0]! >= NVIDIA_MIN_START_INTERVAL_MS);
    assert.deepEqual(clock.sleeps, [NVIDIA_MIN_START_INTERVAL_MS]);
  });

  test("different buckets do not wait on each other; Gemini uses 5s policy", async () => {
    const clock = createFakeClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
        gemini: { minStartIntervalMs: GEMINI_MIN_START_INTERVAL_MS },
      },
    });
    const starts: { bucket: string; at: number }[] = [];

    const nvidiaA = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push({ bucket: "nvidia", at: clock.now() });
        return "n1";
      },
    });
    const geminiA = scheduler.schedule({
      bucket: "gemini",
      execute: async () => {
        starts.push({ bucket: "gemini", at: clock.now() });
        return "g1";
      },
    });
    const nvidiaB = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push({ bucket: "nvidia", at: clock.now() });
        return "n2";
      },
    });
    const geminiB = scheduler.schedule({
      bucket: "gemini",
      execute: async () => {
        starts.push({ bucket: "gemini", at: clock.now() });
        return "g2";
      },
    });

    await Promise.all([nvidiaA, geminiA, nvidiaB, geminiB]);

    const nvidiaStarts = starts.filter((s) => s.bucket === "nvidia").map((s) => s.at);
    const geminiStarts = starts.filter((s) => s.bucket === "gemini").map((s) => s.at);
    assert.equal(nvidiaStarts.length, 2);
    assert.equal(geminiStarts.length, 2);
    assert.ok(nvidiaStarts[1]! - nvidiaStarts[0]! >= NVIDIA_MIN_START_INTERVAL_MS);
    assert.ok(geminiStarts[1]! - geminiStarts[0]! >= GEMINI_MIN_START_INTERVAL_MS);
    // First starts of each bucket can share the same clock instant (no cross-bucket block).
    assert.equal(nvidiaStarts[0], geminiStarts[0]);
  });

  test("FIFO ordering within a bucket", async () => {
    const clock = createFakeClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      defaultMinStartIntervalMs: 10,
    });
    const order: string[] = [];

    const tasks = ["a", "b", "c"].map((id) =>
      scheduler.schedule({
        bucket: "fifo",
        execute: async () => {
          order.push(id);
          return id;
        },
      }),
    );
    await Promise.all(tasks);
    assert.deepEqual(order, ["a", "b", "c"]);
  });

  test("long requests may overlap; rate limit is start spacing not completion serialization", async () => {
    const clock = createManualClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
      },
    });

    const firstDone = deferred<void>();
    const starts: number[] = [];

    const firstPromise = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push(clock.now());
        await firstDone.promise;
        return "slow";
      },
    });
    await flushMicrotasks();
    assert.deepEqual(starts, [1_000_000]);

    const secondPromise = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push(clock.now());
        return "fast";
      },
    });
    await flushMicrotasks();
    assert.equal(starts.length, 1);
    assert.deepEqual(clock.pendingSleeps, [NVIDIA_MIN_START_INTERVAL_MS]);

    clock.advance(NVIDIA_MIN_START_INTERVAL_MS);
    await flushMicrotasks();
    assert.equal(await secondPromise, "fast");
    assert.equal(starts.length, 2);
    assert.ok(starts[1]! - starts[0]! >= NVIDIA_MIN_START_INTERVAL_MS);
    assert.equal(
      await Promise.race([firstPromise.then(() => "done"), Promise.resolve("pending")]),
      "pending",
    );

    firstDone.resolve();
    assert.equal(await firstPromise, "slow");
  });

  test("schedule() does not settle while queued; settles only after execute settles", async () => {
    const clock = createManualClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
      },
    });

    const firstHold = deferred<string>();
    const first = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => firstHold.promise,
    });
    await flushMicrotasks();

    let secondExecuteStarted = false;
    let secondSettled = false;
    const secondHold = deferred<string>();
    const second = scheduler
      .schedule({
        bucket: "nvidia",
        execute: async () => {
          secondExecuteStarted = true;
          return secondHold.promise;
        },
      })
      .then((value) => {
        secondSettled = true;
        return value;
      });

    await flushMicrotasks();
    assert.equal(secondExecuteStarted, false);
    assert.equal(secondSettled, false);
    assert.equal(scheduler.getQueueSize("nvidia"), 1);

    clock.advance(NVIDIA_MIN_START_INTERVAL_MS);
    await flushMicrotasks();
    assert.equal(secondExecuteStarted, true);
    assert.equal(secondSettled, false);

    secondHold.resolve("second");
    assert.equal(await second, "second");
    assert.equal(secondSettled, true);

    firstHold.resolve("first");
    assert.equal(await first, "first");
  });

  test("execute throw/reject is returned to the original caller", async () => {
    const clock = createFakeClock();
    const scheduler = createLlmRequestScheduler({ clock, jitterMs: () => 0 });
    const error = new Error("boom");

    await assert.rejects(
      () =>
        scheduler.schedule({
          bucket: "nvidia",
          execute: async () => {
            throw error;
          },
        }),
      (caught: unknown) => caught === error,
    );
  });

  test("queued abort never executes", async () => {
    const clock = createManualClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
      },
    });

    const hold = deferred<string>();
    const first = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => hold.promise,
    });
    await flushMicrotasks();

    const controller = new AbortController();
    let executed = false;
    const second = scheduler.schedule({
      bucket: "nvidia",
      signal: controller.signal,
      execute: async () => {
        executed = true;
        return "nope";
      },
    });
    await flushMicrotasks();
    assert.equal(scheduler.getQueueSize("nvidia"), 1);

    controller.abort();
    await assert.rejects(second, (error: unknown) => {
      assert.ok(error instanceof LlmRequestSchedulerError);
      assert.equal(error.kind, "aborted");
      return true;
    });
    assert.equal(executed, false);
    assert.equal(scheduler.getQueueSize("nvidia"), 0);

    hold.resolve("first");
    assert.equal(await first, "first");
  });

  test("deadline before permit never executes", async () => {
    const clock = createManualClock(1_000_000);
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
      },
    });

    const hold = deferred<string>();
    const first = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => hold.promise,
    });
    await flushMicrotasks();

    let executed = false;
    const second = scheduler.schedule({
      bucket: "nvidia",
      deadlineAtMs: clock.now() + 500,
      execute: async () => {
        executed = true;
        return "late";
      },
    });
    await flushMicrotasks();
    // Sleep is capped to remaining deadline (500ms), then item expires without execute.
    clock.advance(500);
    await flushMicrotasks();

    await assert.rejects(second, (error: unknown) => {
      assert.ok(error instanceof LlmRequestSchedulerError);
      assert.equal(error.kind, "deadline");
      return true;
    });
    assert.equal(executed, false);

    hold.resolve("first");
    assert.equal(await first, "first");
  });

  test("permit/abort race settles exactly once", async () => {
    const clock = createManualClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      defaultMinStartIntervalMs: 1_000,
    });

    const hold = deferred<string>();
    const first = scheduler.schedule({
      bucket: "race",
      execute: async () => hold.promise,
    });
    await flushMicrotasks();

    const controller = new AbortController();
    let executeCount = 0;
    let settleCount = 0;

    const pending = scheduler
      .schedule({
        bucket: "race",
        signal: controller.signal,
        execute: async () => {
          executeCount += 1;
          return "x";
        },
      })
      .then(
        () => {
          settleCount += 1;
          return "resolved";
        },
        () => {
          settleCount += 1;
          return "rejected";
        },
      );
    await flushMicrotasks();

    // Abort and spacing permit become ready in the same turn — exactly one settle, no execute.
    controller.abort();
    clock.advance(1_000);
    await flushMicrotasks();

    const outcome = await pending;
    assert.equal(outcome, "rejected");
    assert.equal(settleCount, 1);
    assert.equal(executeCount, 0);

    hold.resolve("first");
    assert.equal(await first, "first");
  });

  test("429 updates whole-bucket cooldown and delays already-queued items", async () => {
    const clock = createFakeClock(1_000_000);
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
      },
    });

    const starts: number[] = [];
    const first = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push(clock.now());
        throw rateLimitError(10);
      },
    });

    const second = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        starts.push(clock.now());
        return "ok";
      },
    });

    await assert.rejects(first, (error: unknown) => error instanceof RateLimitError);
    assert.equal(await second, "ok");
    assert.equal(starts.length, 2);
    // Cooldown 10s dominates the 2s spacing.
    assert.ok(starts[1]! - starts[0]! >= 10_000);
    assert.ok(scheduler.getBlockedUntilMs("nvidia") >= starts[0]! + 10_000);
  });

  test("Gemini 429 does not delay NVIDIA queued items", async () => {
    const clock = createManualClock(1_000_000);
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      bucketPolicies: {
        nvidia: { minStartIntervalMs: NVIDIA_MIN_START_INTERVAL_MS },
        gemini: { minStartIntervalMs: GEMINI_MIN_START_INTERVAL_MS },
      },
    });

    const nvidiaHold = deferred<string>();
    const nvidiaStarts: number[] = [];

    const geminiFail = scheduler.schedule({
      bucket: "gemini",
      execute: async () => {
        throw rateLimitError(30);
      },
    });

    const nvidiaFirst = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        nvidiaStarts.push(clock.now());
        return nvidiaHold.promise;
      },
    });
    await flushMicrotasks();
    await assert.rejects(geminiFail, (error: unknown) => error instanceof RateLimitError);
    assert.ok(scheduler.getBlockedUntilMs("gemini") >= 1_000_000 + 30_000);
    assert.equal(scheduler.getBlockedUntilMs("nvidia"), 0);

    const nvidiaSecond = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        nvidiaStarts.push(clock.now());
        return "n2";
      },
    });
    await flushMicrotasks();
    assert.equal(nvidiaStarts.length, 1);

    clock.advance(NVIDIA_MIN_START_INTERVAL_MS);
    await flushMicrotasks();
    assert.equal(await nvidiaSecond, "n2");
    assert.equal(nvidiaStarts.length, 2);
    assert.ok(nvidiaStarts[1]! - nvidiaStarts[0]! >= NVIDIA_MIN_START_INTERVAL_MS);
    assert.ok(nvidiaStarts[1]! - nvidiaStarts[0]! < 30_000);

    nvidiaHold.resolve("n1");
    assert.equal(await nvidiaFirst, "n1");
  });

  test("shorter new cooldown does not overwrite a longer blockedUntil", async () => {
    const clock = createManualClock(1_000_000);
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      defaultMinStartIntervalMs: 0,
    });

    const firstHold = deferred<void>();
    const first = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        await firstHold.promise;
        throw rateLimitError(5);
      },
    });
    await flushMicrotasks();

    const second = scheduler.schedule({
      bucket: "nvidia",
      execute: async () => {
        throw rateLimitError(40);
      },
    });
    await flushMicrotasks();
    await assert.rejects(second, (error: unknown) => error instanceof RateLimitError);
    assert.equal(scheduler.getBlockedUntilMs("nvidia"), 1_000_000 + 40_000);

    firstHold.resolve();
    await assert.rejects(first, (error: unknown) => error instanceof RateLimitError);
    assert.equal(scheduler.getBlockedUntilMs("nvidia"), 1_000_000 + 40_000);
  });

  test("429 without headers uses bounded default wait + injected jitter", async () => {
    const clock = createFakeClock(1_000_000);
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 250,
      defaultMinStartIntervalMs: 0,
    });

    await assert.rejects(
      () =>
        scheduler.schedule({
          bucket: "nvidia",
          execute: async () => {
            throw rateLimitError();
          },
        }),
      (error: unknown) => error instanceof RateLimitError,
    );

    assert.equal(
      scheduler.getBlockedUntilMs("nvidia"),
      1_000_000 + DEFAULT_RATE_LIMIT_WAIT_MS + 250,
    );
  });

  test("non-429 errors do not update bucket cooldown", async () => {
    const clock = createFakeClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      defaultMinStartIntervalMs: 0,
    });

    await assert.rejects(
      () =>
        scheduler.schedule({
          bucket: "nvidia",
          execute: async () => {
            throw new Error("server exploded");
          },
        }),
      /server exploded/,
    );
    assert.equal(scheduler.getBlockedUntilMs("nvidia"), 0);
  });

  test("scheduler does not auto-retry after 429", async () => {
    const clock = createFakeClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      defaultMinStartIntervalMs: 0,
    });
    let attempts = 0;

    await assert.rejects(
      () =>
        scheduler.schedule({
          bucket: "nvidia",
          execute: async () => {
            attempts += 1;
            throw rateLimitError(1);
          },
        }),
      (error: unknown) => error instanceof RateLimitError,
    );
    assert.equal(attempts, 1);
  });

  test("completed and cancelled items are removed from the queue", async () => {
    const clock = createFakeClock();
    const scheduler = createLlmRequestScheduler({
      clock,
      jitterMs: () => 0,
      defaultMinStartIntervalMs: 0,
    });

    assert.equal(await scheduler.schedule({ bucket: "nvidia", execute: async () => 1 }), 1);
    assert.equal(scheduler.getQueueSize("nvidia"), 0);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        scheduler.schedule({
          bucket: "nvidia",
          signal: controller.signal,
          execute: async () => 2,
        }),
      (error: unknown) => error instanceof LlmRequestSchedulerError,
    );
    assert.equal(scheduler.getQueueSize("nvidia"), 0);
  });

  test("resetSharedLlmRequestSchedulerForTests clears singleton", () => {
    resetSharedLlmRequestSchedulerForTests();
  });
});

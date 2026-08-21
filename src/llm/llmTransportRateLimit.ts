/**
 * Shared LLM transport rate-limit wiring（PR #35）。
 * 每次真正 HTTP attempt 經 scheduler；JSON fallback／domain retry 各自重新排隊。
 * Bucket id 與 spacing policy 分離——fingerprint Gemini id 仍掛 5s，不會掉回 NVIDIA 2s。
 *
 * Production create exits（caller audit；勿新增 bypass）:
 * - callRoutingCompletion / callBiorxivGateCompletion / callDigestTaggingCompletion / callDigestChatCompletion / callSpatialClassifyCompletion
 *   → createChatCompletionWithJsonResponseFormatFallback → scheduleLlmTransportAttempt
 * - runProbeDigestSmoke → scheduleLlmTransportAttempt
 * OpenAI clients：routingLlmClient / digestLlmClient only。
 */
import type { Clock } from "../routing/clock.js";
import {
  createLlmRequestScheduler,
  getSharedLlmRequestScheduler,
  resetSharedLlmRequestSchedulerForTests,
  type LlmCooldownUpdateEvent,
  type LlmQuotaBucketPolicy,
  type LlmRequestScheduler,
  type LlmSchedulePermitContext,
} from "./llmRequestScheduler.js";
import { resolveLlmQuotaTarget, type ResolvedLlmQuotaTarget } from "./llmQuotaBucket.js";

export type LlmTransportRateLimitOptions = {
  baseUrl: string;
  apiKey: string;
  /** Absolute queue deadline on the scheduler clock；逾時則不送出。 */
  resolveDeadlineAtMs?: () => number | undefined;
  signal?: AbortSignal;
  /** Optional logger for cooldown updates（通常接 routing/digest log）。 */
  log?: (message: string) => void;
};

type TestOverrides = {
  scheduler: LlmRequestScheduler;
  /** When set, replaces resolved provider policy（tests usually use 0 spacing）. */
  policy?: LlmQuotaBucketPolicy;
};

let testOverrides: TestOverrides | null = null;

/** Test harness clock：sleep 立刻前進，避免 429 cooldown 真的卡住 CI。 */
function createAutoAdvanceClock(startMs = 1_000_000): Clock {
  let now = startMs;
  return {
    now: () => now,
    async sleep(ms: number) {
      now += ms;
    },
  };
}

/** Offline tests：安裝可注入 clock 的 scheduler。預設 0-spacing；CP2 整合測試可改用 provider policies。 */
export function installLlmRateLimitTestHarness(options?: {
  minStartIntervalMs?: number;
  /** Keep NVIDIA 2s / Gemini 5s from resolveLlmQuotaTarget（不覆蓋 policy）。 */
  useProviderPolicies?: boolean;
  scheduler?: LlmRequestScheduler;
  clock?: Clock;
}): void {
  testOverrides = {
    scheduler:
      options?.scheduler ??
      createLlmRequestScheduler({
        clock: options?.clock ?? createAutoAdvanceClock(),
        jitterMs: () => 0,
      }),
    policy: options?.useProviderPolicies
      ? undefined
      : { minStartIntervalMs: options?.minStartIntervalMs ?? 0 },
  };
}

export function resetLlmRateLimitTestHarness(): void {
  testOverrides = null;
  resetSharedLlmRequestSchedulerForTests();
}

function resolveScheduler(): LlmRequestScheduler {
  return testOverrides?.scheduler ?? getSharedLlmRequestScheduler();
}

export function resolveTransportQuotaTarget(
  options: LlmTransportRateLimitOptions,
): ResolvedLlmQuotaTarget {
  const target = resolveLlmQuotaTarget(options.baseUrl, options.apiKey);
  if (testOverrides?.policy) {
    return { ...target, policy: testOverrides.policy };
  }
  return target;
}

/**
 * Run one HTTP attempt under the shared quota scheduler.
 * `execute` 只在取得 permit 後呼叫；429 cooldown 由 scheduler 更新後再 rethrow。
 * Queue deadline／abort 保留 `LlmRequestSchedulerError` kind，供 domain 開 budget_exhausted（PR #35）。
 */
export async function scheduleLlmTransportAttempt<T>(
  options: LlmTransportRateLimitOptions,
  execute: (context: LlmSchedulePermitContext, target: ResolvedLlmQuotaTarget) => Promise<T>,
): Promise<T> {
  const target = resolveTransportQuotaTarget(options);
  const scheduler = resolveScheduler();
  const deadlineAtMs = options.resolveDeadlineAtMs?.();

  return scheduler.schedule({
    bucket: target.bucket,
    policy: target.policy,
    deadlineAtMs,
    signal: options.signal,
    execute: (context) => execute(context, target),
    onCooldownUpdate: options.log
      ? (event) => options.log!(formatRateLimitCooldownLog({ target, event }))
      : undefined,
  });
}

export function formatRateLimitPermitLog(options: {
  target: ResolvedLlmQuotaTarget;
  context: LlmSchedulePermitContext;
}): string {
  const { target, context } = options;
  const permit = context.waitedForCooldown ? "429-cooldown" : "spacing";
  const gap =
    context.gapMs == null ? "first" : `${(context.gapMs / 1000).toFixed(1)}s`;
  return (
    `rateLimit bucket=${target.logLabel} permit=${permit} ` +
    `queuedMs=${context.queuedMs} gap=${gap} intervalMs=${target.policy.minStartIntervalMs}`
  );
}

export function formatRateLimitCooldownLog(options: {
  target: ResolvedLlmQuotaTarget;
  event: LlmCooldownUpdateEvent;
}): string {
  const { target, event } = options;
  return (
    `rateLimit cooldown bucket=${target.logLabel} source=${event.source} ` +
    `waitMs=${event.waitMs} previousBlockedUntil=${event.previousBlockedUntilMs} ` +
    `blockedUntil=${event.blockedUntilMs} changed=${event.changed ? "yes" : "no"}`
  );
}

import type { ChatCompletion } from "openai/resources/chat/completions";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
  type LlmRequestTimingMeta,
} from "./llmRequestTiming.js";
import {
  formatRateLimitPermitLog,
  scheduleLlmTransportAttempt,
  type LlmTransportRateLimitOptions,
} from "./llmTransportRateLimit.js";

export type JsonResponseFormatCompletionResult = {
  completion: ChatCompletion;
  usedJsonResponseFormat: boolean;
  elapsedMs: number;
};

export type CreateChatCompletionWithJsonResponseFormatFallbackOptions = {
  preferJsonResponseFormat: boolean;
  /** Send one chat.completions.create; `useJsonResponseFormat` selects response_format. */
  create: (useJsonResponseFormat: boolean) => Promise<ChatCompletion>;
  log: (message: string) => void;
  label: string;
  formatElapsed: (startedAt: number) => string;
  /**
   * Logged when the first request fails while JSON response format was preferred.
   * Defaults to `${label}: json_object mode failed, retrying without response_format…`
   */
  jsonModeFailedRetryMessage?: string;
  /**
   * When preferJson is true and the first request fails: decide whether to bare-retry.
   * Default `() => true` preserves legacy digest/bioRxiv behavior（PR #21）。
   * Routing 傳入 policy-aware predicate，避免 timeout／429／5xx 繞過 domain retry（PR #28）。
   */
  shouldRetryWithoutJsonResponseFormat?: (error: unknown) => boolean;
  /** RPM / gap timing 標籤（寫進每一發 request ok|failed log）。 */
  timingMeta: LlmRequestTimingMeta;
  /**
   * Shared quota scheduler for each HTTP attempt（PR #35）。
   * 掛在這層（不是 domain 上層）才能涵蓋 json_object 第二發；omit 僅供純 mechanics 單測。
   */
  rateLimit?: LlmTransportRateLimitOptions;
};

/**
 * 共用 JSON `response_format` 請求機制（PR #21 / Phase 4）。
 * 先帶 json_object；若供應商拒收再裸請求一次。
 * 刻意只做 request mechanics——parse / split / domain fallback 留在各 call site，避免吸進業務政策。
 *
 * 每發 HTTP 另記 duration / gap / 60s 視窗次數（診斷快模型撞 RPM；PR #26）；見 `llmRequestTiming.ts`。
 * Call site 可透過 `shouldRetryWithoutJsonResponseFormat` 擋下不該立刻裸重試的失敗（PR #28）。
 *
 * 若提供 `rateLimit`，每一發 create（含 json_object fallback）都重新進 shared scheduler（PR #35）。
 */
export async function createChatCompletionWithJsonResponseFormatFallback(
  options: CreateChatCompletionWithJsonResponseFormatFallbackOptions,
): Promise<JsonResponseFormatCompletionResult> {
  const {
    preferJsonResponseFormat,
    create,
    log,
    label,
    formatElapsed,
    timingMeta,
    rateLimit,
    jsonModeFailedRetryMessage = `${label}: json_object mode failed, retrying without response_format…`,
    shouldRetryWithoutJsonResponseFormat = () => true,
  } = options;

  const startedAt = Date.now();
  let usedJsonResponseFormat = preferJsonResponseFormat;

  let completion: ChatCompletion;
  try {
    completion = await timedCreate(
      create,
      usedJsonResponseFormat,
      log,
      label,
      timingMeta,
      rateLimit,
    );
  } catch (error) {
    if (!preferJsonResponseFormat || !shouldRetryWithoutJsonResponseFormat(error)) {
      log(`${label}: failed after ${formatElapsed(startedAt)}`);
      throw error;
    }

    log(jsonModeFailedRetryMessage);
    usedJsonResponseFormat = false;
    completion = await timedCreate(create, false, log, label, timingMeta, rateLimit);
  }

  log(`${label}: HTTP ok in ${formatElapsed(startedAt)}`);
  return {
    completion,
    usedJsonResponseFormat,
    elapsedMs: Date.now() - startedAt,
  };
}

async function timedCreate(
  create: (useJsonResponseFormat: boolean) => Promise<ChatCompletion>,
  useJsonResponseFormat: boolean,
  log: (message: string) => void,
  label: string,
  timingMeta: LlmRequestTimingMeta,
  rateLimit: LlmTransportRateLimitOptions | undefined,
): Promise<ChatCompletion> {
  const run = async (): Promise<ChatCompletion> => {
    // note 在真正 HTTP start（取得 permit 後），不要把 queue wait 算進 provider duration（PR #35）。
    const timing = noteLlmRequestStart();
    try {
      const completion = await create(useJsonResponseFormat);
      log(`${label}: request ok · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
      return completion;
    } catch (error) {
      log(`${label}: request failed · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
      throw error;
    }
  };

  if (!rateLimit) {
    return run();
  }

  return scheduleLlmTransportAttempt(
    {
      ...rateLimit,
      // 429 當下就打 cooldown 診斷，不要等下一發 permit（PR #35）。
      log: (message) => log(`${label}: ${message}`),
    },
    async (context, target) => {
      log(`${label}: ${formatRateLimitPermitLog({ target, context })}`);
      return run();
    },
  );
}

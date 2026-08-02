import type { ChatCompletion } from "openai/resources/chat/completions";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
  type LlmRequestTimingMeta,
} from "./llmRequestTiming.js";

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
};

/**
 * 共用 JSON `response_format` 請求機制（PR #21 / Phase 4）。
 * 先帶 json_object；若供應商拒收再裸請求一次。
 * 刻意只做 request mechanics——parse / split / domain fallback 留在各 call site，避免吸進業務政策。
 *
 * 每發 HTTP 另記 duration / gap / 60s 視窗次數（診斷快模型撞 RPM；PR #26）；見 `llmRequestTiming.ts`。
 * Call site 可透過 `shouldRetryWithoutJsonResponseFormat` 擋下不該立刻裸重試的失敗（PR #28）。
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
    jsonModeFailedRetryMessage = `${label}: json_object mode failed, retrying without response_format…`,
    shouldRetryWithoutJsonResponseFormat = () => true,
  } = options;

  const startedAt = Date.now();
  let usedJsonResponseFormat = preferJsonResponseFormat;

  let completion: ChatCompletion;
  try {
    completion = await timedCreate(create, usedJsonResponseFormat, log, label, timingMeta);
  } catch (error) {
    if (!preferJsonResponseFormat || !shouldRetryWithoutJsonResponseFormat(error)) {
      log(`${label}: failed after ${formatElapsed(startedAt)}`);
      throw error;
    }

    log(jsonModeFailedRetryMessage);
    usedJsonResponseFormat = false;
    completion = await timedCreate(create, false, log, label, timingMeta);
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
): Promise<ChatCompletion> {
  const timing = noteLlmRequestStart();
  try {
    const completion = await create(useJsonResponseFormat);
    log(`${label}: request ok · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
    return completion;
  } catch (error) {
    log(`${label}: request failed · ${formatLlmRequestTimingSuffix(timing, timingMeta)}`);
    throw error;
  }
}

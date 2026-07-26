import type { ChatCompletion } from "openai/resources/chat/completions";

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
};

/**
 * 共用 JSON `response_format` 請求機制（PR #21 / Phase 4）。
 * 先帶 json_object；若供應商拒收再裸請求一次。
 * 刻意只做 request mechanics——parse / split / domain fallback 留在各 call site，避免吸進業務政策。
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
    jsonModeFailedRetryMessage = `${label}: json_object mode failed, retrying without response_format…`,
  } = options;

  const startedAt = Date.now();
  let usedJsonResponseFormat = preferJsonResponseFormat;

  let completion: ChatCompletion;
  try {
    completion = await create(usedJsonResponseFormat);
  } catch (error) {
    if (!preferJsonResponseFormat) {
      log(`${label}: failed after ${formatElapsed(startedAt)}`);
      throw error;
    }

    log(jsonModeFailedRetryMessage);
    usedJsonResponseFormat = false;
    completion = await create(false);
  }

  log(`${label}: HTTP ok in ${formatElapsed(startedAt)}`);
  return {
    completion,
    usedJsonResponseFormat,
    elapsedMs: Date.now() - startedAt,
  };
}

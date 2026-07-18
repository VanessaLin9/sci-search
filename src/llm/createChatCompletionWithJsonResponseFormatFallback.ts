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
 * Request mechanics only: try with JSON response format when preferred; on failure,
 * retry once without `response_format`. Callers own params, parse, split, and domain fallback.
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

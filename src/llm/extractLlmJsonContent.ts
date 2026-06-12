import { extractFirstJsonObject } from "../routing/parseLlmJson.js";

type LlmMessage = {
  content?: string | null;
  reasoning_content?: string | null;
};

/**
 * Prefer a parseable JSON object in `content`; otherwise try `reasoning_content`.
 * Never return long analysis prose — that breaks batch calls on reasoning-heavy models.
 */
export function extractLlmJsonContent(message: LlmMessage | undefined): {
  content: string;
  usedReasoningFallback: boolean;
} {
  const rawContent = message?.content?.trim() ?? "";
  const jsonFromContent = extractFirstJsonObject(rawContent);
  if (jsonFromContent) {
    return { content: jsonFromContent, usedReasoningFallback: false };
  }

  if (rawContent.startsWith("{")) {
    return { content: rawContent, usedReasoningFallback: false };
  }

  const reasoning = message?.reasoning_content?.trim() ?? "";
  const jsonFromReasoning = extractFirstJsonObject(reasoning);
  if (jsonFromReasoning) {
    return { content: jsonFromReasoning, usedReasoningFallback: true };
  }

  if (rawContent) {
    throw new Error(
      `LLM message.content has no JSON object (${rawContent.length} chars, preview: ${rawContent.slice(0, 120)}…)`,
    );
  }
  if (reasoning) {
    throw new Error(
      `LLM put output in reasoning only with no JSON (${reasoning.length} chars). Use a model that returns JSON in content, or reduce batch size.`,
    );
  }

  throw new Error("LLM returned empty message content and reasoning_content");
}

export function isRoutingMissingVerdictsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Routing LLM missing verdicts");
}

/** Timeout / connection failures from the routing LLM client — degrade, do not abort the pipeline. */
export function isRoutingBatchRequestFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return (
    name === "APIConnectionTimeoutError" ||
    message.includes("Request timed out") ||
    message.includes("Connection error") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("fetch failed")
  );
}

export function shouldRetrySplitLlmBatch(error: unknown, finishReason: string): boolean {
  if (finishReason === "length") return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("no JSON object") ||
    message.includes("reasoning only") ||
    message.includes("invalid JSON") ||
    message.includes("Routing LLM missing verdicts")
  );
}

import { extractFirstJsonObject } from "../routing/parseLlmJson.js";

type LlmMessage = {
  content?: string | null;
  reasoning_content?: string | null;
};

/**
 * 從 LLM 回傳取出可 parse 的 JSON（PR #9）。
 * 部分 NVIDIA reasoning 模型會把 JSON 放在 `reasoning_content`、`content` 只剩散文；
 * 若直接 parse prose 會弄垮整批 routing/digest。優先 content，否則從 reasoning 抽 `{...}`。
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

/** Routing LLM 傳輸層失敗（timeout/連線）。應 degrade 或拆批，不可 abort daily。PR #15 */
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

/** token length / 壞 JSON / 缺 verdict 等可恢復錯誤 → 對半拆批再試。PR #9 */
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

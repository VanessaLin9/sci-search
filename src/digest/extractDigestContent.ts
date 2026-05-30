import { extractLlmJsonContent } from "../llm/extractLlmJsonContent.js";

type DigestMessage = {
  content?: string | null;
  reasoning_content?: string | null;
};

/** @see extractLlmJsonContent */
export function extractDigestMessageContent(message: DigestMessage | undefined): {
  content: string;
  usedReasoningFallback: boolean;
} {
  try {
    return extractLlmJsonContent(message);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    if (error.message.startsWith("LLM message.content")) {
      throw new Error(error.message.replace(/^LLM /, "Digest LLM "));
    }
    if (error.message.startsWith("LLM put output")) {
      throw new Error(error.message.replace(/^LLM /, "Digest LLM "));
    }
    if (error.message === "LLM returned empty message content and reasoning_content") {
      throw new Error("Digest LLM returned empty message content and reasoning_content");
    }
    throw error;
  }
}

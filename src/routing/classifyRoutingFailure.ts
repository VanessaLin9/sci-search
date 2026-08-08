import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "openai/core/error.js";
import {
  isRoutingBatchRequestFailure,
  shouldRetrySplitLlmBatch,
} from "../llm/extractLlmJsonContent.js";

function isLlmSchedulerDeadlineError(error: unknown): boolean {
  // Avoid importing llmRequestScheduler here（它會用到 classifyRoutingFailure，形成循環）（PR #35）。
  return (
    error instanceof Error &&
    error.name === "LlmRequestSchedulerError" &&
    "kind" in error &&
    (error as { kind: unknown }).kind === "deadline"
  );
}

export type RoutingFailureKind =
  | "timeout"
  | "network"
  | "rate_limit"
  | "server_error"
  | "auth"
  | "config"
  | "length"
  | "parse"
  | "unknown";

export type ClassifiedRoutingFailure = {
  kind: RoutingFailureKind;
  message: string;
  status?: number;
  headers?: unknown;
  finishReason?: string;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finishReasonOf(error: unknown): string | undefined {
  if (error instanceof Error && "finishReason" in error) {
    return String((error as Error & { finishReason: string }).finishReason);
  }
  return undefined;
}

function isConfigErrorMessage(message: string): boolean {
  return (
    message.includes("no API key found") ||
    message.includes("ROUTING_LLM_MODEL is not set") ||
    message.includes("invalid configuration")
  );
}

/**
 * Routing 失敗分類契約（PR #28）：以 SDK status/name 為主、字串 heuristic 為輔。
 * timeout/network 與 parse/length 必須分開——前者開 breaker 且不拆批，後者才可有限 split。
 */
export function classifyRoutingFailure(
  error: unknown,
  finishReason = "unknown",
): ClassifiedRoutingFailure {
  const message = messageOf(error);
  const attachedFinish = finishReasonOf(error) ?? finishReason;

  if (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof Error && error.name === "APIConnectionTimeoutError")
  ) {
    return { kind: "timeout", message, finishReason: attachedFinish };
  }

  if (error instanceof RateLimitError || (error instanceof APIError && error.status === 429)) {
    return {
      kind: "rate_limit",
      message,
      status: 429,
      headers: error instanceof APIError ? error.headers : undefined,
      finishReason: attachedFinish,
    };
  }

  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    (error instanceof APIError && (error.status === 401 || error.status === 403))
  ) {
    return {
      kind: "auth",
      message,
      status: error instanceof APIError ? error.status : undefined,
      headers: error instanceof APIError ? error.headers : undefined,
      finishReason: attachedFinish,
    };
  }

  if (error instanceof APIError && typeof error.status === "number" && error.status >= 500) {
    return {
      kind: "server_error",
      message,
      status: error.status,
      headers: error.headers,
      finishReason: attachedFinish,
    };
  }

  if (
    error instanceof APIConnectionError ||
    (error instanceof Error && error.name === "APIConnectionError")
  ) {
    return { kind: "network", message, finishReason: attachedFinish };
  }

  if (isConfigErrorMessage(message)) {
    return { kind: "config", message, finishReason: attachedFinish };
  }

  // Shared rate-limiter queue expiry：保留可辨識訊息，domain 另開 budget_exhausted（PR #35）。
  if (isLlmSchedulerDeadlineError(error)) {
    return {
      kind: "unknown",
      message: `routing budget exhausted while queued for rate limit (${message})`,
      finishReason: attachedFinish,
    };
  }

  // Plain Error("Request timed out.") from tests / SDK message shapes.
  if (isRoutingBatchRequestFailure(error)) {
    const kind =
      message.includes("Request timed out") ||
      message.includes("ETIMEDOUT") ||
      (error instanceof Error && error.name === "APIConnectionTimeoutError")
        ? "timeout"
        : "network";
    return { kind, message, finishReason: attachedFinish };
  }

  if (attachedFinish === "length") {
    return { kind: "length", message, finishReason: attachedFinish };
  }

  if (shouldRetrySplitLlmBatch(error, attachedFinish)) {
    const kind = attachedFinish === "length" ? "length" : "parse";
    return { kind, message, finishReason: attachedFinish };
  }

  // HTTP 429 surfaced as plain status-bearing errors in some mocks.
  if (error instanceof APIError && error.status === 429) {
    return { kind: "rate_limit", message, status: 429, headers: error.headers };
  }

  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    if (status === 429) {
      return {
        kind: "rate_limit",
        message,
        status,
        headers: "headers" in error ? (error as { headers: unknown }).headers : undefined,
      };
    }
    if (status === 401 || status === 403) {
      return { kind: "auth", message, status };
    }
    if (status >= 500) {
      return { kind: "server_error", message, status };
    }
  }

  return { kind: "unknown", message, finishReason: attachedFinish };
}

export function isTransportFailure(kind: RoutingFailureKind): boolean {
  return kind === "timeout" || kind === "network";
}

export function isFatalProviderFailure(kind: RoutingFailureKind): boolean {
  return kind === "auth" || kind === "config";
}

export function isSplitRecoverableFailure(kind: RoutingFailureKind): boolean {
  return kind === "length" || kind === "parse";
}

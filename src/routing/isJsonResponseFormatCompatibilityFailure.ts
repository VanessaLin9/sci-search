import { APIError } from "openai/core/error.js";

const COMPATIBILITY_STATUSES = new Set([400, 422]);

function messageLooksLikeResponseFormatFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("response_format") ||
    lower.includes("json_object") ||
    lower.includes("json mode") ||
    lower.includes("json object")
  );
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof APIError && typeof error.status === "number") {
    return error.status;
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    return Number.isFinite(status) ? status : undefined;
  }
  return undefined;
}

/**
 * 判斷是否為 json_object / response_format 相容性失敗（PR #28）。
 * 必須同時有 message signal，且 HTTP status 為 400/422（若有 status）。
 * 429／5xx 即使 message 提到 response_format 也不可立刻裸重試，应交回 routing backoff policy。
 * 無 status 的非 SDK Error 若 message 吻合，仍允許作為相容性失敗（測試／特殊錯誤形狀）。
 */
export function isJsonResponseFormatCompatibilityFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!messageLooksLikeResponseFormatFailure(message)) {
    return false;
  }

  const status = statusOf(error);
  if (status === undefined) {
    // 無 status：保守接受已知 message 形狀（非 SDK plain Error）
    return true;
  }
  return COMPATIBILITY_STATUSES.has(status);
}

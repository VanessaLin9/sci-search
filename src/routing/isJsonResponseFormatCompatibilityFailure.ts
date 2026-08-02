/**
 * 判斷是否為 json_object / response_format 相容性失敗（PR #28）。
 * 只有這類錯誤才允許立刻裸請求重試；timeout／429／5xx 必須交回 routing policy，
 * 不可被 shared helper 的「任何首發失敗就裸重試」繞過。
 */
export function isJsonResponseFormatCompatibilityFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("response_format") ||
    message.includes("json_object") ||
    message.includes("json mode") ||
    message.includes("json object")
  );
}

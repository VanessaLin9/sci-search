/**
 * Process-wide LLM HTTP attempt timing（診斷 429 / RPM）。PR #26
 * Daily job 的 routing / bioRxiv / digest 常共用同一 API key，用同一個 60s 視窗計數。
 * 輸出走既有 `[routing]` / `[digest]` / `[biorxiv-gate]` console.log → `gh run view --log` 可回看。
 *
 * Log 固定帶 `gate=` + `callSite=`，方便在 Actions 用 rg 過濾單一邏輯閘。
 */

const WINDOW_MS = 60_000;

const requestStartsMs: number[] = [];

function prune(now: number): void {
  while (requestStartsMs.length > 0 && requestStartsMs[0]! < now - WINDOW_MS) {
    requestStartsMs.shift();
  }
}

/** 哪個邏輯閘 + 哪個函式打出這發 HTTP（寫進每一行 timing log）。 */
export type LlmRequestTimingMeta = {
  /** 例：life-science-routing / biorxiv-gate / digest-tagging / digest-summarize / digest-translate */
  gate: string;
  /** 例：callRoutingCompletion / callDigestChatCompletion */
  callSite: string;
};

export type LlmRequestTimingSample = {
  startedAt: number;
  /** null = 本次 process 第一發 */
  gapSincePreviousStartMs: number | null;
  /** 含本發，過去 60s 內啟動的請求數 */
  requestsInLastMinute: number;
};

/** 在每次即將打 `chat.completions.create`（含 json_object fallback 重試）前記錄。 */
export function noteLlmRequestStart(now = Date.now()): LlmRequestTimingSample {
  const previousStart = requestStartsMs.length > 0 ? requestStartsMs[requestStartsMs.length - 1]! : null;
  requestStartsMs.push(now);
  prune(now);
  return {
    startedAt: now,
    gapSincePreviousStartMs: previousStart === null ? null : now - previousStart,
    requestsInLastMinute: requestStartsMs.length,
  };
}

export function formatLlmRequestTimingSuffix(
  sample: LlmRequestTimingSample,
  meta: LlmRequestTimingMeta,
  endedAt = Date.now(),
): string {
  const durationSec = (endedAt - sample.startedAt) / 1000;
  const duration =
    durationSec >= 60 ? `${(durationSec / 60).toFixed(1)}m` : `${durationSec.toFixed(1)}s`;
  const gap =
    sample.gapSincePreviousStartMs === null
      ? "first"
      : `${(sample.gapSincePreviousStartMs / 1000).toFixed(1)}s`;
  return (
    `gate=${meta.gate} callSite=${meta.callSite} · ` +
    `duration=${duration} gap=${gap} ~${sample.requestsInLastMinute} req/60s`
  );
}

/** 測試用：清空視窗，避免用例互相污染。 */
export function resetLlmRequestTimingForTests(): void {
  requestStartsMs.length = 0;
}

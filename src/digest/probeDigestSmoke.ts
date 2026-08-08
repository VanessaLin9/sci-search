/**
 * Probe smoke HTTP path（PR #35）：必須經 shared rate limiter，不得直打 create。
 * CLI：`probeDigestModel.ts`；offline tests 可直接呼叫本函式。
 */
import {
  formatRateLimitPermitLog,
  scheduleLlmTransportAttempt,
} from "../llm/llmTransportRateLimit.js";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
} from "../llm/llmRequestTiming.js";
import { createDigestLlmClient } from "./digestLlmClient.js";

export type ProbeDigestSmokeResult =
  | { ok: true; content: string; finishReason: string | null | undefined }
  | { ok: false; message: string };

/**
 * Minimal OpenAI-compatible smoke request under the process-wide quota scheduler.
 */
export async function runProbeDigestSmoke(options: {
  model: string;
  apiKey: string;
  baseUrl: string;
  log?: (message: string) => void;
}): Promise<ProbeDigestSmokeResult> {
  const { model, apiKey, baseUrl } = options;
  const log = options.log ?? ((message: string) => console.log(message));
  const client = createDigestLlmClient(
    {
      apiKey,
      baseUrl,
      model,
      maxFeatured: 12,
      overflowShowTitleZh: true,
      maxPapersPerBatch: 8,
      maxInputTokens: 28000,
      maxTokens: 256,
      timeoutMs: 60_000,
      maxRetries: 0,
      summarizeTimeoutMs: 60_000,
      summarizeFallbackTimeoutMs: 60_000,
      summarizeStageBudgetMs: 900_000,
      summarizeMaxRetries: 0,
      summarizeConcurrency: 1,
      summarizeFallbackConcurrency: 1,
      preferJsonResponseFormat: false,
      disableThinking: true,
    },
    { timeoutMs: 60_000, maxRetries: 0 },
  );

  const started = Date.now();
  const timingMeta = { gate: "digest-probe-smoke", callSite: "probeDigestModel.smokeModel" } as const;

  try {
    const completion = await scheduleLlmTransportAttempt(
      {
        baseUrl,
        apiKey,
        log: (message) => log(`[smoke] ${message}`),
      },
      async (context, target) => {
        log(`[smoke] ${formatRateLimitPermitLog({ target, context })}`);
        // note 在取得 permit 後，queue wait 不計入 provider duration（PR #35）。
        const timing = noteLlmRequestStart();
        try {
          const result = await client.chat.completions.create(
            {
              model,
              temperature: 0,
              max_tokens: 32,
              stream: false,
              messages: [{ role: "user", content: 'Reply with exactly: {"ok":true}' }],
            },
            { timeout: 60_000, maxRetries: 0 },
          );
          log(
            `[smoke] ${model}: OK · ${formatLlmRequestTimingSuffix(timing, timingMeta)} · ` +
              `wall=${Date.now() - started}ms · finish=${result.choices[0]?.finish_reason} · ` +
              `${(result.choices[0]?.message?.content ?? "").slice(0, 80)}`,
          );
          return result;
        } catch (error) {
          log(
            `[smoke] ${model}: FAIL · ${formatLlmRequestTimingSuffix(timing, timingMeta)} · ` +
              `wall=${Date.now() - started}ms · ${error instanceof Error ? error.message : error}`,
          );
          throw error;
        }
      },
    );

    return {
      ok: true,
      content: completion.choices[0]?.message?.content ?? "",
      finishReason: completion.choices[0]?.finish_reason,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

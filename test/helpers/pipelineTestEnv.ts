import { installLlmRateLimitTestHarness } from "../../src/llm/llmTransportRateLimit.js";
import type { PipelineRunResult } from "../../src/pipeline.js";
import { toProcessedPapersFile, type ProcessedPapersFile } from "../../src/processedData.js";

export function installPipelineTestEnv(): void {
  process.env.ROUTE_LIFE_SCIENCE = "1";
  process.env.ENABLE_LLM_DIGEST = "1";
  process.env.ROUTING_LLM_API_KEY = "test-routing-key";
  process.env.DIGEST_LLM_API_KEY = "test-digest-key";
  process.env.ROUTING_LLM_MODEL = "test-model";
  process.env.DIGEST_LLM_MODEL = "test-model";
  process.env.DIGEST_LLM_FALLBACK_MODEL = "test-fallback-model";
  process.env.DIGEST_LLM_FALLBACK_API_KEY = "test-fallback-key";
  process.env.DIGEST_LLM_FALLBACK_BASE_URL =
    "https://generativelanguage.googleapis.com/v1beta/openai";
  process.env.DEBUG_NORMALIZED = "0";
  // Shared rate limiter uses real 2s/5s policies in production; tests must not sleep（PR #35）。
  installLlmRateLimitTestHarness({ minStartIntervalMs: 0 });
}

export function buildProcessedFile(
  reportDate: string,
  result: PipelineRunResult,
): ProcessedPapersFile {
  return toProcessedPapersFile({
    reportDate,
    generatedAt: new Date().toISOString(),
    papers: result.papers,
    routing: result.routing,
    digest: result.digest,
  });
}

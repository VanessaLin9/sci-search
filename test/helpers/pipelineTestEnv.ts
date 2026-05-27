import type { PipelineRunResult } from "../../src/pipeline.js";
import type { ProcessedPapersFile } from "../../src/processedData.js";

export function installPipelineTestEnv(): void {
  process.env.ROUTE_LIFE_SCIENCE = "1";
  process.env.ENABLE_LLM_DIGEST = "1";
  process.env.ROUTING_LLM_API_KEY = "test-routing-key";
  process.env.DIGEST_LLM_API_KEY = "test-digest-key";
  process.env.ROUTING_LLM_MODEL = "test-model";
  process.env.DIGEST_LLM_MODEL = "test-model";
  process.env.DEBUG_NORMALIZED = "0";
}

export function buildProcessedFile(
  reportDate: string,
  result: PipelineRunResult,
): ProcessedPapersFile {
  return {
    reportDate,
    generatedAt: new Date().toISOString(),
    papers: result.papers,
    routing: {
      enabled: result.routing.enabled,
      stats: result.routing.stats,
    },
    digest: {
      enabled: result.digest.enabled,
      llmTagging: result.digest.llmTagging,
      tagging: result.digest.tagging,
      selection: result.digest.selection,
      summarize: result.digest.summarize,
      translate: result.digest.translate,
    },
  };
}

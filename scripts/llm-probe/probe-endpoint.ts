/**
 * Endpoint poke：查 OpenAI-compatible `/models` 目錄，並可對候選 model 做最小 chat smoke。
 * 金鑰只從 `.env` 讀；log 只印 mask。
 *
 *   npm run probe:endpoint -- --list
 *   npm run probe:endpoint -- --list --grep kimi
 *   npm run probe:endpoint -- meta/muse-glimmer-30b
 *   npm run probe:endpoint -- --use-digest-fallback
 *   npm run probe:endpoint -- --no-smoke openai/gpt-oss-20b
 */
import { loadEnvFile } from "../../src/loadEnv.js";

loadEnvFile();

import { loadDigestFileConfig } from "../../src/config.js";
import {
  DEFAULT_DIGEST_FALLBACK_BASE_URL,
  type DigestLlmConfig,
} from "../../src/digest/config.js";
import { createDigestLlmClient } from "../../src/digest/digestLlmClient.js";
import { runProbeDigestSmoke } from "../../src/digest/probeDigestSmoke.js";
import { scheduleLlmTransportAttempt } from "../../src/llm/llmTransportRateLimit.js";
import { maskApiKey } from "../../src/routing/config.js";
import { argValue, matchesGrep, positionalArgs } from "./cliArgs.js";

function resolveApiKey(options: { useDigestFallback: boolean }): string {
  if (options.useDigestFallback) {
    const apiKey = process.env.DIGEST_LLM_FALLBACK_API_KEY?.trim() || "";
    if (!apiKey) {
      throw new Error(
        "--use-digest-fallback requires DIGEST_LLM_FALLBACK_API_KEY in .env",
      );
    }
    return apiKey;
  }
  const apiKey =
    process.env.DIGEST_LLM_API_KEY?.trim() ||
    process.env.ROUTING_LLM_API_KEY?.trim() ||
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
  if (!apiKey) {
    throw new Error(
      "No API key in .env. Set DIGEST_LLM_API_KEY, ROUTING_LLM_API_KEY, NVIDIA_API_KEY, or OPENAI_API_KEY.",
    );
  }
  return apiKey;
}

function stubClientConfig(apiKey: string, baseUrl: string, model: string): DigestLlmConfig {
  return {
    apiKey,
    baseUrl,
    model,
    maxFeatured: 12,
    overflowShowTitleZh: true,
    maxPapersPerBatch: 8,
    maxInputTokens: 28000,
    maxTokens: 32,
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
  };
}

async function listModelIds(apiKey: string, baseUrl: string): Promise<string[]> {
  const client = createDigestLlmClient(stubClientConfig(apiKey, baseUrl, "probe-list"), {
    timeoutMs: 60_000,
    maxRetries: 0,
  });

  const page = await scheduleLlmTransportAttempt(
    {
      baseUrl,
      apiKey,
      log: (message) => console.log(`[list] ${message}`),
    },
    async () => client.models.list(),
  );

  const ids: string[] = [];
  for await (const item of page) {
    if (item.id) ids.push(item.id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantList = argv.includes("--list");
  const noSmoke = argv.includes("--no-smoke");
  const useDigestFallback = argv.includes("--use-digest-fallback");
  const grep = argValue(argv, "grep")?.toLowerCase();
  const defaultBase = useDigestFallback
    ? process.env.DIGEST_LLM_FALLBACK_BASE_URL?.trim() || DEFAULT_DIGEST_FALLBACK_BASE_URL
    : loadDigestFileConfig().baseUrl;
  const baseUrl = (argValue(argv, "base-url") ?? defaultBase).replace(/\/$/, "");
  const models = positionalArgs(argv);
  if (useDigestFallback && models.length === 0 && !wantList) {
    const fallbackModel = process.env.DIGEST_LLM_FALLBACK_MODEL?.trim();
    if (fallbackModel) models.push(fallbackModel);
  }

  if (!wantList && models.length === 0) {
    console.error(
      "Usage: npm run probe:endpoint -- --list [--grep TEXT]\n" +
        "       npm run probe:endpoint -- [--no-smoke] [--use-digest-fallback] model [model…]",
    );
    process.exitCode = 1;
    return;
  }

  const apiKey = resolveApiKey({ useDigestFallback });
  console.log("=== LLM endpoint poke ===");
  console.log(`baseUrl: ${baseUrl}`);
  console.log(`apiKey: ${maskApiKey(apiKey)}`);
  if (useDigestFallback) console.log("cred: DIGEST_LLM_FALLBACK_*");

  let catalog: Set<string> | undefined;
  if (wantList || models.length > 0) {
    const started = Date.now();
    try {
      const ids = await listModelIds(apiKey, baseUrl);
      catalog = new Set(ids);
      console.log(`\nGET /models: ${ids.length} id(s) in ${Date.now() - started}ms`);
      if (wantList) {
        const shown = grep ? ids.filter((id) => matchesGrep(id, grep)) : ids;
        for (const id of shown) console.log(`  ${id}`);
        if (grep) console.log(`(filter --grep=${grep}: ${shown.length}/${ids.length})`);
      }
    } catch (error) {
      console.error(`GET /models FAIL · ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
      return;
    }
  }

  if (models.length === 0) return;

  console.log("\n=== Catalog check ===");
  let anyMissing = false;
  for (const model of models) {
    const listed = catalog?.has(model) ?? false;
    if (!listed) anyMissing = true;
    console.log(`  ${listed ? "LISTED" : "MISSING"}  ${model}`);
  }

  if (noSmoke) {
    if (anyMissing) process.exitCode = 1;
    return;
  }

  console.log("\n=== Smoke chat ===");
  let anySmokeFail = false;
  for (const model of models) {
    const result = await runProbeDigestSmoke({
      model,
      apiKey,
      baseUrl,
      log: (message) => console.log(message),
    });
    if (!result.ok) {
      anySmokeFail = true;
      console.log(`  FAIL  ${model} · ${result.message}`);
    } else {
      console.log(`  OK    ${model} · ${result.content.slice(0, 80)}`);
    }
  }

  if (anyMissing || anySmokeFail) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

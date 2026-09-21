/**
 * Translate probe：overflow 標題 → titleZh（正式 translate prompt；PR #39）。
 * Production translate **仍無** Gemini fallback；`--use-digest-fallback` 僅供 probe 對照。
 * 預設讀 `fixtures/translate-samples.json`（不綁 processed date）。
 *
 *   npm run probe:translate -- --model meta/muse-glimmer-30b
 *   npm run probe:translate -- --use-digest-fallback
 *   npm run probe:translate -- --limit 5
 *   npm run probe:translate -- --smoke-only
 *   npm run probe:translate -- --file path/to/papers.json --limit 3
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../../src/loadEnv.js";

loadEnvFile();

import {
  getDigestLlmConfig,
  maskApiKey,
  withDigestFallbackEndpoint,
} from "../../src/digest/config.js";
import { callDigestChatCompletion } from "../../src/digest/callDigestChat.js";
import { extractDigestMessageContent } from "../../src/digest/extractDigestContent.js";
import {
  formatTranslateBatchSummary,
  parseTranslateBatchResponse,
} from "../../src/digest/parseTranslateBatchResponse.js";
import { runProbeDigestSmoke } from "../../src/digest/probeDigestSmoke.js";
import {
  buildDigestTranslateCompletionParams,
  estimateTranslateCompletionTokens,
} from "../../src/digest/translatePrompt.js";
import { toDigestTranslateInput } from "../../src/digest/toTranslateInput.js";
import type { ClassifiedPaper } from "../../src/types.js";
import { argValue } from "./cliArgs.js";
import { fixturePath } from "./fixturePath.js";

type PapersFile = {
  meta?: unknown;
  papers: ClassifiedPaper[];
};

function isOverflowPaper(paper: ClassifiedPaper): boolean {
  return !paper.featured && Boolean(paper.digestLine) && paper.digestLine !== "skip";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const useDigestFallback = argv.includes("--use-digest-fallback");
  const limit = Number(argValue(argv, "limit") ?? "3");
  const papersPath = argValue(argv, "file") ?? fixturePath("translate-samples.json");

  const raw = JSON.parse(readFileSync(papersPath, "utf8")) as PapersFile;
  const overflow = raw.papers.filter(isOverflowPaper).slice(0, limit);

  let config = getDigestLlmConfig();
  if (useDigestFallback) {
    const fallback = withDigestFallbackEndpoint(config);
    if (!fallback) {
      throw new Error(
        "--use-digest-fallback requires DIGEST_LLM_FALLBACK_MODEL + DIGEST_LLM_FALLBACK_API_KEY in .env",
      );
    }
    config = fallback;
  }
  const modelOverride = argValue(argv, "model");
  if (modelOverride) config.model = modelOverride;

  console.log("=== Translate probe config ===");
  console.log(`source: ${argValue(argv, "file") ? "file" : "fixture"}`);
  console.log(`file: ${papersPath}`);
  console.log(`papers: ${overflow.length} (limit=${limit})`);
  console.log(`model: ${config.model}`);
  console.log(`baseUrl: ${config.baseUrl}`);
  console.log(`apiKey: ${maskApiKey(config.apiKey)}`);
  if (useDigestFallback) console.log("cred: DIGEST_LLM_FALLBACK_*");

  await runProbeDigestSmoke({
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
  if (argv.includes("--smoke-only")) return;

  if (overflow.length === 0) {
    console.error(
      "No overflow papers to translate (need featured=false and digestLine≠skip). See fixtures/translate-samples.json.",
    );
    process.exitCode = 1;
    return;
  }

  const batch = overflow.map(toDigestTranslateInput);
  const label = `translate probe 1/1`;
  console.log(`\n=== ${label} (${batch.length} title(s)) ===\n`);
  for (const item of batch) {
    console.log(`- ${item.id}: ${item.title}`);
  }

  const started = Date.now();
  try {
    const completion = await callDigestChatCompletion(
      config,
      (maxTokens, useJsonResponseFormat) =>
        buildDigestTranslateCompletionParams(batch, config, useJsonResponseFormat, maxTokens),
      {
        label,
        gate: "digest-probe",
        estimatedCompletionTokens: estimateTranslateCompletionTokens(batch.length),
        completionFloor: 1024,
        maxRetries: 0,
      },
    );
    const finishReason = completion.choices[0]?.finish_reason ?? "unknown";
    const { content, usedReasoningFallback } = extractDigestMessageContent(
      completion.choices[0]?.message,
    );
    const expectedIds = batch.map((item) => item.id);
    const parsed = parseTranslateBatchResponse(content, expectedIds);

    console.log(
      `\nelapsed: ${Date.now() - started}ms · finish=${finishReason} · reasoningFallback=${usedReasoningFallback}`,
    );
    console.log(`parse: ${formatTranslateBatchSummary(parsed.summary)}`);
    if (parsed.batchFailed) {
      console.log("BATCH FAILED");
      for (const issue of parsed.issues) {
        console.log(`  issue: ${issue.kind} ${"message" in issue ? issue.message : ""}`);
      }
      process.exitCode = 1;
      return;
    }
    for (const [id, titleZh] of parsed.titleZhById) {
      console.log(`OK  ${id}`);
      console.log(`    ${titleZh}`);
    }
    for (const id of parsed.failedIds) {
      console.log(`FAIL ${id} (no titleZh)`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(`FAIL in ${Date.now() - started}ms · ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

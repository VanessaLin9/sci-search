/**
 * Summarize probe：用正式 summarize prompt 試打 featured 繁中摘要（PR #39）。
 * 預設 fixture；`--date`／`--file` 才讀 processed／自訂路徑（processed 可能已被 prune）。
 *
 *   npm run probe:summarize -- --model meta/muse-glimmer-30b --limit 2
 *   npm run probe:summarize -- --use-digest-fallback --limit 2
 *   npm run probe:summarize -- --smoke-only
 *   npm run probe:summarize -- --date 2026-09-19 --limit 2
 *   npm run probe:summarize -- --file path/to/papers.json
 */
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "../../src/loadEnv.js";

loadEnvFile();

import { z } from "zod";
import {
  DEFAULT_DIGEST_FALLBACK_BASE_URL,
  getDigestLlmConfig,
  maskApiKey,
  withDigestFallbackEndpoint,
} from "../../src/digest/config.js";
import { callDigestChatCompletion } from "../../src/digest/callDigestChat.js";
import { extractDigestMessageContent } from "../../src/digest/extractDigestContent.js";
import { runProbeDigestSmoke } from "../../src/digest/probeDigestSmoke.js";
import {
  buildDigestSummarizeCompletionParams,
  estimateSummarizeCompletionTokens,
} from "../../src/digest/summarizePrompt.js";
import { toDigestSummarizeInput } from "../../src/digest/toSummarizeInput.js";
import { parseJsonFromLlmContent } from "../../src/routing/parseLlmJson.js";
import type { ClassifiedPaper, SourceScope } from "../../src/types.js";
import { argValue } from "./cliArgs.js";
import { fixturePath } from "./fixturePath.js";

const summarizeResponseSchema = z.object({
  id: z.string(),
  title_zh: z.string().min(1),
  summary_zh: z.string().min(1),
  topic_tags: z.array(z.string()).min(1).max(8),
});

type PapersFile = {
  meta?: unknown;
  papers: ClassifiedPaper[];
};

function resolvePapersPath(argv: string[]): { path: string; source: "fixture" | "date" | "file" } {
  const file = argValue(argv, "file");
  if (file) return { path: file, source: "file" };

  const date = argValue(argv, "date");
  if (date) {
    const processed = `data/processed/${date}/papers.json`;
    // 缺檔就明示失敗，不要再 silent 落到 /tmp（PR #39）
    if (!existsSync(processed)) {
      throw new Error(
        `No papers at ${processed}. Use default fixture (omit --date) or pass --file.`,
      );
    }
    return { path: processed, source: "date" };
  }

  return { path: fixturePath("summarize-samples.json"), source: "fixture" };
}

/** Prefer short → medium → long when the file has many featured papers. */
function pickFeatured(papers: ClassifiedPaper[], limit: number): ClassifiedPaper[] {
  const featured = papers.filter((p) => p.featured);
  const ranked = [...featured].sort((a, b) => (a.abstract?.length ?? 0) - (b.abstract?.length ?? 0));
  const short = ranked.filter((p) => (p.abstract?.length ?? 0) <= 300);
  const medium = ranked.find((p) => {
    const n = p.abstract?.length ?? 0;
    return n > 300 && n <= 800;
  });
  const picks: ClassifiedPaper[] = [];
  for (const p of [...short, ...(medium ? [medium] : []), ...ranked]) {
    if (!picks.some((x) => x.id === p.id)) picks.push(p);
    if (picks.length >= limit) break;
  }
  return picks;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const useDigestFallback = argv.includes("--use-digest-fallback");
  const limit = Number(argValue(argv, "limit") ?? "3");
  const { path: papersPath, source } = resolvePapersPath(argv);

  const raw = JSON.parse(readFileSync(papersPath, "utf8")) as PapersFile;

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

  console.log("=== Summarize probe config ===");
  console.log(`source: ${source}`);
  console.log(`file: ${papersPath}`);
  console.log(`model: ${config.model}`);
  console.log(`baseUrl: ${config.baseUrl}`);
  console.log(`apiKey: ${maskApiKey(config.apiKey)}`);
  console.log(`preferJsonResponseFormat: ${config.preferJsonResponseFormat}`);
  if (useDigestFallback) console.log("cred: DIGEST_LLM_FALLBACK_*");
  console.log(`fallbackDefaultBase: ${DEFAULT_DIGEST_FALLBACK_BASE_URL}`);

  await runProbeDigestSmoke({
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    profile: config.providerProfile,
  });
  if (argv.includes("--smoke-only")) return;

  const picks = pickFeatured(raw.papers, limit);
  if (picks.length === 0) {
    console.error("No featured papers in fixture/file (need featured=true).");
    process.exitCode = 1;
    return;
  }

  const scopeBySourceId = new Map<string, SourceScope>();
  for (const paper of picks) {
    scopeBySourceId.set(paper.sourceId, "life-science-only");
  }

  console.log(`\n=== Summarize ${picks.length} featured paper(s) ===\n`);

  for (const [index, paper] of picks.entries()) {
    const label = `summarize probe ${index + 1}/${picks.length} (${paper.id})`;
    const input = toDigestSummarizeInput(paper, scopeBySourceId);
    console.log(`--- ${label} ---`);
    console.log(`title: ${paper.title}`);
    console.log(`digestLine: ${paper.digestLine} · abstractChars: ${(paper.abstract ?? "").length}`);

    const started = Date.now();
    try {
      const completion = await callDigestChatCompletion(
        config,
        (maxTokens, useJsonResponseFormat) =>
          buildDigestSummarizeCompletionParams(input, config, useJsonResponseFormat, maxTokens),
        {
          label,
          gate: "digest-probe",
          estimatedCompletionTokens: estimateSummarizeCompletionTokens(),
          completionFloor: 2048,
          timeoutMs: config.summarizeTimeoutMs,
          maxRetries: 0,
        },
      );
      const { content, usedReasoningFallback } = extractDigestMessageContent(
        completion.choices[0]?.message,
      );
      const parsed = summarizeResponseSchema.parse(parseJsonFromLlmContent(content));
      console.log(
        `elapsed: ${Date.now() - started}ms · finish=${completion.choices[0]?.finish_reason} · reasoningFallback=${usedReasoningFallback}`,
      );
      console.log(`usage: ${JSON.stringify(completion.usage ?? null)}`);
      console.log(`title_zh: ${parsed.title_zh}`);
      console.log(`topic_tags: ${parsed.topic_tags.join(", ")}`);
      console.log(`summary_zh:\n${parsed.summary_zh}\n`);
    } catch (error) {
      console.log(`FAIL in ${Date.now() - started}ms · ${error instanceof Error ? error.message : error}\n`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

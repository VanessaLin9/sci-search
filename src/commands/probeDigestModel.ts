/**
 * Local probe helper（非正式 pipeline）：對某日 papers.json 抽少數 featured 試打 summarize。
 * 之後換 NVIDIA model 可繼續用，不必重寫。
 *
 * Usage:
 *   npx tsx src/commands/probeDigestModel.ts --date 2026-07-28 --model thinkingmachines/inkling --limit 2
 *   npx tsx src/commands/probeDigestModel.ts --date 2026-07-28 --model deepseek-ai/deepseek-v4-flash --smoke-only
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../loadEnv.js";

loadEnvFile();

import { getDigestLlmConfig, maskApiKey } from "../digest/config.js";
import { callDigestChatCompletion } from "../digest/callDigestChat.js";
import { extractDigestMessageContent } from "../digest/extractDigestContent.js";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import {
  buildDigestSummarizeCompletionParams,
  estimateSummarizeCompletionTokens,
} from "../digest/summarizePrompt.js";
import { toDigestSummarizeInput } from "../digest/toSummarizeInput.js";
import { createDigestLlmClient } from "../digest/digestLlmClient.js";
import {
  formatLlmRequestTimingSuffix,
  noteLlmRequestStart,
} from "../llm/llmRequestTiming.js";
import type { ClassifiedPaper, SourceScope } from "../types.js";
import { z } from "zod";

const summarizeResponseSchema = z.object({
  id: z.string(),
  title_zh: z.string().min(1),
  summary_zh: z.string().min(1),
  topic_tags: z.array(z.string()).min(1).max(8),
});

function argValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function smokeModel(model: string, apiKey: string, baseUrl: string): Promise<void> {
  // 直打 completions（不經 callDigestChat）；仍記 PR #26 timing，gate=`digest-probe-smoke`。
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
  const timing = noteLlmRequestStart();
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 32,
      stream: false,
      messages: [{ role: "user", content: 'Reply with exactly: {"ok":true}' }],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    console.log(
      `[smoke] ${model}: OK · ${formatLlmRequestTimingSuffix(timing, timingMeta)} · ` +
        `wall=${Date.now() - started}ms · finish=${completion.choices[0]?.finish_reason} · ${content.slice(0, 80)}`,
    );
  } catch (error) {
    console.log(
      `[smoke] ${model}: FAIL · ${formatLlmRequestTimingSuffix(timing, timingMeta)} · ` +
        `wall=${Date.now() - started}ms · ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = argValue(argv, "date") ?? "2026-07-28";
  const model = argValue(argv, "model") ?? "minimaxai/minimax-m3";
  const limit = Number(argValue(argv, "limit") ?? "3");
  const papersPath =
    argValue(argv, "file") ??
    (await (async () => {
      try {
        readFileSync(`data/processed/${date}/papers.json`, "utf8");
        return `data/processed/${date}/papers.json`;
      } catch {
        return `/tmp/papers-${date}.json`;
      }
    })());

  const raw = JSON.parse(readFileSync(papersPath, "utf8")) as {
    papers: ClassifiedPaper[];
    sources?: Array<{ id: string; scope?: SourceScope }>;
  };

  const config = getDigestLlmConfig();
  config.model = model;

  console.log("=== Probe config ===");
  console.log(`date: ${date}`);
  console.log(`file: ${papersPath}`);
  console.log(`model: ${config.model}`);
  console.log(`baseUrl: ${config.baseUrl}`);
  console.log(`apiKey: ${maskApiKey(config.apiKey)}`);
  console.log(`preferJsonResponseFormat: ${config.preferJsonResponseFormat}`);

  await smokeModel(model, config.apiKey, config.baseUrl);
  if (argv.includes("--smoke-only")) return;

  const featured = raw.papers.filter((p) => p.featured);
  // Fast probe picks: short/no abstract first, then one medium abstract — avoid 2k+ abstracts.
  const ranked = [...featured].sort((a, b) => (a.abstract?.length ?? 0) - (b.abstract?.length ?? 0));
  const short = ranked.filter((p) => (p.abstract?.length ?? 0) <= 300);
  const medium = ranked.find((p) => {
    const n = p.abstract?.length ?? 0;
    return n > 300 && n <= 800;
  });
  const picks: ClassifiedPaper[] = [];
  for (const p of [...short, medium, ...ranked]) {
    if (p && !picks.some((x) => x.id === p.id)) picks.push(p);
    if (picks.length >= limit) break;
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
      console.log(`elapsed: ${Date.now() - started}ms · finish=${completion.choices[0]?.finish_reason} · reasoningFallback=${usedReasoningFallback}`);
      console.log(`usage: ${JSON.stringify(completion.usage ?? null)}`);
      console.log(`title_zh: ${parsed.title_zh}`);
      console.log(`topic_tags: ${parsed.topic_tags.join(", ")}`);
      console.log(`summary_zh:\n${parsed.summary_zh}\n`);
    } catch (error) {
      console.log(`FAIL in ${Date.now() - started}ms · ${error instanceof Error ? error.message : error}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Routing probe：正式 life-science routing prompt（生醫／physics fixture）。
 *
 *   npm run probe:routing --
 *   npm run probe:routing -- --fixture physics
 *   npm run probe:routing -- --model meta/muse-glimmer-30b
 *   npm run probe:routing -- --use-digest-fallback
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "../../src/loadEnv.js";

loadEnvFile();

import { z } from "zod";
import {
  DEFAULT_DIGEST_FALLBACK_BASE_URL,
  getDigestLlmConfig,
} from "../../src/digest/config.js";
import { callRoutingCompletion } from "../../src/routing/callRoutingCompletion.js";
import { getRoutingLlmConfig, isNvidiaIntegrateApi, maskApiKey } from "../../src/routing/config.js";
import { buildRoutingCompletionParams } from "../../src/routing/routingPrompt.js";
import type { BroadScienceRoutingInput } from "../../src/routing/types.js";
import {
  parseLlmJsonOrFail,
  parseVerdictTestCli,
  printCompletionMeta,
  printConfigLines,
  printMessageFields,
  printRawCompletion,
  printSection,
} from "../../src/commands/llmTestCli.js";
import { fixturePath } from "./fixturePath.js";

type RoutingFixture = BroadScienceRoutingInput & { expectedVerdict?: "yes" | "no" | "not_sure" };

const verdictSchema = z.enum(["yes", "no", "not_sure"]);
const llmResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: verdictSchema,
    }),
  ),
});

function loadFixtures(): { default: RoutingFixture; physics: RoutingFixture } {
  return JSON.parse(readFileSync(fixturePath("routing-samples.json"), "utf8")) as {
    default: RoutingFixture;
    physics: RoutingFixture;
  };
}

function buildSamplePaper(
  cli: ReturnType<typeof parseVerdictTestCli>,
  fixtures: { default: RoutingFixture; physics: RoutingFixture },
): RoutingFixture {
  const base = cli.fixture === "physics" ? fixtures.physics : fixtures.default;
  return {
    id: cli.id ?? base.id,
    title: cli.title ?? base.title,
    journal: base.journal,
    source_id: base.source_id,
    expectedVerdict: base.expectedVerdict,
  };
}

async function main(): Promise<void> {
  const cli = parseVerdictTestCli(process.argv.slice(2));
  const fixtures = loadFixtures();
  const paper = buildSamplePaper(cli, fixtures);
  const config = getRoutingLlmConfig();

  if (cli.useDigestFallback) {
    const digest = getDigestLlmConfig();
    const fallbackModel = digest.fallbackModel?.trim();
    const fallbackApiKey = digest.fallbackApiKey?.trim();
    const fallbackBaseUrl = (
      digest.fallbackBaseUrl?.trim() || DEFAULT_DIGEST_FALLBACK_BASE_URL
    ).replace(/\/$/, "");
    if (!fallbackModel || !fallbackApiKey) {
      throw new Error(
        "--use-digest-fallback requires DIGEST_LLM_FALLBACK_MODEL and DIGEST_LLM_FALLBACK_API_KEY in .env",
      );
    }
    config.model = cli.model ?? fallbackModel;
    config.apiKey = fallbackApiKey;
    config.baseUrl = fallbackBaseUrl;
    const nvidia = isNvidiaIntegrateApi(config.baseUrl);
    config.preferJsonResponseFormat = !nvidia;
    config.disableThinking = false;
  } else if (cli.model) {
    config.model = cli.model;
  }

  const input: BroadScienceRoutingInput = {
    id: paper.id,
    title: paper.title,
    journal: paper.journal,
    source_id: paper.source_id,
  };

  printConfigLines({
    baseURL: config.baseUrl,
    model: config.model,
    apiKey: maskApiKey(config.apiKey),
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    disableThinking: config.disableThinking,
  });

  printSection("Input paper (routing payload)", JSON.stringify({ papers: [input] }, null, 2));
  if (paper.expectedVerdict) {
    console.log(`expectedVerdict: ${paper.expectedVerdict}`);
  }

  printSection(
    "Request params (no api key)",
    JSON.stringify(
      buildRoutingCompletionParams([input], config, config.preferJsonResponseFormat),
      null,
      2,
    ),
  );

  console.log("\nCalling LLM…\n");

  const { completion, usedJsonResponseFormat, elapsedMs } = await callRoutingCompletion(
    [input],
    config,
    { label: "probe-routing" },
  );

  printCompletionMeta({ elapsedMs, usedJsonResponseFormat, completion });
  printRawCompletion(completion);
  printMessageFields(completion);
  parseLlmJsonOrFail(completion, llmResponseSchema, { skipParse: cli.skipParse });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

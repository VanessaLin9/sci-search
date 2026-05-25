import { loadEnvFile } from "../loadEnv.js";

loadEnvFile();

import { z } from "zod";
import { callRoutingCompletion } from "../routing/callRoutingCompletion.js";
import { getRoutingLlmConfig, maskApiKey } from "../routing/config.js";
import { buildRoutingCompletionParams } from "../routing/routingPrompt.js";
import type { BroadScienceRoutingInput } from "../routing/types.js";
import {
  parseLlmJsonOrFail,
  parseVerdictTestCli,
  printCompletionMeta,
  printConfigLines,
  printMessageFields,
  printRawCompletion,
  printSection,
} from "./llmTestCli.js";

const DEFAULT_SAMPLE: BroadScienceRoutingInput = {
  id: "10.1126/science.adq9999",
  title: "A neural circuit for stress-induced memory linking in mice",
  journal: "Science",
  source_id: "science",
};

const PHYSICS_SAMPLE: BroadScienceRoutingInput = {
  id: "10.1126/science.adp0001",
  title: "Room-temperature superconductivity in a lanthanum hydride superconductor",
  journal: "Science",
  source_id: "science",
};

const verdictSchema = z.enum(["yes", "no", "not_sure"]);
const llmResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: verdictSchema,
    }),
  ),
});

function buildSamplePaper(cli: ReturnType<typeof parseVerdictTestCli>): BroadScienceRoutingInput {
  const base = cli.fixture === "physics" ? PHYSICS_SAMPLE : DEFAULT_SAMPLE;
  return {
    id: cli.id ?? base.id,
    title: cli.title ?? base.title,
    journal: base.journal,
    source_id: base.source_id,
  };
}

async function main() {
  const cli = parseVerdictTestCli(process.argv.slice(2));
  const paper = buildSamplePaper(cli);
  const config = getRoutingLlmConfig();
  if (cli.model) {
    config.model = cli.model;
  }

  printConfigLines({
    baseURL: config.baseUrl,
    model: config.model,
    apiKey: maskApiKey(config.apiKey),
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    disableThinking: config.disableThinking,
  });

  printSection("Input paper (routing payload)", JSON.stringify({ papers: [paper] }, null, 2));

  printSection(
    "Request params (no api key)",
    JSON.stringify(
      buildRoutingCompletionParams([paper], config, config.preferJsonResponseFormat),
      null,
      2,
    ),
  );

  console.log("\nCalling LLM…\n");

  const { completion, usedJsonResponseFormat, elapsedMs } = await callRoutingCompletion(
    [paper],
    config,
    { label: "test-routing-llm" },
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

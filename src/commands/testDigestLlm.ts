import { loadEnvFile } from "../loadEnv.js";

loadEnvFile();

import { z } from "zod";
import { callDigestTaggingCompletion } from "../digest/callDigestCompletion.js";
import { getDigestLlmConfigForTest } from "../digest/configForTest.js";
import { maskApiKey } from "../digest/config.js";
import { buildDigestTaggingCompletionParams } from "../digest/taggingPrompt.js";
import type { DigestTaggingInput } from "../digest/types.js";
import {
  parseLlmJsonOrFail,
  parseVerdictTestCli,
  printCompletionMeta,
  printConfigLines,
  printMessageFields,
  printRawCompletion,
  printSection,
} from "./llmTestCli.js";

const DEFAULT_SAMPLE: DigestTaggingInput = {
  id: "10.1126/science.adq9999",
  title: "A neural circuit for stress-induced memory linking in mice",
  journal: "Science",
  source_id: "science",
  scope: "broad-science",
  abstract:
    "Stress can link neutral memories with aversive events. Here we map a hippocampal circuit in mice that supports this effect using optogenetics and electrophysiology.",
};

const PHYSICS_SAMPLE: DigestTaggingInput = {
  id: "10.1126/science.adp0001",
  title: "Room-temperature superconductivity in a lanthanum hydride superconductor",
  journal: "Science",
  source_id: "science",
  scope: "broad-science",
  abstract: "We report superconductivity near room temperature in compressed lanthanum hydride.",
};

const digestLineSchema = z.enum(["line-a", "line-b", "preprint", "skip"]);
const llmResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      digest_line: digestLineSchema,
    }),
  ),
});

function buildSample(cli: ReturnType<typeof parseVerdictTestCli>): DigestTaggingInput {
  const base = cli.fixture === "physics" ? PHYSICS_SAMPLE : DEFAULT_SAMPLE;
  return {
    id: cli.id ?? base.id,
    title: cli.title ?? base.title,
    journal: base.journal,
    source_id: base.source_id,
    scope: base.scope,
    abstract: base.abstract,
  };
}

async function main() {
  const cli = parseVerdictTestCli(process.argv.slice(2));
  const paper = buildSample(cli);
  const config = getDigestLlmConfigForTest({
    modelOverride: cli.model,
    useRoutingEnv: cli.useRoutingEnv,
  });

  printConfigLines({
    mode: cli.useRoutingEnv ? "digest caps + routing API key/model" : "DIGEST_LLM_* env",
    baseURL: config.baseUrl,
    model: config.model,
    apiKey: maskApiKey(config.apiKey),
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    maxPapersPerBatch: config.maxPapersPerBatch,
    preferJsonResponseFormat: config.preferJsonResponseFormat,
    disableThinking: config.disableThinking,
  });

  printSection("Input paper (digest tagging payload)", JSON.stringify({ papers: [paper] }, null, 2));

  printSection(
    "Request params (no api key)",
    JSON.stringify(
      buildDigestTaggingCompletionParams([paper], config, config.preferJsonResponseFormat),
      null,
      2,
    ),
  );

  console.log("\nCalling digest LLM…\n");

  const startedAt = Date.now();
  const completion = await callDigestTaggingCompletion([paper], config, {
    label: "test-digest-llm",
  });
  const elapsedMs = Date.now() - startedAt;

  printCompletionMeta({ elapsedMs, completion });
  printRawCompletion(completion);
  printMessageFields(completion);
  parseLlmJsonOrFail(completion, llmResponseSchema, { skipParse: cli.skipParse });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

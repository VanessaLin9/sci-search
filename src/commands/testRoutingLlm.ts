import { loadEnvFile } from "../loadEnv.js";

loadEnvFile();

import { z } from "zod";
import {
  callRoutingCompletion,
  extractRoutingMessageContent,
} from "../routing/callRoutingCompletion.js";
import { getRoutingLlmConfig, maskApiKey } from "../routing/config.js";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";
import { buildRoutingCompletionParams } from "../routing/routingPrompt.js";
import type { BroadScienceRoutingInput } from "../routing/types.js";

/** Default: one Science item (life-science-ish title). */
const DEFAULT_SAMPLE: BroadScienceRoutingInput = {
  id: "10.1126/science.adq9999",
  title: "A neural circuit for stress-induced memory linking in mice",
  journal: "Science",
  source_id: "science",
};

/** Optional: obvious non–life-science title for `--fixture physics`. */
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

type CliOptions = {
  model?: string;
  title?: string;
  id?: string;
  fixture: "default" | "physics";
  skipParse: boolean;
};

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { fixture: "default", skipParse: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--model" && argv[index + 1]) {
      options.model = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      options.model = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--title" && argv[index + 1]) {
      options.title = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--title=")) {
      options.title = arg.slice("--title=".length);
      continue;
    }
    if (arg === "--id" && argv[index + 1]) {
      options.id = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--id=")) {
      options.id = arg.slice("--id=".length);
      continue;
    }
    if (arg === "--fixture" && argv[index + 1]) {
      options.fixture = argv[index + 1] === "physics" ? "physics" : "default";
      index += 1;
      continue;
    }
    if (arg === "--skip-parse") {
      options.skipParse = true;
    }
  }

  return options;
}

function buildSamplePaper(cli: CliOptions): BroadScienceRoutingInput {
  const base = cli.fixture === "physics" ? PHYSICS_SAMPLE : DEFAULT_SAMPLE;
  return {
    id: cli.id ?? base.id,
    title: cli.title ?? base.title,
    journal: base.journal,
    source_id: base.source_id,
  };
}

function printSection(title: string, body: string): void {
  console.log(`\n=== ${title} ===\n`);
  console.log(body);
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const paper = buildSamplePaper(cli);
  const config = getRoutingLlmConfig();
  if (cli.model) {
    config.model = cli.model;
  }

  printSection(
    "Config",
    [
      `baseURL: ${config.baseUrl}`,
      `model: ${config.model}`,
      `apiKey: ${maskApiKey(config.apiKey)}`,
      `timeoutMs: ${config.timeoutMs}`,
      `maxTokens: ${config.maxTokens}`,
      `preferJsonResponseFormat: ${config.preferJsonResponseFormat}`,
      `disableThinking: ${config.disableThinking}`,
    ].join("\n"),
  );

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

  printSection(
    "Response meta",
    [
      `elapsedMs: ${elapsedMs}`,
      `usedJsonResponseFormat: ${usedJsonResponseFormat}`,
      `finish_reason: ${completion.choices[0]?.finish_reason ?? "n/a"}`,
      `usage: ${JSON.stringify(completion.usage ?? null)}`,
    ].join("\n"),
  );

  printSection("Raw completion JSON", JSON.stringify(completion, null, 2));

  const message = completion.choices[0]?.message;
  printSection(
    "Message fields",
    JSON.stringify(
      {
        role: message?.role,
        content: message?.content,
        reasoning_content: (message as { reasoning_content?: string | null })?.reasoning_content,
      },
      null,
      2,
    ),
  );

  if (cli.skipParse) {
    console.log("\n(--skip-parse: skipping JSON verdict parse)\n");
    return;
  }

  try {
    const { content, usedReasoningFallback } = extractRoutingMessageContent(message);
    printSection(
      "Extracted content",
      `${usedReasoningFallback ? "[from reasoning_content]\n" : ""}${content}`,
    );
    const parsed = llmResponseSchema.parse(parseJsonFromLlmContent(content));
    printSection("Parsed verdicts", JSON.stringify(parsed, null, 2));
  } catch (error) {
    printSection("Parse error", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

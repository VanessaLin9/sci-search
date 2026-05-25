import type { ChatCompletion } from "openai/resources/chat/completions";
import type { z } from "zod";
import { extractRoutingMessageContent } from "../routing/callRoutingCompletion.js";
import { parseJsonFromLlmContent } from "../routing/parseLlmJson.js";

export function printSection(title: string, body: string): void {
  console.log(`\n=== ${title} ===\n`);
  console.log(body);
}

export function printConfigLines(lines: Record<string, string | number | boolean>): void {
  printSection(
    "Config",
    Object.entries(lines)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
  );
}

export function printCompletionMeta(options: {
  elapsedMs: number;
  usedJsonResponseFormat?: boolean;
  completion: ChatCompletion;
}): void {
  const choice = options.completion.choices[0];
  printSection(
    "Response meta",
    [
      `elapsedMs: ${options.elapsedMs}`,
      options.usedJsonResponseFormat !== undefined
        ? `usedJsonResponseFormat: ${options.usedJsonResponseFormat}`
        : undefined,
      `finish_reason: ${choice?.finish_reason ?? "n/a"}`,
      `usage: ${JSON.stringify(options.completion.usage ?? null)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function printRawCompletion(completion: ChatCompletion): void {
  printSection("Raw completion JSON", JSON.stringify(completion, null, 2));
}

export function printMessageFields(completion: ChatCompletion): void {
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
}

export function parseModelFromArgv(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--model" && argv[index + 1]) {
      return argv[index + 1];
    }
    if (arg.startsWith("--model=")) {
      return arg.slice("--model=".length);
    }
  }
  return undefined;
}

export function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export type LlmTestCliOptions = {
  model?: string;
  title?: string;
  id?: string;
  fixture: "default" | "physics";
  skipParse: boolean;
  useRoutingEnv: boolean;
};

export function parseVerdictTestCli(argv: string[]): LlmTestCliOptions {
  const options: LlmTestCliOptions = {
    fixture: "default",
    skipParse: false,
    useRoutingEnv: false,
  };

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
    if (arg === "--use-routing") {
      options.useRoutingEnv = true;
    }
  }

  return options;
}

export function parseLlmJsonOrFail<T>(
  completion: ChatCompletion,
  schema: z.ZodType<T>,
  options: { skipParse: boolean },
): void {
  if (options.skipParse) {
    console.log("\n(--skip-parse: skipping JSON parse)\n");
    return;
  }

  try {
    const { content, usedReasoningFallback } = extractRoutingMessageContent(
      completion.choices[0]?.message,
    );
    printSection(
      "Extracted content",
      `${usedReasoningFallback ? "[from reasoning_content]\n" : ""}${content}`,
    );
    const parsed = schema.parse(parseJsonFromLlmContent(content));
    printSection("Parsed JSON", JSON.stringify(parsed, null, 2));
  } catch (error) {
    printSection("Parse error", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

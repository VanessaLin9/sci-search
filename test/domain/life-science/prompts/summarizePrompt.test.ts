import assert from "node:assert/strict";
import test from "node:test";
import { DIGEST_SUMMARIZE_SYSTEM_PROMPT } from "../../../../src/domain/life-science/prompts/summarize.system.js";
import { buildDigestSummarizeCompletionParams } from "../../../../src/digest/summarizePrompt.js";
import type { DigestLlmConfig } from "../../../../src/digest/config.js";

const config: DigestLlmConfig = {
  apiKey: "test-key",
  baseUrl: "https://example.test/v1",
  model: "test-model",
  maxFeatured: 12,
  overflowShowTitleZh: true,
  maxPapersPerBatch: 8,
  maxInputTokens: 28_000,
  timeoutMs: 180_000,
  maxTokens: 8_192,
  maxRetries: 0,
  summarizeTimeoutMs: 90_000,
  summarizeFallbackTimeoutMs: 240_000,
  summarizeStageBudgetMs: 900_000,
  summarizeMaxRetries: 0,
  summarizeConcurrency: 1,
  summarizeFallbackConcurrency: 2,
  preferJsonResponseFormat: false,
  disableThinking: true,
};

test("summarize prompt requires grounded copy and permits short output for sparse inputs", () => {
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /Use only facts explicitly present/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /Do not invent or infer experimental methods/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /Do not make a general input more specific/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /microbiota-derived.*gut microbiota-derived/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /Do not add plausible background knowledge/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /shorter 1–2 sentence summary/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /Never fill missing detail by guessing/i);
});

test("summarize prompt protects Taiwan terminology and output integrity", () => {
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /Traditional Chinese as written in Taiwan/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /Do not coin a translation/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /replacement characters \(�\)/i);
  assert.match(DIGEST_SUMMARIZE_SYSTEM_PROMPT, /unsupported specifics/i);
});

test("completion request carries the grounding prompt and production controls", () => {
  const params = buildDigestSummarizeCompletionParams(
    {
      id: "paper-1",
      title: "A sparse paper title",
      journal: "Test Journal",
      source_id: "test-source",
      scope: "life-science-only",
      digest_line: "line-b",
      abstract: "The authors report a scalable screening platform.",
    },
    config,
    false,
    2_048,
  );

  assert.equal(params.temperature, 0);
  assert.equal(params.stream, false);
  assert.equal(params.max_tokens, 2_048);
  const templateParams = params as typeof params & {
    chat_template_kwargs?: { enable_thinking?: boolean; clear_thinking?: boolean };
  };
  assert.deepEqual(templateParams.chat_template_kwargs, {
    enable_thinking: false,
    clear_thinking: true,
  });
  assert.equal(params.messages[0]?.role, "system");
  assert.equal(params.messages[0]?.content, DIGEST_SUMMARIZE_SYSTEM_PROMPT);
});

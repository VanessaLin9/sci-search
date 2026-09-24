import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { buildBiorxivGateCompletionParams } from "../../src/biorxiv-gate/gatePrompt.js";
import { getDigestLlmConfig, type DigestLlmConfig } from "../../src/digest/config.js";
import { buildSpatialClassifyCompletionParams } from "../../src/digest/spatialPrompt.js";
import { buildDigestSummarizeCompletionParams } from "../../src/digest/summarizePrompt.js";
import { buildDigestTaggingCompletionParams } from "../../src/digest/taggingPrompt.js";
import { buildDigestTranslateCompletionParams } from "../../src/digest/translatePrompt.js";
import {
  GENERIC_LLM_RATE_POLICY,
  inferLlmProviderProfileId,
  readLlmProviderProfileId,
  resolveLlmProviderProfile,
  type LlmProviderProfile,
} from "../../src/llm/llmProviderProfile.js";
import {
  GEMINI_LLM_RATE_POLICY,
  NVIDIA_LLM_RATE_POLICY,
} from "../../src/llm/llmRequestScheduler.js";
import { getRoutingLlmConfig, type RoutingLlmConfig } from "../../src/routing/config.js";
import { buildRoutingCompletionParams } from "../../src/routing/routingPrompt.js";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

function routingConfig(profile: LlmProviderProfile): RoutingLlmConfig {
  return {
    apiKey: "test-key",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "test-model",
    maxPapersPerBatch: 4,
    maxInputTokens: 1_000,
    timeoutMs: 1_000,
    maxTokens: 256,
    maxRetries: 0,
    preferJsonResponseFormat: profile.preferJsonResponseFormat,
    disableThinking: profile.disableThinking,
    providerProfile: profile,
  };
}

function digestConfig(profile: LlmProviderProfile): DigestLlmConfig {
  return {
    apiKey: "test-key",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "test-model",
    maxFeatured: 12,
    overflowShowTitleZh: true,
    maxPapersPerBatch: 4,
    maxInputTokens: 1_000,
    timeoutMs: 1_000,
    maxTokens: 256,
    maxRetries: 0,
    summarizeTimeoutMs: 1_000,
    summarizeFallbackTimeoutMs: 1_000,
    summarizeStageBudgetMs: 5_000,
    summarizeMaxRetries: 0,
    summarizeConcurrency: 1,
    summarizeFallbackConcurrency: 1,
    preferJsonResponseFormat: profile.preferJsonResponseFormat,
    disableThinking: profile.disableThinking,
    providerProfile: profile,
  };
}

function thinkingKwargs(params: object): unknown {
  return (params as { chat_template_kwargs?: unknown }).chat_template_kwargs;
}

describe("resolveLlmProviderProfile", () => {
  test("known hosts keep nvidia and gemini behavior when profile is unset", () => {
    assert.equal(
      inferLlmProviderProfileId("https://integrate.api.nvidia.com/v1"),
      "nvidia",
    );
    assert.equal(
      inferLlmProviderProfileId("https://generativelanguage.googleapis.com/v1beta/openai"),
      "gemini",
    );

    const nvidia = resolveLlmProviderProfile({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      enableThinking: false,
    });
    assert.equal(nvidia.id, "nvidia");
    assert.equal(nvidia.preferJsonResponseFormat, false);
    assert.equal(nvidia.disableThinking, true);
    assert.equal(nvidia.policy, NVIDIA_LLM_RATE_POLICY);

    const gemini = resolveLlmProviderProfile({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      enableThinking: false,
    });
    assert.equal(gemini.id, "gemini");
    assert.equal(gemini.preferJsonResponseFormat, true);
    assert.equal(gemini.disableThinking, false);
    assert.equal(gemini.policy, GEMINI_LLM_RATE_POLICY);
  });

  test("unknown hosts and explicit generic do not send thinking kwargs or use NVIDIA spacing", () => {
    assert.equal(inferLlmProviderProfileId("https://llm.example.test/v1"), "generic");

    const inferred = resolveLlmProviderProfile({
      baseUrl: "https://llm.example.test/v1",
      enableThinking: false,
    });
    const explicit = resolveLlmProviderProfile({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      profileId: "generic",
      enableThinking: false,
    });

    for (const profile of [inferred, explicit]) {
      assert.equal(profile.id, "generic");
      assert.equal(profile.preferJsonResponseFormat, true);
      assert.equal(profile.disableThinking, false);
      assert.equal(profile.policy, GENERIC_LLM_RATE_POLICY);
      assert.notEqual(profile.policy, NVIDIA_LLM_RATE_POLICY);
    }
  });

  test("invalid profile env fails closed", () => {
    process.env.ROUTING_LLM_PROFILE = "muse";
    assert.throws(
      () => readLlmProviderProfileId("ROUTING_LLM_PROFILE"),
      /ROUTING_LLM_PROFILE must be one of nvidia, gemini, generic/,
    );
  });
});

describe("profile env on routing and digest config", () => {
  test("ROUTING_LLM_PROFILE=generic overrides the NVIDIA host in routing.json", () => {
    process.env.ROUTING_LLM_API_KEY = "routing-key";
    process.env.ROUTING_LLM_MODEL = "some-model";
    process.env.ROUTING_LLM_PROFILE = "generic";

    const config = getRoutingLlmConfig();
    assert.equal(config.providerProfile?.id, "generic");
    assert.equal(config.preferJsonResponseFormat, true);
    assert.equal(config.disableThinking, false);
    assert.equal(config.providerProfile?.policy, GENERIC_LLM_RATE_POLICY);
  });

  test("DIGEST_LLM_PROFILE=generic overrides the primary NVIDIA host", () => {
    process.env.DIGEST_LLM_API_KEY = "digest-key";
    process.env.DIGEST_LLM_MODEL = "some-model";
    process.env.DIGEST_LLM_PROFILE = "generic";
    delete process.env.DIGEST_LLM_FALLBACK_MODEL;
    delete process.env.DIGEST_LLM_FALLBACK_API_KEY;

    const config = getDigestLlmConfig();
    assert.equal(config.providerProfile?.id, "generic");
    assert.equal(config.disableThinking, false);
    assert.equal(config.preferJsonResponseFormat, true);
  });
});

describe("prompt builders follow disableThinking without per-model edits", () => {
  const nvidia = resolveLlmProviderProfile({
    baseUrl: "https://integrate.api.nvidia.com/v1",
    enableThinking: false,
  });
  const generic = resolveLlmProviderProfile({
    baseUrl: "https://integrate.api.nvidia.com/v1",
    profileId: "generic",
    enableThinking: false,
  });

  test("generic profile omits chat_template_kwargs and requests json_object", () => {
    const routing = routingConfig(generic);
    const digest = digestConfig(generic);
    const paper = { id: "p1", title: "Title", journal: "Journal" };
    const params = [
      buildRoutingCompletionParams(
        [{ ...paper, source_id: "nature" }],
        routing,
        routing.preferJsonResponseFormat,
      ),
      buildSpatialClassifyCompletionParams([paper], routing, routing.preferJsonResponseFormat),
      buildBiorxivGateCompletionParams(
        [{ id: "p1", title: "Title", abstract: "Abstract" }],
        routing,
        routing.preferJsonResponseFormat,
      ),
      buildDigestTaggingCompletionParams(
        [{ ...paper, source_id: "nature", scope: "broad-science" }],
        digest,
        digest.preferJsonResponseFormat,
      ),
      buildDigestSummarizeCompletionParams(
        {
          ...paper,
          source_id: "nature",
          scope: "broad-science",
          digest_line: "line-b",
        },
        digest,
        digest.preferJsonResponseFormat,
      ),
      buildDigestTranslateCompletionParams([paper], digest, digest.preferJsonResponseFormat),
    ];

    for (const built of params) {
      assert.equal(thinkingKwargs(built), undefined);
      assert.deepEqual(built.response_format, { type: "json_object" });
    }
  });

  test("nvidia profile still attaches thinking-off kwargs and skips json_object", () => {
    const routing = routingConfig(nvidia);
    const built = buildRoutingCompletionParams(
      [{ id: "p1", title: "Title", journal: "Journal", source_id: "nature" }],
      routing,
      routing.preferJsonResponseFormat,
    );
    assert.deepEqual(thinkingKwargs(built), {
      enable_thinking: false,
      clear_thinking: true,
    });
    assert.equal(built.response_format, undefined);
  });
});

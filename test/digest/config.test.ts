import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  DEFAULT_DIGEST_FALLBACK_BASE_URL,
  getDigestLlmConfig,
  withDigestFallbackEndpoint,
} from "../../src/digest/config.js";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

function setPrimaryEnv(): void {
  process.env.ENABLE_LLM_DIGEST = "1";
  process.env.DIGEST_LLM_API_KEY = "primary-key";
  process.env.DIGEST_LLM_MODEL = "minimaxai/minimax-m3";
  delete process.env.DIGEST_LLM_FALLBACK_MODEL;
  delete process.env.DIGEST_LLM_FALLBACK_API_KEY;
  delete process.env.DIGEST_LLM_FALLBACK_BASE_URL;
  delete process.env.ROUTING_LLM_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.OPENAI_API_KEY;
}

describe("getDigestLlmConfig fallback credentials", () => {
  test("fallback off when FALLBACK_MODEL unset", () => {
    setPrimaryEnv();
    const config = getDigestLlmConfig();
    assert.equal(config.fallbackModel, undefined);
    assert.equal(withDigestFallbackEndpoint(config), undefined);
  });

  test("fallback on requires API key and defaults Gemini OpenAI-compat base URL", () => {
    setPrimaryEnv();
    process.env.DIGEST_LLM_FALLBACK_MODEL = "gemini-3.5-flash-lite";
    process.env.DIGEST_LLM_FALLBACK_API_KEY = "gemini-key";

    const config = getDigestLlmConfig();
    assert.equal(config.fallbackModel, "gemini-3.5-flash-lite");
    assert.equal(config.fallbackApiKey, "gemini-key");
    assert.equal(config.fallbackBaseUrl, DEFAULT_DIGEST_FALLBACK_BASE_URL);
    assert.equal(config.fallbackPreferJsonResponseFormat, true);
    assert.equal(config.fallbackDisableThinking, false);

    const endpoint = withDigestFallbackEndpoint(config);
    assert.ok(endpoint);
    assert.equal(endpoint.apiKey, "gemini-key");
    assert.equal(endpoint.baseUrl, DEFAULT_DIGEST_FALLBACK_BASE_URL);
    assert.equal(endpoint.model, "gemini-3.5-flash-lite");
    assert.equal(endpoint.preferJsonResponseFormat, true);
    assert.equal(endpoint.disableThinking, false);
  });

  test("FALLBACK_MODEL without API key throws", () => {
    setPrimaryEnv();
    process.env.DIGEST_LLM_FALLBACK_MODEL = "gemini-3.5-flash-lite";
    assert.throws(() => getDigestLlmConfig(), /DIGEST_LLM_FALLBACK_API_KEY is missing/);
  });

  test("FALLBACK_API_KEY without model throws", () => {
    setPrimaryEnv();
    process.env.DIGEST_LLM_FALLBACK_API_KEY = "gemini-key";
    assert.throws(() => getDigestLlmConfig(), /DIGEST_LLM_FALLBACK_MODEL is missing/);
  });
});

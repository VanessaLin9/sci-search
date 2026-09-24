import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  credentialFingerprint,
  resolveLlmQuotaTarget,
} from "../../src/llm/llmQuotaBucket.js";
import {
  GENERIC_MIN_START_INTERVAL_MS,
  resolveLlmProviderProfile,
} from "../../src/llm/llmProviderProfile.js";
import {
  GEMINI_MIN_START_INTERVAL_MS,
  NVIDIA_LLM_RATE_POLICY,
  NVIDIA_MIN_START_INTERVAL_MS,
} from "../../src/llm/llmRequestScheduler.js";

describe("llmQuotaBucket", () => {
  test("NVIDIA baseUrl resolves 2s policy and stable fingerprint bucket", () => {
    const key = "nv-secret-key-aaaaaaaa";
    const target = resolveLlmQuotaTarget("https://integrate.api.nvidia.com/v1/", key);
    assert.equal(target.provider, "nvidia");
    assert.equal(target.policy.minStartIntervalMs, NVIDIA_MIN_START_INTERVAL_MS);
    assert.equal(
      target.bucket,
      `nvidia:https://integrate.api.nvidia.com/v1|${credentialFingerprint(key)}`,
    );
    assert.ok(!target.bucket.includes(key));
    assert.ok(!target.logLabel.includes(key));
  });

  test("Gemini OpenAI-compatible baseUrl resolves 5s policy", () => {
    const key = "gem-secret-key-bbbbbbbb";
    const target = resolveLlmQuotaTarget(
      "https://generativelanguage.googleapis.com/v1beta/openai",
      key,
    );
    assert.equal(target.provider, "gemini");
    assert.equal(target.policy.minStartIntervalMs, GEMINI_MIN_START_INTERVAL_MS);
    assert.match(target.bucket, /^gemini:/);
    assert.ok(target.bucket.includes(credentialFingerprint(key)));
  });

  test("unknown baseUrl uses generic spacing, not the NVIDIA 2s policy", () => {
    const key = "other-secret-key-cccccc";
    const target = resolveLlmQuotaTarget("https://llm.example.test/v1", key);
    assert.equal(target.provider, "generic");
    assert.equal(target.policy.minStartIntervalMs, GENERIC_MIN_START_INTERVAL_MS);
    assert.notEqual(target.policy, NVIDIA_LLM_RATE_POLICY);
    assert.match(target.bucket, /^generic:/);
    assert.ok(!target.bucket.includes(key));
  });

  test("explicit generic profile on an NVIDIA host does not share the NVIDIA bucket", () => {
    const base = "https://integrate.api.nvidia.com/v1";
    const key = "nv-secret-key-aaaaaaaa";
    const inferred = resolveLlmQuotaTarget(base, key);
    const generic = resolveLlmProviderProfile({
      baseUrl: base,
      profileId: "generic",
      enableThinking: false,
    });
    const overridden = resolveLlmQuotaTarget(base, key, generic);
    assert.equal(inferred.provider, "nvidia");
    assert.equal(inferred.policy.minStartIntervalMs, NVIDIA_MIN_START_INTERVAL_MS);
    assert.equal(overridden.provider, "generic");
    assert.equal(overridden.policy.minStartIntervalMs, GENERIC_MIN_START_INTERVAL_MS);
    assert.notEqual(inferred.bucket, overridden.bucket);
  });

  test("same key+base share bucket; different keys stay isolated", () => {
    const base = "https://integrate.api.nvidia.com/v1";
    const a = resolveLlmQuotaTarget(base, "key-one-xxxxxxxxxxxx");
    const b = resolveLlmQuotaTarget(base, "key-one-xxxxxxxxxxxx");
    const c = resolveLlmQuotaTarget(base, "key-two-yyyyyyyyyyyy");
    assert.equal(a.bucket, b.bucket);
    assert.notEqual(a.bucket, c.bucket);
  });
});

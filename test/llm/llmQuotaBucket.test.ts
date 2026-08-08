import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  credentialFingerprint,
  resolveLlmQuotaTarget,
} from "../../src/llm/llmQuotaBucket.js";
import {
  GEMINI_MIN_START_INTERVAL_MS,
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

  test("same key+base share bucket; different keys stay isolated", () => {
    const base = "https://integrate.api.nvidia.com/v1";
    const a = resolveLlmQuotaTarget(base, "key-one-xxxxxxxxxxxx");
    const b = resolveLlmQuotaTarget(base, "key-one-xxxxxxxxxxxx");
    const c = resolveLlmQuotaTarget(base, "key-two-yyyyyyyyyyyy");
    assert.equal(a.bucket, b.bucket);
    assert.notEqual(a.bucket, c.bucket);
  });
});

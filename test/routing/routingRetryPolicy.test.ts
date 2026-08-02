import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canAffordWaitAndRequest,
  DEFAULT_RATE_LIMIT_WAIT_MS,
  MAX_RATE_LIMIT_WAIT_MS,
  parseRetryAfterMs,
  planRateLimitWait,
} from "../../src/routing/routingRetryPolicy.js";
import { MIN_USEFUL_REQUEST_MS } from "../../src/routing/routingBudget.js";

describe("routingRetryPolicy", () => {
  test("parseRetryAfterMs supports delta-seconds", () => {
    assert.equal(parseRetryAfterMs(new Headers({ "retry-after": "5" }), 0), 5_000);
  });

  test("parseRetryAfterMs supports HTTP-date", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    const headers = new Headers({ "retry-after": "Wed, 21 Oct 2015 07:28:30 GMT" });
    assert.equal(parseRetryAfterMs(headers, now), 30_000);
  });

  test("planRateLimitWait prefers Retry-After and caps at 60s", () => {
    const plan = planRateLimitWait({
      headers: new Headers({ "retry-after": "120" }),
      nowMs: 0,
      jitterMs: () => 999,
    });
    assert.equal(plan.source, "retry-after");
    assert.equal(plan.waitMs, MAX_RATE_LIMIT_WAIT_MS);
  });

  test("planRateLimitWait uses default + deterministic jitter without hint", () => {
    const plan = planRateLimitWait({
      headers: new Headers(),
      nowMs: 0,
      jitterMs: () => 250,
    });
    assert.equal(plan.source, "default");
    assert.equal(plan.waitMs, DEFAULT_RATE_LIMIT_WAIT_MS + 250);
  });

  test("canAffordWaitAndRequest requires wait plus useful request budget", () => {
    assert.equal(canAffordWaitAndRequest(31_000, 30_000), true);
    assert.equal(
      canAffordWaitAndRequest(30_000 + MIN_USEFUL_REQUEST_MS - 1, 30_000),
      false,
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  APIConnectionTimeoutError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from "openai/core/error.js";
import { classifyRoutingFailure } from "../../src/routing/classifyRoutingFailure.js";

describe("classifyRoutingFailure", () => {
  test("classifies timeout and network from message heuristics", () => {
    assert.equal(classifyRoutingFailure(new Error("Request timed out.")).kind, "timeout");
    assert.equal(classifyRoutingFailure(new Error("Connection error.")).kind, "network");
  });

  test("classifies SDK timeout error", () => {
    assert.equal(classifyRoutingFailure(new APIConnectionTimeoutError()).kind, "timeout");
  });

  test("classifies 429 / 5xx / auth from SDK errors", () => {
    const headers = new Headers({ "retry-after": "2" });
    assert.equal(
      classifyRoutingFailure(new RateLimitError(429, { message: "rate" }, "rate", headers)).kind,
      "rate_limit",
    );
    assert.equal(
      classifyRoutingFailure(new InternalServerError(503, { message: "up" }, "up", headers)).kind,
      "server_error",
    );
    assert.equal(
      classifyRoutingFailure(new AuthenticationError(401, { message: "nope" }, "nope", headers)).kind,
      "auth",
    );
  });

  test("classifies length and parse recoverables", () => {
    assert.equal(classifyRoutingFailure(new Error("x"), "length").kind, "length");
    assert.equal(classifyRoutingFailure(new Error("invalid JSON")).kind, "parse");
  });
});

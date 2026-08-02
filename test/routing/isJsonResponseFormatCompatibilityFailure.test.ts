import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BadRequestError,
  InternalServerError,
  RateLimitError,
  UnprocessableEntityError,
} from "openai/core/error.js";
import { isJsonResponseFormatCompatibilityFailure } from "../../src/routing/isJsonResponseFormatCompatibilityFailure.js";

describe("isJsonResponseFormatCompatibilityFailure", () => {
  test("accepts 400/422 with response_format message", () => {
    const headers = new Headers();
    assert.equal(
      isJsonResponseFormatCompatibilityFailure(
        new BadRequestError(
          400,
          { message: "Invalid parameter: response_format json_object is not supported" },
          "bad",
          headers,
        ),
      ),
      true,
    );
    assert.equal(
      isJsonResponseFormatCompatibilityFailure(
        new UnprocessableEntityError(
          422,
          { message: "response_format type json_object rejected" },
          "unprocessable",
          headers,
        ),
      ),
      true,
    );
  });

  test("accepts plain Error message shapes without status", () => {
    assert.equal(
      isJsonResponseFormatCompatibilityFailure(new Error("json_object unsupported")),
      true,
    );
  });

  test("rejects 429/5xx even when message mentions response_format", () => {
    const headers = new Headers();
    assert.equal(
      isJsonResponseFormatCompatibilityFailure(
        new RateLimitError(
          429,
          { message: "rate limit on response_format json_object" },
          "rate",
          headers,
        ),
      ),
      false,
    );
    assert.equal(
      isJsonResponseFormatCompatibilityFailure(
        new InternalServerError(
          503,
          { message: "upstream failed while validating response_format json_object" },
          "up",
          headers,
        ),
      ),
      false,
    );
  });

  test("rejects unrelated errors", () => {
    assert.equal(isJsonResponseFormatCompatibilityFailure(new Error("Request timed out.")), false);
    assert.equal(
      isJsonResponseFormatCompatibilityFailure(
        new BadRequestError(400, { message: "missing field foo" }, "bad", new Headers()),
      ),
      false,
    );
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isJsonResponseFormatCompatibilityFailure } from "../../src/routing/isJsonResponseFormatCompatibilityFailure.js";

test("detects response_format / json_object compatibility failures", () => {
  assert.equal(
    isJsonResponseFormatCompatibilityFailure(new Error("json_object unsupported")),
    true,
  );
  assert.equal(
    isJsonResponseFormatCompatibilityFailure(new Error("Invalid response_format")),
    true,
  );
  assert.equal(isJsonResponseFormatCompatibilityFailure(new Error("Request timed out.")), false);
  assert.equal(isJsonResponseFormatCompatibilityFailure(new Error("Rate limit exceeded")), false);
});

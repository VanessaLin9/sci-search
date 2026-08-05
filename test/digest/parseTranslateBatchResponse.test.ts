import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatTranslateBatchSummary,
  parseTranslateBatchResponse,
} from "../../src/digest/parseTranslateBatchResponse.js";

const IDS = ["p1", "p2", "p3", "p4", "p5"] as const;

function row(id: string, titleZh: string) {
  return { id, title_zh: titleZh };
}

function body(results: unknown[]) {
  return JSON.stringify({ results });
}

describe("parseTranslateBatchResponse", () => {
  test("keeps all valid rows for a normal response", () => {
    const content = body(IDS.map((id) => row(id, `標題 ${id}`)));
    const parsed = parseTranslateBatchResponse(content, IDS);

    assert.equal(parsed.batchFailed, false);
    assert.equal(parsed.titleZhById.size, 5);
    assert.deepEqual(parsed.failedIds, []);
    assert.deepEqual(parsed.summary, {
      requested: 5,
      valid: 5,
      salvaged: 5,
      invalid: 0,
      missing: 0,
      duplicate: 0,
      unknown: 0,
    });
  });

  test("salvages valid items when one row has invalid_type (2026-07-31 style)", () => {
    // 契約：單列型別錯誤不得拖垮同批合法 titleZh（PR #31）。
    // Regression: one title_zh as number used to fail the whole Zod batch parse.
    const results = [
      row("p1", "標題一"),
      row("p2", "標題二"),
      { id: "p3", title_zh: 12345 },
      row("p4", "標題四"),
      row("p5", "標題五"),
    ];
    const parsed = parseTranslateBatchResponse(body(results), IDS);

    assert.equal(parsed.batchFailed, false);
    assert.equal(parsed.titleZhById.get("p1"), "標題一");
    assert.equal(parsed.titleZhById.get("p2"), "標題二");
    assert.equal(parsed.titleZhById.has("p3"), false);
    assert.equal(parsed.titleZhById.get("p4"), "標題四");
    assert.equal(parsed.titleZhById.get("p5"), "標題五");
    assert.deepEqual(parsed.failedIds, ["p3"]);
    assert.equal(parsed.summary.salvaged, 4);
    assert.equal(parsed.summary.invalid, 1);
    assert.equal(parsed.summary.missing, 1);
    assert.equal(parsed.issues[0]?.kind, "invalid_type");
    assert.match(parsed.issues[0]?.path ?? "", /results\[2\]\.title_zh/);
  });

  test("falls back for whole batch on malformed JSON", () => {
    const parsed = parseTranslateBatchResponse("{ not json", IDS);

    assert.equal(parsed.batchFailed, true);
    assert.equal(parsed.titleZhById.size, 0);
    assert.deepEqual(parsed.failedIds, [...IDS]);
    assert.equal(parsed.issues[0]?.kind, "json_parse");
    assert.equal(parsed.summary.missing, 5);
  });

  test("falls back for whole batch when results is missing", () => {
    const parsed = parseTranslateBatchResponse(JSON.stringify({ items: [] }), IDS);

    assert.equal(parsed.batchFailed, true);
    assert.equal(parsed.issues[0]?.kind, "schema_shape");
    assert.deepEqual(parsed.failedIds, [...IDS]);
  });

  test("does not apply translations by array index when order changes", () => {
    const content = body([
      row("p5", "五"),
      row("p1", "一"),
      row("p3", "三"),
      row("p2", "二"),
      row("p4", "四"),
    ]);
    const parsed = parseTranslateBatchResponse(content, IDS);

    assert.equal(parsed.titleZhById.get("p1"), "一");
    assert.equal(parsed.titleZhById.get("p5"), "五");
    assert.equal(parsed.summary.salvaged, 5);
  });

  test("never maps A paper translation onto B when ids are wrong", () => {
    const content = body([
      row("p1", "給 p1"),
      row("not-in-batch", "不該寫入任何人"),
      { id: "p2", title_zh: null },
    ]);
    const parsed = parseTranslateBatchResponse(content, ["p1", "p2", "p3"]);

    assert.equal(parsed.titleZhById.get("p1"), "給 p1");
    assert.equal(parsed.titleZhById.has("p2"), false);
    assert.equal(parsed.titleZhById.has("p3"), false);
    assert.equal(parsed.summary.unknown, 1);
    assert.equal(parsed.summary.invalid, 1);
    assert.equal(parsed.summary.missing, 2);
    assert.deepEqual(parsed.failedIds, ["p2", "p3"]);
  });

  test("fail-closes duplicate ids instead of keeping the first translation", () => {
    const content = body([row("p1", "一"), row("p1", "重複一"), row("p2", "二")]);
    const parsed = parseTranslateBatchResponse(content, ["p1", "p2"]);

    assert.equal(parsed.titleZhById.has("p1"), false);
    assert.equal(parsed.titleZhById.get("p2"), "二");
    assert.deepEqual(parsed.failedIds, ["p1"]);
    assert.equal(parsed.summary.salvaged, 1);
    assert.equal(parsed.summary.valid, 1);
    assert.equal(parsed.summary.duplicate, 1);
    assert.equal(parsed.summary.missing, 1);
    assert.equal(parsed.issues.some((issue) => issue.kind === "duplicate_id" && issue.id === "p1"), true);
  });

  test("counts missing, extra, duplicate, null, and wrong-type rows", () => {
    const content = body([
      row("p1", "一"),
      row("p1", "重複一"),
      row("ghost", "未知"),
      { id: "p2", title_zh: null },
      { id: "p3" },
      { id: "p4", title_zh: "" },
      row("p5", "五"),
      row("extra-extra", "多餘"),
    ]);
    const parsed = parseTranslateBatchResponse(content, IDS);

    assert.equal(parsed.batchFailed, false);
    assert.equal(parsed.titleZhById.has("p1"), false);
    assert.equal(parsed.titleZhById.get("p5"), "五");
    assert.deepEqual([...parsed.titleZhById.keys()], ["p5"]);
    assert.deepEqual(parsed.failedIds, ["p1", "p2", "p3", "p4"]);
    assert.equal(parsed.summary.valid, 1);
    assert.equal(parsed.summary.salvaged, 1);
    assert.equal(parsed.summary.duplicate, 1);
    assert.equal(parsed.summary.unknown, 2);
    assert.equal(parsed.summary.invalid, 3);
    assert.equal(parsed.summary.missing, 4);

    const kinds = parsed.issues.map((issue) => issue.kind).sort();
    assert.ok(kinds.includes("duplicate_id"));
    assert.ok(kinds.includes("unknown_id"));
    assert.ok(kinds.includes("invalid_type") || kinds.includes("missing_field"));
    assert.ok(kinds.includes("empty_title") || kinds.includes("missing_field"));
  });

  test("formatTranslateBatchSummary is stable for logs", () => {
    assert.equal(
      formatTranslateBatchSummary({
        requested: 5,
        valid: 4,
        salvaged: 4,
        invalid: 1,
        missing: 1,
        duplicate: 0,
        unknown: 0,
      }),
      "requested=5 valid=4 salvaged=4 invalid=1 missing=1 duplicate=0 unknown=0",
    );
  });
});

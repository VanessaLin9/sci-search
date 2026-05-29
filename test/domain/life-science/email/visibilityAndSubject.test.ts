import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DIGEST_SUBJECT_PREFIX } from "../../../../src/domain/life-science/emailBranding.js";
import { emptySectionMessage } from "../../../../src/domain/life-science/email/emailCopy.js";
import { buildDigestSubject } from "../../../../src/domain/life-science/email/subject.js";
import {
  isVisibleInDigest,
  visiblePapers,
} from "../../../../src/domain/life-science/email/visibility.js";

test("isVisibleInDigest excludes skip and missing digest lines", () => {
  assert.equal(isVisibleInDigest({ digestLine: "line-a" }), true);
  assert.equal(isVisibleInDigest({ digestLine: "skip" }), false);
  assert.equal(isVisibleInDigest({}), false);
});

test("visiblePapers omits skip papers from the visible set", () => {
  const papers = [
    { id: "a", digestLine: "line-a" as const },
    { id: "b", digestLine: "skip" as const },
    { id: "c", digestLine: "line-b" as const },
  ];
  assert.deepEqual(visiblePapers(papers).map((paper) => paper.id), ["a", "c"]);
});

test("buildDigestSubject uses visible paper count in the subject", () => {
  assert.equal(
    buildDigestSubject("2026-05-22", 2, DEFAULT_DIGEST_SUBJECT_PREFIX),
    `${DEFAULT_DIGEST_SUBJECT_PREFIX} · 2026-05-22 (2 papers)`,
  );
});

test("emptySectionMessage differs for preprint versus other lines", () => {
  assert.match(emptySectionMessage("preprint"), /preprint/);
  assert.match(emptySectionMessage("line-a"), /主線/);
});

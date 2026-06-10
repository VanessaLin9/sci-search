import assert from "node:assert/strict";
import { test } from "node:test";
import { logBiorxivReportDateSummary } from "../../src/biorxiv/ingestLog.js";

function captureLogs(run: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines;
}

test("logBiorxivReportDateSummary explains zero after fine screen without 0/0", () => {
  const lines = captureLogs(() => {
    logBiorxivReportDateSummary({
      reportDate: "2026-06-03",
      afterFineScreenCount: 0,
      gateCandidatesCount: 1,
      onReportDateCount: 0,
      papers: [],
    });
  });

  assert.equal(lines.length, 1);
  assert.match(
    lines[0]!,
    /\[biorxiv\] report date 2026-06-03: 0 on report date \(fine screen left 0; 1 gate candidate\(s\) before fine screen\)/,
  );
});

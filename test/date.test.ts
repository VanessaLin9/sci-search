import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultReportDateInTaipei,
  todayInTaipei,
  yesterdayInTaipei,
} from "../src/date.js";

test("todayInTaipei formats the injected instant in Asia/Taipei", () => {
  const now = new Date("2026-05-30T04:00:00.000Z");
  assert.equal(todayInTaipei(now), "2026-05-30");
});

test("yesterdayInTaipei is one calendar day before todayInTaipei", () => {
  const now = new Date("2026-05-30T04:00:00.000Z");
  assert.equal(yesterdayInTaipei(now), "2026-05-29");
});

test("defaultReportDateInTaipei returns yesterday in Asia/Taipei", () => {
  const now = new Date("2026-05-30T04:00:00.000Z");
  assert.equal(defaultReportDateInTaipei(now), "2026-05-29");
});

test("defaultReportDateInTaipei respects Taipei midnight boundary", () => {
  const taipeiMidnightUtc = new Date("2026-05-29T16:00:00.000Z");
  assert.equal(todayInTaipei(taipeiMidnightUtc), "2026-05-30");
  assert.equal(defaultReportDateInTaipei(taipeiMidnightUtc), "2026-05-29");
});

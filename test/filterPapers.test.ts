import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dedupePapers,
  filterPapersByDate,
  isPaperOnReportDate,
} from "../src/filterPapers.js";
import { buildPaperId } from "../src/normalize.js";
import { makePaper } from "./helpers/paperTestFixtures.js";

test("dedupePapers keeps first paper when ids match via DOI", () => {
  const id = buildPaperId({
    doi: "10.1234/ABC",
    url: "https://example.com/first",
    title: "First",
  });
  const first = makePaper({ id, doi: "10.1234/ABC", title: "First" });
  const second = makePaper({ id, doi: "10.1234/abc", title: "Duplicate DOI" });
  assert.deepEqual(dedupePapers([first, second]), [first]);
});

test("dedupePapers keeps first paper when ids match via URL fallback", () => {
  const url = "https://example.com/same-article";
  const id = buildPaperId({ url, title: "Title A" });
  const first = makePaper({ id, url, title: "Title A" });
  const second = makePaper({ id, url, title: "Title B" });
  assert.deepEqual(dedupePapers([first, second]), [first]);
});

test("dedupePapers keeps first paper when ids match via normalized title fallback", () => {
  const title = "Shared Title";
  const id = buildPaperId({ title, url: "" });
  const first = makePaper({
    id,
    title,
    url: "https://example.com/a",
  });
  const second = makePaper({
    id,
    title: "  Shared   Title  ",
    url: "https://example.com/b",
  });
  assert.deepEqual(dedupePapers([first, second]), [first]);
});

test("buildPaperId uses URL when DOI is absent", () => {
  const url = "https://example.com/no-doi";
  assert.equal(buildPaperId({ title: "Any", url }), url);
});

test("buildPaperId uses normalized lowercase title when DOI and URL are absent", () => {
  assert.equal(buildPaperId({ title: "  My Paper Title  ", url: "" }), "my paper title");
});

test("isPaperOnReportDate uses Asia/Taipei calendar day", () => {
  const paper = makePaper({
    id: "tz-1",
    publishedDate: "2026-05-21T16:00:00.000Z",
  });
  assert.equal(isPaperOnReportDate(paper, "2026-05-22"), true);
  assert.equal(isPaperOnReportDate(paper, "2026-05-21"), false);
});

test("filterPapersByDate keeps only papers on the report date", () => {
  const onDate = makePaper({
    id: "on-date",
    publishedDate: "2026-05-22T01:00:00.000Z",
  });
  const offDate = makePaper({
    id: "off-date",
    publishedDate: "2026-05-21T10:00:00.000Z",
  });
  assert.deepEqual(filterPapersByDate([onDate, offDate], "2026-05-22"), [onDate]);
});

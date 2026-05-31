import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  fetchBiorxivCategoryPage,
  fetchBiorxivCategoryRecords,
  fetchBiorxivRecords,
} from "../src/fetchBiorxiv.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/biorxiv");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
}

function createFixtureFetch(fixturesByUrl: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const fixture = fixturesByUrl[url];
    if (!fixture) {
      throw new Error(`No fixture for ${url}`);
    }
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

test("fetchBiorxivCategoryPage parses a single page", async () => {
  const url =
    "https://api.biorxiv.org/details/biorxiv/2026-05-28/2026-05-28/0/json?category=cell_biology";
  const page = await fetchBiorxivCategoryPage(
    "https://api.biorxiv.org/details/biorxiv",
    "2026-05-28",
    "cell_biology",
    0,
    createFixtureFetch({ [url]: loadFixture("sample-page.json") }),
  );

  assert.equal(page.records.length, 2);
  assert.equal(page.nextCursor, null);
});

test("fetchBiorxivCategoryPage returns empty when API reports no posts found", async () => {
  const url =
    "https://api.biorxiv.org/details/biorxiv/2026-05-28/2026-05-28/0/json?category=synthetic_biology";
  const page = await fetchBiorxivCategoryPage(
    "https://api.biorxiv.org/details/biorxiv",
    "2026-05-28",
    "synthetic_biology",
    0,
    createFixtureFetch({
      [url]: {
        messages: [{ status: "no posts found" }],
        collection: [],
      },
    }),
  );

  assert.deepEqual(page, { records: [], nextCursor: null });
});

test("fetchBiorxivCategoryRecords paginates until total is reached", async () => {
  const page0Url =
    "https://api.biorxiv.org/details/biorxiv/2026-05-28/2026-05-28/0/json?category=cell_biology";
  const page1Url =
    "https://api.biorxiv.org/details/biorxiv/2026-05-28/2026-05-28/1/json?category=cell_biology";

  const records = await fetchBiorxivCategoryRecords(
    "https://api.biorxiv.org/details/biorxiv",
    "2026-05-28",
    "cell_biology",
    createFixtureFetch({
      [page0Url]: loadFixture("sample-page-0.json"),
      [page1Url]: loadFixture("sample-page-1.json"),
    }),
  );

  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((record: { title?: string }) => record.title),
    ["Page one preprint", "Page two preprint"],
  );
});

test("fetchBiorxivRecords merges multiple categories", async () => {
  const cellUrl =
    "https://api.biorxiv.org/details/biorxiv/2026-05-28/2026-05-28/0/json?category=cell_biology";
  const neuroUrl =
    "https://api.biorxiv.org/details/biorxiv/2026-05-28/2026-05-28/0/json?category=neuroscience";

  const result = await fetchBiorxivRecords({
    baseUrl: "https://api.biorxiv.org/details/biorxiv",
    reportDate: "2026-05-28",
    categories: ["cell_biology", "neuroscience"],
    fetchFn: createFixtureFetch({
      [cellUrl]: loadFixture("sample-page.json"),
      [neuroUrl]: {
        messages: [
          {
            status: "ok",
            category: "neuroscience",
            interval: "2026-05-28:2026-05-28",
            cursor: 0,
            count: 1,
            total: "1",
          },
        ],
        collection: [
          {
            title: "Neuroscience preprint",
            authors: "Neuro, N.",
            doi: "10.1101/2026.05.28.333333",
            date: "2026-05-28",
            version: "1",
            category: "neuroscience",
            abstract: "Neuroscience abstract.",
            server: "biorxiv",
          },
        ],
      },
    }),
  });

  assert.equal(result.categoryCount, 2);
  assert.equal(result.fetchedCount, 3);
  assert.equal(result.records.length, 3);
});

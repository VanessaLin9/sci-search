import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSourceScopeById } from "../../../src/domain/life-science/routing/sourceScope.js";
import type { Paper } from "../../../src/types.js";

process.env.ROUTE_LIFE_SCIENCE = "0";
process.env.ROUTING_KEYWORDS_CONFIG_PATH = join(
  tmpdir(),
  `routing-keywords-missing-${process.pid}.json`,
);

const { routeLifeSciencePapers } = await import("../../../src/routing/routeLifeScience.js");

const scopeBySourceId = buildSourceScopeById([
  { id: "nature-methods", scope: "life-science-only" },
  { id: "science", scope: "broad-science" },
]);

const makePaper = (id: string, sourceId: string): Paper => ({
  id,
  title: `Title ${id}`,
  journal: "Test Journal",
  publishedDate: "2026-06-10",
  url: `https://example.test/${id}`,
  sourceId,
});

const result = await routeLifeSciencePapers({
  papers: [makePaper("ls-1", "nature-methods"), makePaper("bs-1", "science")],
  scopeBySourceId,
});

assert.equal(result.enabled, false);
assert.equal(result.included.length, 2);
assert.equal(result.excluded.length, 0);

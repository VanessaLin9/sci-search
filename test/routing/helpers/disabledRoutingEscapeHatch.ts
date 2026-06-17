import assert from "node:assert/strict";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { buildSourceScopeById } from "../../../src/domain/life-science/routing/sourceScope.js";
import type { Paper } from "../../../src/types.js";

const configPath = join(process.cwd(), "config/routing-keywords.json");
const hiddenPath = `${configPath}.disabled-routing-test-hidden`;
const hadConfig = existsSync(configPath);
if (hadConfig) {
  renameSync(configPath, hiddenPath);
}

try {
  process.env.ROUTE_LIFE_SCIENCE = "0";

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
} finally {
  if (hadConfig && existsSync(hiddenPath)) {
    renameSync(hiddenPath, configPath);
  }
}

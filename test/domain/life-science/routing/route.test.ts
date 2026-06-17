import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSourceScopeById } from "../../../../src/domain/life-science/routing/sourceScope.js";
import {
  applyScopeDefaultRouting,
  assembleRoutingResult,
  mergeBroadScienceRoutingResults,
  routingResultWhenDisabled,
  splitPapersByRoutingScope,
} from "../../../../src/domain/life-science/routing/route.js";
import { LIFE_SCIENCE_ROUTING_EXCLUSION_REASON } from "../../../../src/domain/life-science/constants.js";
import type { LifeScienceRouting } from "../../../../src/domain/life-science/types.js";

function makeRoutablePaper(id: string, sourceId: string) {
  return { id, sourceId };
}

type RoutedPaper = ReturnType<typeof makeRoutablePaper> & {
  lifeScienceRouting: LifeScienceRouting;
};

const scopeBySourceId = buildSourceScopeById([
  { id: "nature-methods", scope: "life-science-only" },
  { id: "science", scope: "broad-science" },
]);

test("splitPapersByRoutingScope sends life-science-only sources to scope-default bucket", () => {
  const lifeScience = makeRoutablePaper("ls-1", "nature-methods");
  const broad = makeRoutablePaper("bs-1", "science");
  const split = splitPapersByRoutingScope([lifeScience, broad], scopeBySourceId);
  assert.deepEqual(split.lifeScienceOnly, [lifeScience]);
  assert.deepEqual(split.broadScience, [broad]);
});

test("applyScopeDefaultRouting auto-passes with scope-default yes verdict", () => {
  const paper = makeRoutablePaper("ls-1", "nature-methods");
  const [routed] = applyScopeDefaultRouting([paper]);
  assert.deepEqual(routed.lifeScienceRouting, {
    verdict: "yes",
    method: "scope-default",
  });
});

test("mergeBroadScienceRoutingResults excludes no verdicts", () => {
  const paper = makeRoutablePaper("bs-no", "science");
  const merge = mergeBroadScienceRoutingResults([paper], new Map([["bs-no", "no"]]));
  assert.equal(merge.included.length, 0);
  assert.equal(merge.excluded.length, 1);
  assert.equal(merge.excluded[0]?.reason, LIFE_SCIENCE_ROUTING_EXCLUSION_REASON);
  assert.equal(merge.excluded[0]?.method, "llm");
  assert.equal(merge.excluded[0]?.verdict, "no");
  assert.equal(merge.llmNo, 1);
});

test("mergeBroadScienceRoutingResults includes yes and not_sure verdicts", () => {
  const yesPaper = makeRoutablePaper("bs-yes", "science");
  const notSurePaper = makeRoutablePaper("bs-maybe", "science");
  const merge = mergeBroadScienceRoutingResults(
    [yesPaper, notSurePaper],
    new Map([
      ["bs-yes", "yes"],
      ["bs-maybe", "not_sure"],
    ]),
  );
  assert.equal(merge.included.length, 2);
  assert.equal(merge.excluded.length, 0);
  assert.equal(merge.llmYes, 1);
  assert.equal(merge.llmNotSure, 1);
  assert.deepEqual((merge.included[0] as RoutedPaper).lifeScienceRouting, {
    verdict: "yes",
    method: "llm",
  });
  assert.deepEqual((merge.included[1] as RoutedPaper).lifeScienceRouting, {
    verdict: "not_sure",
    method: "llm",
  });
});

test("mergeBroadScienceRoutingResults throws when a broad-science verdict is missing", () => {
  const paper = makeRoutablePaper("bs-missing", "science");
  assert.throws(
    () => mergeBroadScienceRoutingResults([paper], new Map()),
    /Missing routing verdict for bs-missing/,
  );
});

test("assembleRoutingResult builds stats for scope-default and LLM paths", () => {
  const scopeDefault = applyScopeDefaultRouting([makeRoutablePaper("ls-1", "nature-methods")]);
  const broadMerge = mergeBroadScienceRoutingResults(
    [makeRoutablePaper("bs-yes", "science"), makeRoutablePaper("bs-no", "science")],
    new Map([
      ["bs-yes", "yes"],
      ["bs-no", "no"],
    ]),
  );
  const result = assembleRoutingResult({
    scopeDefaultIncluded: scopeDefault,
    broadScienceMerge: broadMerge,
    total: 3,
  });
  assert.equal(result.enabled, true);
  assert.equal(result.included.length, 2);
  assert.equal(result.excluded.length, 1);
  assert.deepEqual(result.stats, {
    total: 3,
    passedByScope: 1,
    llmClassified: 2,
    llmYes: 1,
    llmNotSure: 0,
    llmNo: 1,
    keywordFallbackClassified: 0,
    keywordFallbackYes: 0,
    keywordFallbackNo: 0,
    included: 2,
    excluded: 1,
  });
});

test("routingResultWhenDisabled returns all papers included without routing metadata", () => {
  const papers = [makeRoutablePaper("p-1", "science")];
  const result = routingResultWhenDisabled(papers);
  assert.equal(result.enabled, false);
  assert.deepEqual(result.included, papers);
  assert.deepEqual(result.excluded, []);
  assert.equal(result.stats.included, 1);
  assert.equal(result.stats.passedByScope, 0);
  assert.equal(result.stats.llmClassified, 0);
});

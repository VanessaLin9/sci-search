import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { loadRoutingKeywordsConfig } from "../../src/config.js";
import { matchRoutingKeywordFallback } from "../../src/domain/life-science/routing/keywordFallbackMatcher.js";

const config = loadRoutingKeywordsConfig();

describe("matchRoutingKeywordFallback", () => {
  test("include hit → yes", () => {
    const result = matchRoutingKeywordFallback(
      "Semaglutide attenuates neuroinflammation in male mice",
      config,
    );
    assert.equal(result.verdict, "yes");
    assert.ok(result.matchedIncludes.length > 0);
    assert.equal(result.matchedExcludes.length, 0);
  });

  test("strong exclude hit → no", () => {
    const result = matchRoutingKeywordFallback(
      "A quantum leap in neutrino detection using superconductors",
      config,
    );
    assert.equal(result.verdict, "no");
    assert.ok(result.matchedExcludes.length > 0);
    assert.equal(result.matchedIncludes.length, 0);
  });

  test("strong exclude wins over include", () => {
    const result = matchRoutingKeywordFallback(
      "Quantum effects on cancer therapy in mice",
      config,
    );
    assert.equal(result.verdict, "no");
    assert.ok(result.matchedExcludes.includes("quantum"));
  });

  test("ambiguous / no hit → no", () => {
    const result = matchRoutingKeywordFallback("Title bs-1", config);
    assert.equal(result.verdict, "no");
    assert.equal(result.matchedIncludes.length, 0);
    assert.equal(result.matchedExcludes.length, 0);
  });
});

describe("matchRoutingKeywordFallback regression fixture", () => {
  test("reports precision/recall on 185-paper analysis set", () => {
    const analysisPath = join(
      process.cwd(),
      "test/fixtures/routing/broad-science-routing-regression.json",
    );
    const analysis = JSON.parse(readFileSync(analysisPath, "utf8")) as {
      papers: Array<{ title: string; verdict: "yes" | "no" | "not_sure" }>;
    };

    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const paper of analysis.papers) {
      const expectedYes = paper.verdict === "yes" || paper.verdict === "not_sure";
      const predictedYes = matchRoutingKeywordFallback(paper.title, config).verdict === "yes";
      if (predictedYes && expectedYes) tp += 1;
      else if (predictedYes && !expectedYes) fp += 1;
      else if (!predictedYes && expectedYes) fn += 1;
      else tn += 1;
    }

    const precision = tp / (tp + fp || 1);
    const recall = tp / (tp + fn || 1);

    console.log(
      JSON.stringify({ tp, fp, fn, tn, precision, recall, total: analysis.papers.length }),
    );

    assert.ok(precision >= 0.9, `precision ${precision}`);
    assert.ok(recall >= 0.7, `recall ${recall}`);
  });
});

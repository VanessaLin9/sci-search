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

  test("strong exclude still wins when only wide stems include", () => {
    const result = matchRoutingKeywordFallback(
      "Quantum regulation of photonic activity",
      config,
    );
    assert.equal(result.verdict, "no");
    assert.ok(result.matchedExcludes.includes("quantum"));
    assert.equal(result.matchedIncludes.length, 0);
  });

  test("term-level include keeps yes when exclude also hits", () => {
    const organoid = matchRoutingKeywordFallback(
      "Label-free characterization of neural organoids via deep learning-enhanced Raman spectroscopy",
      config,
    );
    assert.equal(organoid.verdict, "yes");
    assert.ok(organoid.matchedIncludes.includes("organoid"));
    assert.ok(organoid.matchedExcludes.includes("deep learning"));

    const malaria = matchRoutingKeywordFallback(
      "Malaria risk under climate change in highland East Africa",
      config,
    );
    assert.equal(malaria.verdict, "yes");
    assert.ok(malaria.matchedIncludes.includes("malaria"));
  });

  test("wide stems no longer rescue astronomy or materials false positives", () => {
    const cluster = matchRoutingKeywordFallback(
      "Evidence for the first globular cluster stellar stream beyond the Milky Way",
      config,
    );
    assert.equal(cluster.verdict, "no");

    const porous = matchRoutingKeywordFallback(
      "Breaking solubility of metal-organic cages in a type II porous liquid of n-alkanes",
      config,
    );
    assert.equal(porous.verdict, "no");
  });

  test("damaged DNA aging news is yes; DNA data storage stays no", () => {
    const aging = matchRoutingKeywordFallback("Could mending damaged DNA prolong life?", config);
    assert.equal(aging.verdict, "yes");

    const storage = matchRoutingKeywordFallback(
      "Electric field-guided random-access DNA data storage",
      config,
    );
    assert.equal(storage.verdict, "no");
  });

  test("ambiguous / no hit → no", () => {
    const result = matchRoutingKeywordFallback("Title bs-1", config);
    assert.equal(result.verdict, "no");
    assert.equal(result.matchedIncludes.length, 0);
    assert.equal(result.matchedExcludes.length, 0);
  });
});

describe("matchRoutingKeywordFallback regression fixture", () => {
  test("reports precision/recall on the analysis set", () => {
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

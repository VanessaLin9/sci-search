import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAPER_ENRICHER_REGISTRY,
  RSS_ABSTRACT_EXTRACTOR_REGISTRY,
  RSS_SKIP_RULE_REGISTRY,
  type PaperEnricherKind,
  type RssAbstractExtractorKind,
  type RssSkipRuleKind,
} from "../../../src/domain/life-science/feeds/registries.js";
import { PAPER_ENRICHER_REGISTRY as exportedEnricherRegistry } from "../../../src/enrichers/index.js";
import {
  extractRssAbstract,
  RSS_ABSTRACT_EXTRACTOR_REGISTRY as wiredAbstractRegistry,
  RSS_SKIP_RULE_REGISTRY as wiredSkipRegistry,
  shouldSkipRssItem,
} from "../../../src/normalizers/rss/index.js";
import { makeRssItem } from "../../helpers/rssTestFixtures.js";

const WIRED_SKIP_RULE_KINDS: RssSkipRuleKind[] = ["pnas-editorial", "nature-encoded"];
const WIRED_ABSTRACT_EXTRACTOR_KINDS: RssAbstractExtractorKind[] = [
  "nature-main",
  "nature-methods",
  "nature-communications",
  "nature-ecology-evolution",
  "nature-biotechnology",
  "nature-cell-biology",
  "nature-neuroscience",
  "nature-immunology",
  "nature-microbiology",
  "plos-biology",
  "pnas",
  "science",
  "science-advances",
];
const WIRED_ENRICHER_KINDS: PaperEnricherKind[] = [
  "nature-main",
  "nature-methods",
  "pnas",
  "science",
  "science-advances",
];

test("RSS skip rule registry kinds are wired in normalizers", () => {
  for (const kind of Object.values(RSS_SKIP_RULE_REGISTRY)) {
    assert.ok(WIRED_SKIP_RULE_KINDS.includes(kind));
  }
  assert.deepEqual(Object.keys(wiredSkipRegistry).sort(), Object.keys(RSS_SKIP_RULE_REGISTRY).sort());
});

test("RSS abstract extractor registry kinds are wired in normalizers", () => {
  for (const kind of Object.values(RSS_ABSTRACT_EXTRACTOR_REGISTRY)) {
    assert.ok(WIRED_ABSTRACT_EXTRACTOR_KINDS.includes(kind));
  }
  assert.deepEqual(
    Object.keys(wiredAbstractRegistry).sort(),
    Object.keys(RSS_ABSTRACT_EXTRACTOR_REGISTRY).sort(),
  );
});

test("paper enricher registry kinds are wired in enrichers", () => {
  for (const kind of Object.values(PAPER_ENRICHER_REGISTRY)) {
    assert.ok(WIRED_ENRICHER_KINDS.includes(kind));
  }
  assert.deepEqual(
    Object.keys(exportedEnricherRegistry).sort(),
    Object.keys(PAPER_ENRICHER_REGISTRY).sort(),
  );
});

test("registered skip sources invoke skip routing without throwing", () => {
  const item = makeRssItem();
  for (const sourceId of Object.keys(RSS_SKIP_RULE_REGISTRY)) {
    assert.equal(typeof shouldSkipRssItem(sourceId, item), "boolean");
  }
});

test("registered abstract sources invoke extractor routing without throwing", () => {
  const item = makeRssItem();
  for (const sourceId of Object.keys(RSS_ABSTRACT_EXTRACTOR_REGISTRY)) {
    const result = extractRssAbstract(sourceId, item);
    assert.ok(result === undefined || typeof result === "string");
  }
});

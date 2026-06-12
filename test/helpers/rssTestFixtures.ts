import type { Item } from "rss-parser";
import type { Source } from "../../src/types.js";

/** Matches `RssItemWithCustomFields` in src/normalize.ts (RSS `source` holds DOI on some feeds). */
export type RssItemWithCustomFields = Item & {
  dcIdentifier?: string;
  source?: string;
};

export function makeRssSource(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    name: "Test Journal",
    publisher: "Test",
    kind: "rss",
    url: "https://example.com/feed",
    priority: 1,
    scope: "life-science-only",
    ...overrides,
  };
}

export function makeRssItem(overrides: Partial<RssItemWithCustomFields> = {}): Item {
  return {
    title: "A paper title",
    link: "https://example.com/article",
    isoDate: "2026-05-22T00:00:00.000Z",
    ...overrides,
  } as Item;
}

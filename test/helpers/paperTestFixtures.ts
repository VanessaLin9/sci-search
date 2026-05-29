import type { Paper } from "../../src/types.js";

export function makePaper(overrides: Partial<Paper> & Pick<Paper, "id">): Paper {
  return {
    title: "Test paper",
    journal: "Test Journal",
    publishedDate: "2026-05-22T12:00:00.000Z",
    url: "https://example.com/article-1",
    sourceId: "cell",
    ...overrides,
  };
}

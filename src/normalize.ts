import type { Paper } from "./types.js";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildPaperId(paper: Pick<Paper, "doi" | "url" | "title">): string {
  if (paper.doi) return paper.doi.toLowerCase();
  if (paper.url) return paper.url;
  return normalizeWhitespace(paper.title).toLowerCase();
}

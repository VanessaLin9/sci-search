import { fetchAbstractFromCrossref } from "../crossref.js";
import type { Paper } from "../types.js";

/** Fetch abstract from Crossref when RSS/HTML metadata is missing or unreliable. */
export async function enrichPaperFromCrossref(paper: Paper): Promise<Paper> {
  if (paper.abstract?.trim()) return paper;
  if (!paper.doi) return paper;

  const abstract = await fetchAbstractFromCrossref(paper.doi);
  if (!abstract) return paper;

  return { ...paper, abstract };
}

import { fetchAbstractFromCrossref } from "../crossref.js";
import type { Paper } from "../types.js";

/**
 * PNAS blocks programmatic HTML fetch (403). Use Crossref metadata by DOI instead.
 * Some article types (e.g. commentary) have no abstract in Crossref — leave empty.
 */
export async function enrichPnasPaper(paper: Paper): Promise<Paper> {
  if (paper.abstract?.trim()) return paper;
  if (!paper.doi) return paper;

  const abstract = await fetchAbstractFromCrossref(paper.doi);
  if (!abstract) return paper;

  return { ...paper, abstract };
}

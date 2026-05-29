import type { DigestLine } from "../types.js";

/** Email body omits papers with digestLine === "skip" (INV-043). */
export function isVisibleInDigest(paper: { digestLine?: DigestLine }): boolean {
  return Boolean(paper.digestLine && paper.digestLine !== "skip");
}

export function visiblePapers<P extends { digestLine?: DigestLine }>(papers: P[]): P[] {
  return papers.filter(isVisibleInDigest);
}

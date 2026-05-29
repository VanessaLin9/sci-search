import type { DigestLine } from "../types.js";

export type FeaturedDigestLineBucket = "line-a" | "line-b" | "preprint";

/**
 * Bucket featured papers for email sections (INV-038).
 * Unknown/missing digestLine silently falls back to line-b — same as renderer policy.
 */
export function featuredDigestLineBucket(line: DigestLine | undefined): FeaturedDigestLineBucket {
  if (line === "line-a" || line === "line-b" || line === "preprint") {
    return line;
  }
  return "line-b";
}

/** @deprecated Use featuredDigestLineBucket — shared normalize for any unknown digest line. */
export function normalizeDigestLine(line: DigestLine | undefined): FeaturedDigestLineBucket {
  return featuredDigestLineBucket(line);
}

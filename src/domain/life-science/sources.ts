/**
 * Default RSS source IDs for the pipeline, in priority order.
 * Excludes non-RSS kinds (e.g. elife csv, biorxiv-api) from config/sources.json.
 */
export const DEFAULT_RSS_SOURCE_IDS = [
  "cell",
  "nature",
  "science",
  "nature-methods",
  "nature-genetics",
  "nature-ecology-evolution",
  "nature-biotechnology",
  "nature-cell-biology",
  "nature-neuroscience",
  "nature-immunology",
  "nature-microbiology",
  "science-advances",
  "pnas",
  "plos-biology",
  "nature-communications",
] as const;

export type DefaultRssSourceId = (typeof DEFAULT_RSS_SOURCE_IDS)[number];

/** Default bioRxiv API source IDs for the pipeline. */
export const DEFAULT_BIORXIV_SOURCE_IDS = ["biorxiv"] as const;

export type DefaultBiorxivSourceId = (typeof DEFAULT_BIORXIV_SOURCE_IDS)[number];

/** Sources whose papers must always land in the preprint digest line (never line-a/line-b). */
export const PREPRINT_SOURCE_IDS = [...DEFAULT_BIORXIV_SOURCE_IDS] as const;

export function isPreprintSource(sourceId: string): boolean {
  return (PREPRINT_SOURCE_IDS as readonly string[]).includes(sourceId);
}

/** Per-source scope assignments (broad-science vs life-science-only). */
export const SOURCE_SCOPE_BY_ID = {
  cell: "life-science-only",
  nature: "broad-science",
  science: "broad-science",
  "nature-methods": "life-science-only",
  "nature-genetics": "life-science-only",
  "nature-ecology-evolution": "life-science-only",
  "nature-biotechnology": "life-science-only",
  "nature-cell-biology": "life-science-only",
  "nature-neuroscience": "life-science-only",
  "nature-immunology": "life-science-only",
  "nature-microbiology": "life-science-only",
  "science-advances": "broad-science",
  pnas: "broad-science",
  elife: "life-science-only",
  "plos-biology": "life-science-only",
  "nature-communications": "broad-science",
  biorxiv: "life-science-only",
} as const;

/** Primary keywords (single-cell / spatial omics) — canonical policy table (was config/keywords.json). */
export const PRIMARY_KEYWORDS = [
  "single cell",
  "single-cell",
  "single-cell ATAC",
  "single nucleus",
  "single-nucleus",
  "scRNA-seq",
  "snRNA-seq",
  "spatial transcriptomics",
  "spatial omics",
  "spatial proteomics",
  "spatial resolution",
  "spatial deconvolution",
  "spatial metabolomics",
  "spatial domains",
  "multi-omics",
  "MERFISH",
  "Xenium",
  "Visium",
  "Slide-seq",
  "Stereo-seq",
  "CITE-seq",
  "Perturb-seq",
  "CosMx",
  "Merscope",
  "STARmap",
  "SeqFISH",
] as const;

/** Biology keywords — canonical policy table (was config/keywords.json). */
export const BIOLOGY_KEYWORDS = [
  "biology",
  "neuroscience",
  "immunology",
  "cancer",
  "development",
  "evolution",
  "microbiome",
  "CRISPR",
  "genome",
  "structural biology",
  "synthetic biology",
] as const;

export type LifeScienceKeywordsConfig = {
  primary: readonly string[];
  biology: readonly string[];
};

export const LIFE_SCIENCE_KEYWORDS: LifeScienceKeywordsConfig = {
  primary: PRIMARY_KEYWORDS,
  biology: BIOLOGY_KEYWORDS,
};

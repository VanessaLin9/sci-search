export type SourceKind = "rss" | "biorxiv-api" | "csv";

export type PaperSection = "single-cell-spatial" | "biology" | "other";

export type Source = {
  id: string;
  name: string;
  publisher: string;
  kind: SourceKind;
  url: string;
  priority: number;
};

export type Paper = {
  id: string;
  title: string;
  journal: string;
  publishedDate: string;
  url: string;
  doi?: string;
  abstract?: string;
  /** Nature.com dc.type from article HTML (e.g. News, OriginalPaper). */
  articleType?: string;
  authors?: string[];
  sourceId: string;
  matchedKeywords: string[];
  section: PaperSection;
};

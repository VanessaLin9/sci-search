export type SourceKind = "rss" | "biorxiv-api" | "csv";

/** Phase 2 routing: broad-science feeds need title-only LLM life-science gate. */
export type SourceScope = "life-science-only" | "broad-science";

export type PaperSection = "single-cell-spatial" | "biology" | "other";

/** Phase 2a: is this paper life-science relevant? */
export type LifeScienceRoutingVerdict = "yes" | "no" | "not_sure";

export type LifeScienceRoutingMethod = "scope-default" | "llm";

export type LifeScienceRouting = {
  verdict: LifeScienceRoutingVerdict;
  method: LifeScienceRoutingMethod;
};

export type Source = {
  id: string;
  name: string;
  publisher: string;
  kind: SourceKind;
  url: string;
  priority: number;
  scope: SourceScope;
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
  /** Set after Phase 2a life-science routing. */
  lifeScienceRouting?: LifeScienceRouting;
};

import { z } from "zod";
import type {
  DigestLine,
  DigestTaggingMethod,
  LifeSciencePaperView,
  LifeScienceRouting,
  LifeScienceRoutingMethod,
  LifeScienceRoutingVerdict,
  PaperSection,
  SourceScope,
} from "./domain/life-science/index.js";

export type SourceKind = "rss" | "biorxiv-api" | "csv";

export type {
  DigestLine,
  DigestTaggingMethod,
  LifeScienceRouting,
  LifeScienceRoutingMethod,
  LifeScienceRoutingVerdict,
  PaperSection,
  SourceScope,
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
  /** Set after Phase 2a life-science routing. */
  lifeScienceRouting?: LifeScienceRouting;
};

/** Shape after the keyword-classify step; also the final shape persisted to JSON. */
export type ClassifiedPaper = Paper & LifeSciencePaperView;

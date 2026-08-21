import { PRIMARY_KEYWORDS } from "../keywords.js";
import { isPreprintSource } from "../sources.js";
import type { PaperSection } from "../types.js";

/** dc.type / articleType values treated as non-research（對齊 nature-main enrich 排除清單）。 */
const EXCLUDED_ARTICLE_TYPES = new Set(
  [
    "Book Review",
    "Nature Podcast",
    "Nature Careers Podcast",
    "Futures",
    "Editorial",
    "Comment",
    "World View",
    "Career Column",
    "Books & Arts",
    "Outlook",
    "News & Views",
    "News Feature",
    "Publisher Correction",
    "Author Correction",
    "Corrigendum",
    "Erratum",
  ].map((value) => value.toLowerCase()),
);

const TITLE_NON_RESEARCH =
  /^(editorial(\s+note)?|author correction|publisher correction|corrigendum|erratum|obituary|reply to)\b/i;

const TITLE_CAREER_ADVICE = /\b(trainee advice|career advice|career column)\b/i;

const OBITUARY_YEARS = /\(\d{4}\s*[–-]\s*\d{4}\)\s*$/;

export type DigestSkipInput = {
  title: string;
  sourceId: string;
  abstract?: string;
  articleType?: string;
  matchedKeywords?: readonly string[];
  section?: PaperSection;
};

function titleWordCount(title: string): number {
  return title.trim().split(/\s+/).filter(Boolean).length;
}

function isNatureFamilySource(sourceId: string): boolean {
  return sourceId === "nature" || sourceId.startsWith("nature-");
}

function hasPrimaryKeyword(matchedKeywords: readonly string[] | undefined): boolean {
  if (!matchedKeywords || matchedKeywords.length === 0) return false;
  const primary = new Set(PRIMARY_KEYWORDS.map((keyword) => keyword.toLowerCase()));
  return matchedKeywords.some((keyword) => primary.has(keyword.toLowerCase()));
}

/**
 * Deterministic non-research skip before spatial A/B（PR #38）。
 * 只用明確 non-research 訊號（articleType / editorial title / Nature 短 editorial 標題）；
 * 缺 abstract 不是 skip——只影響 featured 資格，仍可進 overflow（PR #27 / #38）。
 */
export function shouldSkipForDigest(paper: DigestSkipInput): boolean {
  if (isPreprintSource(paper.sourceId)) return false;

  const title = paper.title.trim();
  const articleType = paper.articleType?.trim().toLowerCase() ?? "";

  if (articleType && EXCLUDED_ARTICLE_TYPES.has(articleType)) {
    return true;
  }

  if (
    TITLE_NON_RESEARCH.test(title) ||
    TITLE_CAREER_ADVICE.test(title) ||
    OBITUARY_YEARS.test(title)
  ) {
    return true;
  }

  // Nature 家族短標題、且未命中 primary spatial/sc 關鍵字：常見 editorial／commentary
  //（例如 “From reading to writing”）。
  if (
    isNatureFamilySource(paper.sourceId) &&
    titleWordCount(title) <= 4 &&
    !hasPrimaryKeyword(paper.matchedKeywords)
  ) {
    return true;
  }

  return false;
}

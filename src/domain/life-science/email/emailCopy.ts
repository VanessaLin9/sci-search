import { DIGEST_PRODUCT_NAME } from "../emailBranding.js";
import type { DigestLine } from "../types.js";

/** Page `<title>` and header `<h1>` product name (INV-040). */
export const DIGEST_PAGE_TITLE = DIGEST_PRODUCT_NAME;

/** Header subtitle under the product name (INV-040). */
export const DIGEST_HEADER_SUBTITLE =
  "Daily Digest · 當日新論文（單細胞/空間組學 + 重要生物學發現）";

export function digestPageTitle(reportDate: string): string {
  return `${DIGEST_PAGE_TITLE} · ${reportDate}`;
}

/** Empty-state copy keyed by digest line section (INV-041). */
export function emptySectionMessage(line: DigestLine): string {
  return line === "preprint" ? "本期無 preprint 精選。" : "今日此主線無精選文章。";
}

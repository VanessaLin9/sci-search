import type { Paper, PaperSection } from "../types.js";
import { escapeHtml } from "./escapeHtml.js";

const SECTION_LABELS: Record<PaperSection, string> = {
  "single-cell-spatial": "主線 A：單細胞 / 空間組學",
  biology: "主線 B：重要生物學新結果",
  other: "其他候選",
};

const SECTION_ORDER: PaperSection[] = ["single-cell-spatial", "biology", "other"];

export type RenderDigestHtmlOptions = {
  reportDate: string;
  papers: Paper[];
  generatedAt?: string;
};

function formatPublishedDate(publishedDate: string): string {
  const parsed = new Date(publishedDate);
  if (Number.isNaN(parsed.getTime())) return publishedDate;
  return parsed.toISOString().slice(0, 10);
}

function renderPaperCard(paper: Paper): string {
  const abstract = paper.abstract?.trim();
  const keywords =
    paper.matchedKeywords.length > 0
      ? `<p style="margin:8px 0 0;font-size:12px;color:#555;">Keywords: ${escapeHtml(paper.matchedKeywords.join(", "))}</p>`
      : "";

  return `
    <div style="margin:0 0 20px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;">
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">${escapeHtml(paper.journal)} · ${escapeHtml(formatPublishedDate(paper.publishedDate))}</p>
      <h3 style="margin:0 0 8px;font-size:16px;line-height:1.4;">
        <a href="${escapeHtml(paper.url)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(paper.title)}</a>
      </h3>
      ${
        abstract
          ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#111827;">${escapeHtml(abstract)}</p>`
          : `<p style="margin:0;font-size:14px;color:#9ca3af;font-style:italic;">（無摘要）</p>`
      }
      ${keywords}
    </div>
  `.trim();
}

function renderSection(section: PaperSection, papers: Paper[]): string {
  const label = SECTION_LABELS[section];
  const body =
    papers.length > 0
      ? papers.map((paper) => renderPaperCard(paper)).join("\n")
      : `<p style="margin:0;font-size:14px;color:#6b7280;">今日此區無文章。</p>`;

  return `
    <section style="margin:0 0 28px;">
      <h2 style="margin:0 0 12px;font-size:18px;color:#111827;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">${escapeHtml(label)} <span style="font-size:14px;color:#6b7280;">(${papers.length})</span></h2>
      ${body}
    </section>
  `.trim();
}

export function renderDigestHtml(options: RenderDigestHtmlOptions): string {
  const bySection: Record<PaperSection, Paper[]> = {
    "single-cell-spatial": [],
    biology: [],
    other: [],
  };

  for (const paper of options.papers) {
    bySection[paper.section].push(paper);
  }

  const sections = SECTION_ORDER.map((section) => renderSection(section, bySection[section])).join(
    "\n",
  );
  const generatedLine = options.generatedAt
    ? `<p style="margin:0 0 16px;font-size:12px;color:#9ca3af;">Generated at ${escapeHtml(options.generatedAt)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-Hant">
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
      <h1 style="margin:0 0 8px;font-size:22px;">每日論文摘要 · ${escapeHtml(options.reportDate)}</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">共 ${options.papers.length} 篇（report date: ${escapeHtml(options.reportDate)}）</p>
      ${generatedLine}
      ${sections}
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Sent by paper-digest (Resend)</p>
    </div>
  </body>
</html>`;
}

export function buildDigestSubject(
  reportDate: string,
  paperCount: number,
  subjectPrefix: string,
): string {
  return `${subjectPrefix} · ${reportDate} (${paperCount} papers)`;
}

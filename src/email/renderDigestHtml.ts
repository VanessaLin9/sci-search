import type { ClassifiedPaper, PaperSection } from "../types.js";
import { escapeHtml } from "./escapeHtml.js";

const SECTION_LABELS: Record<PaperSection, string> = {
  "single-cell-spatial": "主線 A：單細胞 / 空間組學",
  biology: "主線 B：重要生物學新結果",
  other: "其他候選",
};

const SECTION_ORDER: PaperSection[] = ["single-cell-spatial", "biology", "other"];

export type RenderDigestHtmlOptions = {
  reportDate: string;
  papers: ClassifiedPaper[];
  generatedAt?: string;
};

function renderJournalDoiMeta(paper: ClassifiedPaper): string {
  const journal = escapeHtml(paper.journal);
  const doi = paper.doi?.trim();
  if (!doi) return journal;
  return `${journal} · doi:${escapeHtml(doi)}`;
}

function renderPaperCard(paper: ClassifiedPaper): string {
  const abstract = paper.abstract?.trim();
  const keywords =
    paper.matchedKeywords.length > 0
      ? `<p style="margin:8px 0 0;font-size:12px;color:#555;">Keywords: ${escapeHtml(paper.matchedKeywords.join(", "))}</p>`
      : "";

  return `
    <div style="margin:0 0 20px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;">
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">${renderJournalDoiMeta(paper)}</p>
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

function renderEmptyDigestBody(reportDate: string): string {
  return `
    <div style="margin:0 0 20px;padding:16px 18px;border:1px dashed #d6b85a;border-radius:8px;background:#fff8e8;color:#6e5410;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 8px;font-weight:600;">今日沒有符合報告日的論文</p>
      <p style="margin:0;">已檢查設定的 RSS 來源；feed 內沒有發表／上線日期為 <strong>${escapeHtml(reportDate)}</strong>（台北時區）的項目。並非寄信失敗，而是當日確實無可收錄篇數。</p>
    </div>
  `.trim();
}

function renderSection(section: PaperSection, papers: ClassifiedPaper[]): string {
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
  const generatedLine = options.generatedAt
    ? `<p style="margin:0 0 16px;font-size:12px;color:#9ca3af;">Generated at ${escapeHtml(options.generatedAt)}</p>`
    : "";

  const isEmpty = options.papers.length === 0;
  const summaryLine = isEmpty
    ? `<p style="margin:0 0 20px;font-size:14px;color:#4b5563;">報告日 ${escapeHtml(options.reportDate)}（台北）· 共 0 篇</p>`
    : `<p style="margin:0 0 20px;font-size:14px;color:#4b5563;">共 ${options.papers.length} 篇（report date: ${escapeHtml(options.reportDate)}）</p>`;

  let body: string;
  if (isEmpty) {
    body = renderEmptyDigestBody(options.reportDate);
  } else {
    const bySection: Record<PaperSection, ClassifiedPaper[]> = {
      "single-cell-spatial": [],
      biology: [],
      other: [],
    };
    for (const paper of options.papers) {
      bySection[paper.section].push(paper);
    }
    body = SECTION_ORDER.map((section) => renderSection(section, bySection[section])).join("\n");
  }

  return `<!DOCTYPE html>
<html lang="zh-Hant">
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
    <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
      <h1 style="margin:0 0 8px;font-size:22px;">每日論文摘要 · ${escapeHtml(options.reportDate)}</h1>
      ${summaryLine}
      ${generatedLine}
      ${body}
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

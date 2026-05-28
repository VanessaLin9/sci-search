/** Sole digest HTML entry for email (`sendDigest`) and GitHub Pages preview (`writeDigestPreview`). */
import type { ClassifiedPaper, DigestLine } from "../types.js";
import {
  groupOverflowByJournal,
  renderJournalDoiLine,
  renderTopicTags,
  sortPapersForDisplay,
} from "./digestHtmlHelpers.js";
import { escapeHtml } from "./escapeHtml.js";

const LINE_SECTIONS: {
  line: DigestLine;
  badgeStyle: string;
  badgeLabel: string;
  heading: string;
}[] = [
  {
    line: "line-a",
    badgeStyle: "background:#eaf2f8;color:#2c5f8d;",
    badgeLabel: "主線 A",
    heading: "單細胞 / 空間組學",
  },
  {
    line: "line-b",
    badgeStyle: "background:#e6f4ec;color:#2f7a4f;",
    badgeLabel: "主線 B",
    heading: "當日其他重要生物學發現",
  },
  {
    line: "preprint",
    badgeStyle: "background:#fdf2e6;color:#b85c00;",
    badgeLabel: "預印本",
    heading: "bioRxiv / medRxiv",
  },
];

export type RenderDigestHtmlOptions = {
  reportDate: string;
  papers: ClassifiedPaper[];
  generatedAt?: string;
  priorityBySourceId?: ReadonlyMap<string, number>;
};

function visiblePapers(papers: ClassifiedPaper[]): ClassifiedPaper[] {
  return papers.filter((paper) => paper.digestLine && paper.digestLine !== "skip");
}

function renderFeaturedArticle(paper: ClassifiedPaper): string {
  const titleZh = paper.titleZh?.trim();
  const summaryZh = paper.summaryZh?.trim();
  const abstract = paper.abstract?.trim();

  const zhTitleBlock = titleZh
    ? `<p style="margin:0 0 6px;font-size:14px;color:#555;font-weight:500;line-height:1.45;">${escapeHtml(titleZh)}</p>`
    : "";

  let summaryBlock: string;
  if (summaryZh) {
    summaryBlock = `<p style="margin:8px 0 0;font-size:14px;line-height:1.65;color:#1a1a1a;">${escapeHtml(summaryZh)}</p>`;
  } else if (abstract) {
    summaryBlock = `<p style="margin:8px 0 0;font-size:14px;line-height:1.65;color:#1a1a1a;">${escapeHtml(abstract)}</p><p style="margin:6px 0 0;font-size:12px;color:#9ca3af;font-style:italic;">（尚無 LLM 繁中摘要，暫顯 RSS 摘要）</p>`;
  } else {
    summaryBlock = `<p style="margin:8px 0 0;font-size:14px;color:#9ca3af;font-style:italic;">（尚無摘要）</p>`;
  }

  return `
    <article style="background:#ffffff;border:1px solid #e2e2dc;border-radius:8px;padding:18px 20px;margin:0 0 14px;">
      <h3 style="margin:0 0 4px;font-size:16px;line-height:1.4;font-weight:600;">
        <a href="${escapeHtml(paper.url)}" style="color:#2c5f8d;text-decoration:none;" target="_blank" rel="noopener noreferrer">${escapeHtml(paper.title)}</a>
      </h3>
      ${zhTitleBlock}
      ${renderTopicTags(paper.topicTags)}
      ${renderJournalDoiLine(paper)}
      ${summaryBlock}
    </article>
  `.trim();
}

function renderDigestLineSection(
  line: DigestLine,
  badgeStyle: string,
  badgeLabel: string,
  heading: string,
  papers: ClassifiedPaper[],
): string {
  const sectionHeading = `
    <h2 style="margin:36px 0 14px;font-size:18px;color:#1a1a1a;border-bottom:1px solid #e2e2dc;padding-bottom:6px;">
      <span style="display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;letter-spacing:0.3px;margin-right:10px;vertical-align:middle;${badgeStyle}">${escapeHtml(badgeLabel)}</span>
      <span style="vertical-align:middle;">${escapeHtml(heading)}</span>
      <span style="font-size:14px;color:#888;font-weight:normal;margin-left:6px;">(${papers.length})</span>
    </h2>
  `.trim();

  if (papers.length === 0) {
    const emptyMsg =
      line === "preprint"
        ? "本期無 preprint 精選。"
        : "今日此主線無精選文章。";
    return `
      ${sectionHeading}
      <div style="background:#fff8e8;border:1px dashed #d6b85a;padding:14px 18px;border-radius:8px;color:#6e5410;font-size:14px;margin:0 0 14px;">
        ${escapeHtml(emptyMsg)}
      </div>
    `.trim();
  }

  return `${sectionHeading}\n${papers.map((paper) => renderFeaturedArticle(paper)).join("\n")}`;
}

function renderOverflowItem(paper: ClassifiedPaper): string {
  const titleZh = paper.titleZh?.trim();
  const zhLine = titleZh
    ? `<span style="display:block;margin-top:2px;font-size:13px;color:#888;line-height:1.4;">${escapeHtml(titleZh)}</span>`
    : "";

  return `
    <li style="margin:0 0 10px;font-size:14px;line-height:1.45;">
      <a href="${escapeHtml(paper.url)}" style="color:#2c5f8d;text-decoration:none;" target="_blank" rel="noopener noreferrer">${escapeHtml(paper.title)}</a>
      ${zhLine}
    </li>
  `.trim();
}

function renderOverflowSection(
  overflow: ClassifiedPaper[],
  priorityBySourceId?: ReadonlyMap<string, number>,
): string {
  if (overflow.length === 0) return "";

  const groups = groupOverflowByJournal(overflow, priorityBySourceId);
  const body = groups
    .map(
      (group) => `
      <div style="margin:0 0 18px;">
        <h3 style="margin:0 0 8px;font-size:15px;color:#1a1a1a;border-left:3px solid #2c5f8d;padding-left:10px;">${escapeHtml(group.journal)} <span style="font-size:13px;color:#888;font-weight:normal;">(${group.papers.length})</span></h3>
        <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">
          ${group.papers.map((paper) => renderOverflowItem(paper)).join("\n")}
        </ul>
      </div>
    `,
    )
    .join("\n");

  return `
    <section style="margin:40px 0 0;padding-top:8px;border-top:2px solid #e2e2dc;">
      <h2 style="margin:0 0 6px;font-size:18px;color:#1a1a1a;">更多收錄論文</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#888;">精選區以外共 ${overflow.length} 篇，依期刊分組（英文標題連結 + 繁中譯名）</p>
      ${body}
    </section>
  `.trim();
}

function renderEmptyDigestBody(reportDate: string): string {
  return `
    <div style="margin:0 0 20px;padding:16px 18px;border:1px dashed #d6b85a;border-radius:8px;background:#fff8e8;color:#6e5410;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 8px;font-weight:600;">今日沒有符合報告日的論文</p>
      <p style="margin:0;">已檢查設定的 RSS 來源；feed 內沒有發表／上線日期為 <strong>${escapeHtml(reportDate)}</strong>（台北時區）的項目。</p>
    </div>
  `.trim();
}

export function renderDigestHtml(options: RenderDigestHtmlOptions): string {
  const { reportDate, papers, generatedAt, priorityBySourceId } = options;
  const generatedLine = generatedAt
    ? `<p style="margin:0;font-size:12px;color:#888;">Generated at ${escapeHtml(generatedAt)}</p>`
    : "";

  const visible = visiblePapers(papers);
  const isEmpty = visible.length === 0;

  const featured = sortPapersForDisplay(
    visible.filter((paper) => paper.featured),
    priorityBySourceId,
  );
  const overflow = sortPapersForDisplay(
    visible.filter((paper) => !paper.featured),
    priorityBySourceId,
  );

  const featuredByLine: Record<"line-a" | "line-b" | "preprint", ClassifiedPaper[]> = {
    "line-a": [],
    "line-b": [],
    preprint: [],
  };
  for (const paper of featured) {
    const line = paper.digestLine;
    if (line === "line-a" || line === "line-b" || line === "preprint") {
      featuredByLine[line].push(paper);
    } else {
      featuredByLine["line-b"].push(paper);
    }
  }

  let body: string;
  if (isEmpty) {
    body = renderEmptyDigestBody(reportDate);
  } else {
    const featuredSections = LINE_SECTIONS.map(({ line, badgeStyle, badgeLabel, heading }) => {
      const sectionPapers =
        line === "line-a"
          ? featuredByLine["line-a"]
          : line === "line-b"
            ? featuredByLine["line-b"]
            : featuredByLine.preprint;
      return renderDigestLineSection(line, badgeStyle, badgeLabel, heading, sectionPapers);
    }).join("\n");
    body = `${featuredSections}\n${renderOverflowSection(overflow, priorityBySourceId)}`;
  }

  const metaFeatured = featured.length;
  const metaOverflow = overflow.length;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>每日科學期刊摘要 · ${escapeHtml(reportDate)}</title>
  </head>
  <body style="margin:0;padding:32px 16px;background:#fafaf7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC','PingFang TC',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1a1a1a;line-height:1.65;">
    <div style="max-width:880px;margin:0 auto;">
      <header style="border-bottom:2px solid #1a1a1a;padding-bottom:16px;margin-bottom:28px;">
        <h1 style="margin:0 0 6px;font-size:28px;letter-spacing:0.5px;">每日科學期刊摘要</h1>
        <p style="margin:0;font-size:15px;color:#555;">Daily Digest · 當日新論文（單細胞/空間組學 + 重要生物學發現）</p>
        <p style="margin:8px 0 0;font-size:13px;color:#888;">
          📅 ${escapeHtml(reportDate)}（台北） · 精選 ${metaFeatured} 篇 · 更多收錄 ${metaOverflow} 篇
        </p>
        ${generatedLine}
      </header>
      ${body}
      <footer style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e2dc;color:#888;font-size:12px;text-align:center;">
        Sent by paper-digest (Resend)
      </footer>
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

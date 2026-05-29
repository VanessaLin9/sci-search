import { buildSourcePriorityById } from "../digest/selectFeatured.js";
import { loadSources } from "../config.js";
import { buildDigestSubject } from "../domain/life-science/email/subject.js";
import { isVisibleInDigest } from "../domain/life-science/email/visibility.js";
import type { ClassifiedPaper } from "../types.js";
import { loadEmailConfig } from "./config.js";
import { renderDigestHtml } from "./renderDigestHtml.js";
import { sendWithResend } from "./sendWithResend.js";

export type SendDigestEmailOptions = {
  reportDate: string;
  papers: ClassifiedPaper[];
  generatedAt?: string;
  dryRun?: boolean;
};

export type SendDigestEmailResult = {
  subject: string;
  to: string[];
  paperCount: number;
  emailId?: string;
  dryRun: boolean;
};

export async function sendDigestEmail(
  options: SendDigestEmailOptions,
): Promise<SendDigestEmailResult> {
  const config = loadEmailConfig();
  const visibleCount = options.papers.filter(isVisibleInDigest).length;
  const subject = buildDigestSubject(
    options.reportDate,
    visibleCount,
    config.subjectPrefix,
  );
  const sources = await loadSources();
  const priorityBySourceId = buildSourcePriorityById(sources);
  const html = renderDigestHtml({
    reportDate: options.reportDate,
    papers: options.papers,
    generatedAt: options.generatedAt,
    priorityBySourceId,
  });

  if (options.dryRun) {
    return {
      subject,
      to: config.to,
      paperCount: visibleCount,
      dryRun: true,
    };
  }

  const { id } = await sendWithResend(config, { subject, html });

  return {
    subject,
    to: config.to,
    paperCount: visibleCount,
    emailId: id,
    dryRun: false,
  };
}

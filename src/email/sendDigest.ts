import type { ClassifiedPaper } from "../types.js";
import { loadEmailConfig } from "./config.js";
import { buildDigestSubject, renderDigestHtml } from "./renderDigestHtml.js";
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
  const subject = buildDigestSubject(
    options.reportDate,
    options.papers.length,
    config.subjectPrefix,
  );
  const html = renderDigestHtml({
    reportDate: options.reportDate,
    papers: options.papers,
    generatedAt: options.generatedAt,
  });

  if (options.dryRun) {
    return {
      subject,
      to: config.to,
      paperCount: options.papers.length,
      dryRun: true,
    };
  }

  const { id } = await sendWithResend(config, { subject, html });

  return {
    subject,
    to: config.to,
    paperCount: options.papers.length,
    emailId: id,
    dryRun: false,
  };
}

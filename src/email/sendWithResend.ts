import type { EmailConfig } from "./config.js";

const RESEND_API_URL = "https://api.resend.com/emails";

function buildFromHeader(config: EmailConfig): string {
  if (!config.fromName) {
    return config.fromEmail;
  }
  return `${config.fromName} <${config.fromEmail}>`;
}

export type SendEmailInput = {
  subject: string;
  html: string;
};

export type SendEmailResult = {
  id: string;
};

type ResendErrorBody = {
  message?: string;
  name?: string;
};

export async function sendWithResend(
  config: EmailConfig,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const from = buildFromHeader(config);
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: config.to,
      subject: input.subject,
      html: input.html,
    }),
  });

  const body = (await response.json()) as { id?: string } & ResendErrorBody;

  if (!response.ok) {
    const detail = body.message ?? response.statusText;
    throw new Error(`Resend API error (${response.status}): ${detail}`);
  }

  if (!body.id) {
    throw new Error("Resend API returned no email id");
  }

  return { id: body.id };
}

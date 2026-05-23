import { z } from "zod";
import { parseRecipientList } from "./parseRecipientList.js";

const emailConfigSchema = z.object({
  resendApiKey: z.string().min(1, "RESEND_API_KEY is required"),
  from: z.string().email("DIGEST_FROM_EMAIL must be a valid email"),
  to: z
    .array(z.string().email())
    .min(1, "DIGEST_TO_EMAIL must contain at least one address"),
  subjectPrefix: z.string().default("Paper Digest"),
});

export type EmailConfig = z.infer<typeof emailConfigSchema>;

export function loadEmailConfig(): EmailConfig {
  const to = parseRecipientList(process.env.DIGEST_TO_EMAIL);
  const parsed = emailConfigSchema.safeParse({
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.DIGEST_FROM_EMAIL ?? "onboarding@resend.dev",
    to,
    subjectPrefix: process.env.DIGEST_SUBJECT_PREFIX ?? "Paper Digest",
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Email config invalid: ${message}`);
  }

  return parsed.data;
}

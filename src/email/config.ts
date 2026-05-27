import { z } from "zod";
import { loadEmailFileConfig } from "../config.js";
import { parseRecipientList } from "./parseRecipientList.js";
import { applyResendSandboxLimits } from "./resendSandbox.js";

const emailConfigSchema = z.object({
  resendApiKey: z.string().min(1, "RESEND_API_KEY is required"),
  fromEmail: z.string().email("DIGEST_FROM_EMAIL must be a valid email"),
  fromName: z
    .string()
    .trim()
    .min(1, "DIGEST_FROM_NAME must be non-empty when set")
    .optional(),
  to: z
    .array(z.string().email())
    .min(1, "DIGEST_TO_EMAIL must contain at least one address"),
  subjectPrefix: z.string().default("Paper Digest"),
});

export type EmailConfig = z.infer<typeof emailConfigSchema>;

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function envOrOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function loadEmailConfig(): EmailConfig {
  const file = loadEmailFileConfig();
  const to = parseRecipientList(process.env.DIGEST_TO_EMAIL);
  const parsed = emailConfigSchema.safeParse({
    resendApiKey: process.env.RESEND_API_KEY?.trim(),
    fromEmail: envOrDefault("DIGEST_FROM_EMAIL", file.fromEmail),
    fromName: envOrOptional("DIGEST_FROM_NAME") ?? file.fromName,
    to,
    subjectPrefix: envOrDefault("DIGEST_SUBJECT_PREFIX", file.subjectPrefix),
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Email config invalid: ${message}`);
  }

  return applyResendSandboxLimits(parsed.data);
}

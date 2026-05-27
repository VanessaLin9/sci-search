import type { EmailConfig } from "./config.js";

/** Resend test sender only delivers to the account owner's inbox. */
export function isResendSandboxFrom(fromEmail: string): boolean {
  return fromEmail.toLowerCase().endsWith("@resend.dev");
}

export function applyResendSandboxLimits(config: EmailConfig): EmailConfig {
  if (!isResendSandboxFrom(config.fromEmail)) {
    return config;
  }

  const owner = process.env.RESEND_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (!owner) {
    if (config.to.length > 1) {
      throw new Error(
        `Resend sandbox sender "${config.fromEmail}" can only deliver to your Resend account email. ` +
          `DIGEST_TO_EMAIL has ${config.to.length} recipients. Set RESEND_ACCOUNT_EMAIL to your login email ` +
          "(e.g. vanessa7591@gmail.com) so CI sends only to you and skips the rest, or verify a domain at " +
          "https://resend.com/domains and set DIGEST_FROM_EMAIL to an address on that domain.",
      );
    }
    return config;
  }

  const allowed = config.to.filter((address) => address.toLowerCase() === owner);
  const skipped = config.to.filter((address) => address.toLowerCase() !== owner);

  if (allowed.length === 0) {
    throw new Error(
      `Resend sandbox: DIGEST_TO_EMAIL does not include RESEND_ACCOUNT_EMAIL (${owner}). ` +
        "Add your login email to DIGEST_TO_EMAIL, or verify a custom domain for multi-recipient sends.",
    );
  }

  if (skipped.length > 0) {
    console.warn(
      `[email] Resend sandbox (${config.fromEmail}): sending only to ${allowed.join(", ")}; ` +
        `skipped ${skipped.join(", ")}. Verify a domain and use a custom DIGEST_FROM_EMAIL to email everyone.`,
    );
  }

  return { ...config, to: allowed };
}

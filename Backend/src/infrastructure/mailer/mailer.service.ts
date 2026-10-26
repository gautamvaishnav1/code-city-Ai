import nodemailer from "nodemailer";
import { env, isProd, smtpConfigured, smtpFallbackConfigured } from "../../config/env";
import { logger } from "../../shared/utils/logger";

/**
 * Transporters are cached per-config so a rotated credential re-creates them.
 * Primary is whatever SMTP_* points at (often Gmail); the fallback is an
 * independent relay (Brevo/SendGrid/SES...) that is tried automatically when
 * the primary send fails — Gmail SMTP is frequently blocked from PaaS hosts
 * such as Render, so the fallback keeps OTP delivery alive there.
 */
let primaryCache: { key: string; transporter: nodemailer.Transporter } | null = null;
let fallbackCache: { key: string; transporter: nodemailer.Transporter } | null = null;

function createTransporter(
  host: string,
  port: number,
  user: string,
  pass: string
): nodemailer.Transporter {
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

function getPrimaryTransporter(): nodemailer.Transporter | null {
  if (!smtpConfigured()) return null;
  const key = `${env.smtpHost}:${env.smtpPort}:${env.smtpUser}`;
  if (!primaryCache || primaryCache.key !== key) {
    primaryCache = { key, transporter: createTransporter(env.smtpHost, env.smtpPort, env.smtpUser, env.smtpPass) };
  }
  return primaryCache.transporter;
}

function getFallbackTransporter(): nodemailer.Transporter | null {
  if (!smtpFallbackConfigured()) return null;
  const key = `${env.smtpFallbackHost}:${env.smtpFallbackPort}:${env.smtpFallbackUser}`;
  if (!fallbackCache || fallbackCache.key !== key) {
    fallbackCache = {
      key,
      transporter: createTransporter(
        env.smtpFallbackHost,
        env.smtpFallbackPort,
        env.smtpFallbackUser,
        env.smtpFallbackPass
      )
    };
  }
  return fallbackCache.transporter;
}

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends an email via the primary SMTP, automatically retrying on the fallback
 * relay when the primary fails. If neither is configured, logs the mail so the
 * OTP demo still works with zero email setup (hackathon mode) and returns
 * devOtp in that case.
 */
export async function sendMail(options: MailOptions): Promise<{ delivered: boolean; devOtp?: string }> {
  const primary = getPrimaryTransporter();
  const fallback = getFallbackTransporter();

  // No SMTP at all (neither primary nor fallback configured).
  if (!primary && !fallback) {
    if (isProd) {
      // Never log OTP codes or recipient emails in production — this would
      // leak via the SSE log stream and enable account takeover.
      logger.error("SMTP not configured; cannot send email in production", {
        subject: options.subject
      });
      throw new Error("Email delivery is not configured");
    }
    logger.warn(`[DEV MAIL] To:${options.to} | ${options.subject} | ${options.text}`);
    // surface the 6-digit code for local testing when SMTP is not configured
    const otpMatch = options.text.match(/\b(\d{6})\b/);
    return { delivered: false, devOtp: otpMatch?.[1] };
  }

  // 1. Try the primary transporter first (if present).
  if (primary) {
    try {
      await primary.sendMail({ from: env.mailFrom, ...options });
      return { delivered: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!fallback) {
        // No fallback to save us — surface the failure.
        logger.error("Mail send failed", { error: message });
        throw err;
      }
      logger.warn("Primary SMTP send failed; retrying via fallback relay", {
        error: message,
        fallbackHost: env.smtpFallbackHost
      });
    }
  }

  // 2. Fallback relay (Brevo / SendGrid / SES ...). Runs when the primary is
  //    absent or just failed. Its own failure is terminal.
  if (fallback) {
    try {
      const from = env.mailFallbackFrom || env.mailFrom;
      await fallback.sendMail({ from, ...options });
      return { delivered: true };
    } catch (err) {
      logger.error("Fallback SMTP send failed", {
        error: err instanceof Error ? err.message : String(err),
        fallbackHost: env.smtpFallbackHost
      });
      throw err;
    }
  }

  // Unreachable in practice: guarded by the "no SMTP at all" branch above.
  throw new Error("Email delivery is not configured");
}

export function otpEmailTemplate(code: string, purpose: "register" | "password_reset"): MailOptionsLike {
  const subject =
    purpose === "register" ? "Verify your Software World account" : "Reset your Software World password";
  const text =
    `Your Software World verification code is: ${code}\n\n` +
    `It expires in 10 minutes. If you did not request this, ignore this email.`;
  return {
    subject,
    text,
    html:
      `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">` +
      `<h2 style="margin:0 0 8px">${subject}</h2>` +
      `<p>Your verification code is:</p>` +
      `<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>` +
      `<p style="color:#888">Expires in 10 minutes.</p></div>`
  };
}

interface MailOptionsLike {
  subject: string;
  text: string;
  html?: string;
}

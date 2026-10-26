import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import {
  otpEmailTemplate,
  sendMail,
  type MailOptions
} from "../src/infrastructure/mailer/mailer.service";

/* nodemailer mock — transporter behavior is swappable per-test via refs */
const { sendMailRef, sendMailByHostRef } = vi.hoisted(() => ({
  sendMailRef: { current: null as ((opts: Record<string, unknown>) => Promise<unknown>) | null },
  sendMailByHostRef: {
    current: null as ((host: string, opts: Record<string, unknown>) => Promise<unknown>) | null
  }
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn((config: { host: string }) => ({
      sendMail: (opts: Record<string, unknown>) => {
        // per-host override lets a test make the primary fail but the fallback succeed
        if (sendMailByHostRef.current) return sendMailByHostRef.current(config.host, opts);
        if (sendMailRef.current) return sendMailRef.current(opts);
        return Promise.resolve({ messageId: `<${config.host}@test>` });
      }
    }))
  }
}));

const mutableEnv = env as unknown as {
  smtpHost: string;
  smtpUser: string;
  smtpPass: string;
  smtpFallbackHost: string;
  smtpFallbackUser: string;
  smtpFallbackPass: string;
  mailFallbackFrom: string;
};
const original = {
  smtpHost: env.smtpHost,
  smtpUser: env.smtpUser,
  smtpPass: env.smtpPass,
  smtpFallbackHost: env.smtpFallbackHost,
  smtpFallbackUser: env.smtpFallbackUser,
  smtpFallbackPass: env.smtpFallbackPass,
  mailFallbackFrom: env.mailFallbackFrom
};

function setSmtp(host: string) {
  mutableEnv.smtpHost = host;
  mutableEnv.smtpUser = host ? "user" : "";
  mutableEnv.smtpPass = host ? "pass" : "";
}

function setFallbackSmtp(host: string) {
  mutableEnv.smtpFallbackHost = host;
  mutableEnv.smtpFallbackUser = host ? "fallback-user" : "";
  mutableEnv.smtpFallbackPass = host ? "fallback-pass" : "";
}

beforeEach(() => {
  sendMailRef.current = null;
  sendMailByHostRef.current = null;
});

afterEach(() => {
  mutableEnv.smtpHost = original.smtpHost;
  mutableEnv.smtpUser = original.smtpUser;
  mutableEnv.smtpPass = original.smtpPass;
  mutableEnv.smtpFallbackHost = original.smtpFallbackHost;
  mutableEnv.smtpFallbackUser = original.smtpFallbackUser;
  mutableEnv.smtpFallbackPass = original.smtpFallbackPass;
  mutableEnv.mailFallbackFrom = original.mailFallbackFrom;
});

describe("sendMail (dev fallback mode — SMTP unconfigured)", () => {
  it("does not deliver and surfaces the OTP as devOtp", async () => {
    setSmtp("");
    const options: MailOptions = {
      to: "dev@example.com",
      subject: "Verify",
      text: "Your code is: 482913"
    };

    const result = await sendMail(options);

    expect(result.delivered).toBe(false);
    expect(result.devOtp).toBe("482913");
  });

  it("returns undefined devOtp when the text contains no 6-digit code", async () => {
    setSmtp("");
    const result = await sendMail({ to: "x@y.z", subject: "s", text: "no codes here" });
    expect(result.devOtp).toBeUndefined();
  });

  it("extracts the first standalone 6-digit group only", async () => {
    setSmtp("");
    const result = await sendMail({
      to: "x@y.z",
      subject: "s",
      text: "Order #1234567 shipped. Your code is 901234."
    });
    expect(result.devOtp).toBe("901234");
  });
});

describe("sendMail (SMTP configured)", () => {
  it("delivers via the transporter with the configured from address", async () => {
    const seen: Array<Record<string, unknown>> = [];
    sendMailRef.current = async (opts) => {
      seen.push(opts);
      return { messageId: "<test@test>" };
    };
    setSmtp("smtp.test.server");

    const result = await sendMail({ to: "rcpt@example.com", subject: "Hi", text: "body" });

    expect(result).toEqual({ delivered: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].to).toBe("rcpt@example.com");
    expect(seen[0].from).toBe(env.mailFrom);
  });

  it("propagates transporter failures after logging them", async () => {
    sendMailRef.current = async () => {
      throw new Error("relay denied");
    };
    setSmtp("smtp.test.server");

    await expect(sendMail({ to: "r@x.y", subject: "s", text: "t" })).rejects.toThrow(
      /relay denied/i
    );
  });
});

describe("sendMail (fallback relay — e.g. Brevo behind Gmail on Render)", () => {
  it("retries via the fallback when the primary send fails", async () => {
    const hostsSeen: string[] = [];
    sendMailByHostRef.current = async (host) => {
      hostsSeen.push(host);
      if (host === "smtp.gmail.com") throw new Error("Connection blocked by host");
      return { messageId: "<brevo@test>" };
    };
    setSmtp("smtp.gmail.com");
    setFallbackSmtp("smtp-relay.brevo.com");

    const result = await sendMail({ to: "u@example.com", subject: "Verify", text: "code 123456" });

    expect(result).toEqual({ delivered: true });
    expect(hostsSeen).toEqual(["smtp.gmail.com", "smtp-relay.brevo.com"]);
  });

  it("uses MAIL_FALLBACK_FROM as the sender when set", async () => {
    const seen: Array<Record<string, unknown>> = [];
    sendMailByHostRef.current = async (host, opts) => {
      if (host === "smtp-relay.brevo.com") seen.push(opts);
      throw new Error("primary down");
    };
    setSmtp("smtp.gmail.com");
    setFallbackSmtp("smtp-relay.brevo.com");
    mutableEnv.mailFallbackFrom = "CodeCity <no-reply@brevo-verified.com>";

    await expect(sendMail({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow();
    expect(seen[0].from).toBe("CodeCity <no-reply@brevo-verified.com>");
  });

  it("falls back to MAIL_FROM when MAIL_FALLBACK_FROM is empty", async () => {
    const seen: Array<Record<string, unknown>> = [];
    sendMailByHostRef.current = async (host, opts) => {
      if (host === "smtp-relay.brevo.com") seen.push(opts);
      throw new Error("primary down");
    };
    setSmtp("smtp.gmail.com");
    setFallbackSmtp("smtp-relay.brevo.com");
    mutableEnv.mailFallbackFrom = "";

    await expect(sendMail({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow();
    expect(seen[0].from).toBe(env.mailFrom);
  });

  it("sends straight to the fallback when no primary is configured", async () => {
    const hostsSeen: string[] = [];
    sendMailByHostRef.current = async (host) => {
      hostsSeen.push(host);
      return { messageId: "<brevo@test>" };
    };
    setSmtp(""); // no primary at all
    setFallbackSmtp("smtp-relay.brevo.com");

    const result = await sendMail({ to: "u@example.com", subject: "s", text: "t" });

    expect(result).toEqual({ delivered: true });
    expect(hostsSeen).toEqual(["smtp-relay.brevo.com"]);
  });

  it("throws when both the primary and fallback fail", async () => {
    sendMailByHostRef.current = async () => {
      throw new Error("both relays down");
    };
    setSmtp("smtp.gmail.com");
    setFallbackSmtp("smtp-relay.brevo.com");

    await expect(sendMail({ to: "r@x.y", subject: "s", text: "t" })).rejects.toThrow(
      /both relays down/i
    );
  });
});

describe("otpEmailTemplate", () => {
  it("uses a registration subject for register purpose", () => {
    const tpl = otpEmailTemplate("135790", "register");
    expect(tpl.subject).toMatch(/verify your software world account/i);
    expect(tpl.text).toContain("135790");
    expect(tpl.text).toContain("10 minutes");
    expect(tpl.html).toContain("135790");
  });

  it("uses a reset subject for password_reset purpose", () => {
    const tpl = otpEmailTemplate("246810", "password_reset");
    expect(tpl.subject).toMatch(/reset your software world password/i);
    expect(tpl.html).toContain("246810");
  });
});

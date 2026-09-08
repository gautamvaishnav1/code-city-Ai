import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value || !value.trim()) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses "30s" | "15m" | "12h" | "7d" into milliseconds. */
function duration(value: string | undefined, fallbackMs: number): number {
  const match = /^(\d+)\s*([smhd])$/.exec((value ?? "").trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return amount * unitMs;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 5000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/software-world",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  refreshTokenTtlMs: duration(process.env.REFRESH_TOKEN_EXPIRES_IN, 7 * 24 * 3_600_000),
  logStreamTicketTtlMs: num(process.env.LOG_STREAM_TICKET_TTL_MS, 30_000),
  corsOrigins: list(process.env.CORS_ORIGINS, ["http://localhost:3000"]),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  llmBaseUrl: (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "gpt-5.6",
  llmTimeoutMs: num(process.env.LLM_TIMEOUT_MS, 60_000),
  maxRepoFiles: num(process.env.MAX_REPO_FILES, 1500),
  maxFileSizeKb: num(process.env.MAX_FILE_SIZE_KB, 256),
  // ---- OAuth ----
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  // ---- SMTP for OTP emails (falls back to console logging when unset) ----
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: num(process.env.SMTP_PORT, 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  mailFrom: process.env.MAIL_FROM ?? "Software World <no-reply@software-world.local>"
} as const;

export const isProd = env.nodeEnv === "production";
export const isTest = env.nodeEnv === "test";
export const smtpConfigured = (): boolean => Boolean(env.smtpHost && env.smtpUser && env.smtpPass);

/* ------------------------- fail-fast security checks ------------------------- */
/** Refuses to boot in production with insecure defaults. Crashing loudly beats
 *  running quietly with a publicly-known JWT secret or an open CORS policy. */
if (isProd) {
  const problems: string[] = [];
  if (!process.env.JWT_SECRET || env.jwtSecret === "dev-only-secret-change-me") {
    problems.push("JWT_SECRET must be set to a strong random value in production");
  } else if (env.jwtSecret.length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters long");
  }
  if (env.corsOrigins.includes("*")) {
    problems.push('CORS_ORIGINS="*" is not allowed in production — list your real origins');
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start (insecure configuration):\n  - ${problems.join("\n  - ")}`);
  }
}

import crypto from "node:crypto";

/** Opaque high-entropy token (URL-safe). Never stored in plain text. */
export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** sha256 hex digest — the only form of a token we persist. */
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

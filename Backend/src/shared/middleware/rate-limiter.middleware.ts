import rateLimit from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { isTest } from "../../config/env";

const jsonHandler = (_req: Request, res: Response) => {
  res.status(429).json({
    success: false,
    message: "Too many requests, please slow down."
  });
};

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler,
  skip: () => isTest
};

export const apiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 600
});

export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 25
});

/** Tight limit for OTP endpoints (verify / resend / forgot / reset). */
export const otpLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 12
});

export const aiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 30
});

/** Refresh-token exchange — small per-IP budget; abuse = token stuffing. */
export const refreshTokenLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 60
});

/** Layered on top of the global limiter for expensive read endpoints
 *  (full analysis results, architecture graphs). */
export const readLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 100
});

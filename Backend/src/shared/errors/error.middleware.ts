import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { ApiError } from "../utils/api-error";
import { isProd } from "../../config/env";
import { logger } from "../utils/logger";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, message: `Route not found` });
}

/** Centralized error middleware — keep last in the chain. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  let statusCode = 500;
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = "Validation failed";
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = `Invalid value for "${err.path}"`;
  } else if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
    statusCode = 409;
    message = "Duplicate key error";
    details = (err as { keyValue?: unknown }).keyValue;
  } else if (err instanceof SyntaxError) {
    statusCode = 400;
    message = "Malformed JSON body";
  }

  if (statusCode >= 500) {
    logger.error("Unhandled error", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
  }

  // Never leak upstream/internal details to clients in production for 5xx errors.
  // 4xx details (validation messages, field errors) are safe and useful for clients.
  const safeDetails = !isProd || statusCode < 500 ? details : undefined;

  res.status(statusCode).json({
    success: false,
    message,
    ...(safeDetails !== undefined ? { details: safeDetails } : {}),
    ...(!isProd && statusCode >= 500 && err instanceof Error ? { stack: err.stack } : {})
  });
}

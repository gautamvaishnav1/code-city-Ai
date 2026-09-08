import type { NextFunction, Request, Response } from "express";

/**
 * Express-5-safe replacement for express-mongo-sanitize + hpp.
 *
 * Mutates req.body / req.query / req.params IN PLACE (Express 5 exposes
 * req.query through a getter-only property, so packages that reassign it
 * crash). Two protections:
 *
 * 1. NoSQL injection: removes keys starting with `$`, containing `.`, or
 *    usable for prototype pollution (__proto__ / constructor / prototype).
 * 2. HPP: collapses duplicated query params (`?id=1&id=2`) to the last value.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isDangerousKey(key: string): boolean {
  return key.startsWith("$") || key.includes(".") || DANGEROUS_KEYS.has(key);
}

/** Recursively strips dangerous keys from any nested object/array. */
export function stripMongoOperators(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripMongoOperators(item);
    return;
  }
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || value instanceof Date) return;

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (isDangerousKey(key)) {
      delete obj[key];
      continue;
    }
    stripMongoOperators(obj[key]);
  }
}

/** Replaces array values (repeated query keys) with their last entry. */
export function collapseDuplicateParams(query: Record<string, unknown>): void {
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (Array.isArray(value) && value.length > 0 && !isDangerousKey(key)) {
      query[key] = value[value.length - 1];
    }
  }
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction): void {
  try {
    // body: JSON payloads can carry {"email": {"$gt": ""}} login bypasses
    if (req.body && typeof req.body === "object") stripMongoOperators(req.body);

    // query: getter-only in Express 5 — mutate the object itself
    const query = (req as unknown as { query?: object }).query;
    if (query && typeof query === "object") {
      stripMongoOperators(query);
      collapseDuplicateParams(query as Record<string, unknown>);
    }

    // route params are usually strings, but custom routers may nest objects
    if (req.params && typeof req.params === "object") stripMongoOperators(req.params);

    next();
  } catch (err) {
    next(err);
  }
}

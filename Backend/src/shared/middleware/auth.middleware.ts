import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.util";
import { ApiError } from "../utils/api-error";

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

/** Requires a valid JWT; attaches req.user = { id, email }. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized("Missing bearer token");
    const payload = verifyAccessToken(token);
    if (!payload?.sub) throw ApiError.unauthorized("Invalid token payload");
    req.user = { id: payload.sub, email: payload.email, guest: payload.guest === true };
    next();
  } catch (err) {
    if (err instanceof ApiError) {
      next(err);
      return;
    }
    next(ApiError.unauthorized("Invalid or expired token"));
  }
}

/**
 * Anonymous demo sessions (POST /auth/guest) are deliberately narrow: they
 * exist so the Beach Resort demo works with zero friction, NOT as a way to
 * analyse arbitrary GitHub repositories for free. Applied to every route that
 * takes a repository URL, so the sign-in gate is enforced server-side too —
 * the UI is not the only thing standing between a guest and a clone job.
 */
export function requireDemoForGuest(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.guest) return next();
  const target = String(req.body?.repoUrl ?? req.body?.url ?? req.query?.url ?? "");
  if (target.startsWith("demo://")) return next();
  next(
    ApiError.forbidden(
      "Guest sessions can open the bundled demo only — sign in to analyze a repository"
    )
  );
}

import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/utils/async-handler";
import { ApiError } from "../../shared/utils/api-error";
import * as analysisService from "./analysis.service";
import { AUTH_MIDDLEWARE_RE } from "../parser/ast-analyzer";

export const start = asyncHandler(async (req: Request, res: Response) => {
  const project = await analysisService.getOwnedProject(String(req.params.id), req.user!.id);
  const { analysisId } = await analysisService.startAnalysis(project, req.user!.id);
  res.status(202).json({
    success: true,
    message: "Analysis started",
    data: {
      analysisId,
      projectId: project._id.toString(),
      socketRoom: `project:${project._id.toString()}`
    }
  });
});

export const getAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const doc = await analysisService.getOwnedAnalysis(String(req.params.id), req.user!.id);
  res.status(200).json({ success: true, data: serialize(doc) });
});

export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  const doc = await analysisService.getOwnedAnalysis(String(req.params.id), req.user!.id);
  res.status(200).json({
    success: true,
    data: {
      id: doc._id.toString(),
      status: doc.status,
      durationMs: doc.durationMs,
      error: doc.error ?? null
    }
  });
});

/** GET /projects/:id/architecture — latest validated architecture for the frontend. */
export const getArchitecture = asyncHandler(async (req: Request, res: Response) => {
  const doc = await analysisService.getLatestCompletedForProject(
    String(req.params.id),
    req.user!.id
  );
  if (!doc?.architecture) {
    throw ApiError.notFound(
      "No completed architecture yet. POST /api/v1/projects/:id/analyze first."
    );
  }
  res.status(200).json({
    success: true,
    data: {
      analysisId: doc._id.toString(),
      projectId: String(doc.project),
      repoInfo: doc.repoInfo
        ? { ...doc.repoInfo, techStack: doc.techStack ?? null }
        : null,
      stats: { ...(doc.stats ?? {}), totalComponents: doc.architecture?.components.length ?? 0, totalConnections: doc.architecture?.connections.length ?? 0 },
      districts: doc.districts ?? [],
      architecture: doc.architecture,
      // Real Express routes recovered by the AST analyzer (method + path +
      // owning file). The frontend maps these onto the `routes` buildings so a
      // traced request carries its true method/URL — and knows whether it
      // sits behind auth.
      routes: compactRoutes(doc.metadata),
      dependencies: doc.dependencies ?? { runtime: [], dev: [] },
      changes: doc.changes ?? null
    }
  });
});

/** Pull the parser's RouteFact[] out of the stored metadata, minus the noise:
 *  router mounts / middleware (`MOUNT`, `USE`) and anything without a path.
 *  Router-level `router.use(requireAuth)` guards are folded into a `guarded`
 *  flag on every route declared in that file beneath the guard's path — so the
 *  city can draw the JWT wall even when the per-route handler list is clean. */
function compactRoutes(metadata: Record<string, unknown> | undefined) {
  const raw = metadata?.routes as unknown;
  if (!Array.isArray(raw)) return [];

  const facts = raw
    .filter((r) => {
      const rec = r as Record<string, unknown> | null;
      return !!String(rec?.path ?? "");
    })
    .slice(0, 600)
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        method: String(rec.method ?? ""),
        path: String(rec.path ?? ""),
        handler: String(rec.handler ?? ""),
        file: String(rec.file ?? "").replace(/\\/g, "/"),
      };
    });

  // file -> list of mount paths that sit behind an auth middleware
  const guardsByFile = new Map<string, string[]>();
  for (const f of facts) {
    if (f.method !== "USE" || !isAuthGuard(f.handler) || !f.file) continue;
    const list = guardsByFile.get(f.file) ?? [];
    list.push(f.path || "/");
    guardsByFile.set(f.file, list);
  }

  return facts
    .filter((f) => f.method !== "MOUNT" && f.method !== "USE")
    .slice(0, 300)
    .map((f) => ({
      method: f.method,
      path: f.path,
      handler: f.handler,
      file: f.file,
      ...(guardsByFile.get(f.file)?.some((g) => underPath(f.path, g)) ? { guarded: true } : {}),
    }));
}

/** `router.use(requireAuth)` / `passport.authenticate("jwt")` — anything that
 *  smells like an auth gate. Handlers arrive comma-joined ("requireAuth, isBlocked"). */
function isAuthGuard(handler: string): boolean {
  if (!handler) return false;
  if (/passport\.authenticate/i.test(handler)) return true;
  return handler
    .split(",")
    .map((h) => h.trim())
    .some((h) => !!h && AUTH_MIDDLEWARE_RE.test(h));
}

/** Does Express route `routePath` fall under middleware mounted at `guardPath`? */
function underPath(routePath: string, guardPath: string): boolean {
  const norm = (p: string) => {
    const s = ("/" + String(p || "/").replace(/^\/+/, "")).replace(/\/+$/, "");
    return s === "" ? "/" : s;
  };
  const route = norm(routePath);
  const guard = norm(guardPath);
  if (guard === "/") return true;
  return route === guard || route.startsWith(guard + "/");
}

function serialize(doc: NonNullable<Awaited<ReturnType<typeof analysisService.getOwnedAnalysis>>>) {
  return {
    id: doc._id.toString(),
    projectId: String(doc.project),
    status: doc.status,
    repoInfo: doc.repoInfo ?? null,
    stats: doc.stats ?? null,
    failures: doc.failures ?? [],
    error: doc.error ?? null,
    durationMs: doc.durationMs ?? null,
    createdAt: doc.createdAt,
    completedAt: doc.completedAt ?? null,
    metadata: doc.metadata ?? null, // compact ProjectMetadata JSON (no ASTs)
    architecture: doc.architecture ?? null // validated Architecture JSON
  };
}

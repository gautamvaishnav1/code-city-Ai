import type { ProjectDocument } from "../projects/project.model";
import { AnalysisModel } from "./analysis.model";
import type { AnalysisDocument } from "./analysis.model";
import { downloadAndExtractRepo } from "../../infrastructure/github/github.service";
import { parseGitHubUrl } from "../../modules/repository/repo-url.util";
import { loadDemoProject } from "./demo.source";
import { parseRepository } from "../parser/parser.service";
import { generateArchitecture } from "../ai/architect.service";
import { buildCityWorld } from "../ai/city.builder";
import { tryIO } from "../../infrastructure/realtime/io";
import { logger } from "../../shared/utils/logger";
import { ApiError } from "../../shared/utils/api-error";
import type { Architecture, CityWorld } from "./analysis.types";

const roomFor = (projectId: string) => `project:${projectId}`;

function emitToProject(projectId: string, event: string, payload: unknown): void {
  try {
    tryIO()?.to(roomFor(projectId)).emit(event, payload);
  } catch (err) {
    logger.debug("socket emit skipped", { event, error: err instanceof Error ? err.message : err });
  }
}

/** One analysis at a time per project keeps memory sane during demos. */
const inFlightProjects = new Set<string>();

export interface StartAnalysisResult {
  analysisId: string;
}

/**
 * Kicks off the full pipeline asynchronously:
 *   GitHub -> scanner -> Babel AST -> analyzer JSON -> AI architecture -> Mongo
 * Live progress flows over Socket.IO: analysis:started / progress / completed / failed.
 */
export async function startAnalysis(
  project: ProjectDocument,
  userId: string
): Promise<StartAnalysisResult> {
  if (inFlightProjects.has(String(project._id))) {
    throw ApiError.conflict("An analysis for this project is already running");
  }

  // ── Repo URL cache: if this GitHub repo was already analyzed by anyone,
  //    clone the stored explanation into this project instead of re-running
  //    the full pipeline (no download / parse / LLM round-trip).
  let repoFullName: string | undefined;
  try {
    const parsed = parseGitHubUrl(project.repoUrl ?? "");
    repoFullName = `${parsed.owner}/${parsed.repo}`;
  } catch {
    // demo:// or unusual URLs are not cacheable — run the normal pipeline
  }

  if (repoFullName) {
    const cached = await AnalysisModel.findOne({
      status: "completed",
      "repoInfo.fullName": repoFullName
    })
      .sort({ createdAt: -1 })
      .lean();

    if (cached) {
      const projectId = String(project._id);
      const now = new Date();
      const clone = await AnalysisModel.create({
        project: project._id,
        requestedBy: userId,
        status: "completed",
        repoInfo: cached.repoInfo,
        stats: { ...(cached.stats ?? {}), cacheHit: true },
        metadata: cached.metadata ?? undefined,
        architecture: cached.architecture ?? undefined,
        districts: cached.districts ?? undefined,
        dependencies: cached.dependencies ?? undefined,
        techStack: cached.techStack ?? undefined,
        failures: [],
        durationMs: cached.durationMs ?? 0,
        startedAt: now,
        completedAt: now
      });

      const { ProjectModel } = await import("../projects/project.model");
      await ProjectModel.updateOne(
        { _id: projectId },
        { $set: { lastAnalysis: clone._id } }
      ).exec();

      emitToProject(projectId, "analysis:completed", {
        analysisId: String(clone._id),
        projectId,
        stats: { ...(cached.stats ?? {}), cacheHit: true },
        architecture: {
          componentCount: (cached.architecture as Architecture | undefined)?.components.length ?? 0,
          connectionCount: (cached.architecture as Architecture | undefined)?.connections.length ?? 0
        },
        engine: (cached.stats as Record<string, unknown> | undefined)?.aiEngine ?? "cached",
        aiEngine: (cached.stats as Record<string, unknown> | undefined)?.aiEngine ?? "cached"
      });

      logger.info("Analysis served from repo cache", {
        analysisId: String(clone._id),
        repo: repoFullName,
        sourceAnalysisId: String(cached._id)
      });
      return { analysisId: String(clone._id) };
    }
  }

  const analysis = await AnalysisModel.create({
    project: project._id,
    requestedBy: userId,
    status: "running",
    startedAt: new Date()
  });

  const projectId = String(project._id);
  const analysisId = String(analysis._id);
  inFlightProjects.add(projectId);

  // fire-and-forget: REST responds immediately, Socket.IO streams progress
    void runPipeline({ analysis, project, projectId, analysisId, repoUrl: project.repoUrl })
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const details = (err as { details?: unknown }).details;
      logger.error("Analysis failed", { analysisId, error: message, details });
      await AnalysisModel.findByIdAndUpdate(analysisId, {
        status: "failed",
        error: { message },
        completedAt: new Date()
      }).catch(() => undefined);
      emitToProject(projectId, "analysis:failed", { analysisId, projectId, error: message });
    })
    .finally(() => {
      inFlightProjects.delete(projectId);
    });

  return { analysisId };
}

interface PipelineArgs {
  analysis: AnalysisDocument;
  project: ProjectDocument;
  projectId: string;
  analysisId: string;
  repoUrl: string;
}

async function runPipeline({ analysis, project, projectId, analysisId, repoUrl }: PipelineArgs): Promise<void> {
  const startedAt = Date.now();
  const step = (
    stepName: string,
    extra: Record<string, unknown> = {},
    percent?: number
  ): void =>
    emitToProject(projectId, "analysis:progress", {
      analysisId,
      projectId,
      step: stepName,
      ...(percent !== undefined ? { percent } : {}),
      ...extra
    });

  emitToProject(projectId, "analysis:started", { analysisId, projectId, repoUrl });

  // 1. Source: bundled demo dir (offline) or GitHub download
  const isDemo = (project as unknown as { source?: string }).source === "demo"
    || repoUrl.startsWith("demo://");
  step(isDemo ? "demo" : "github",
    { message: isDemo ? "Loading bundled demo project…" : "Downloading repository…" }, 2);
  const { dir, info, cleanedUp } = isDemo
    ? await loadDemoProject()
    : await downloadAndExtractRepo(repoUrl, analysisId);
  try {
    // 2. Scanner + parser + analyzer (per-file fault tolerance inside)
    step("scan", { message: "Scanning .js/.jsx/.ts/.tsx files…" }, 10);

    let lastPercent = 10;
    const outcome = parseRepository(dir, {
      name: info.repo,
      repo: info.fullName,
      branch: info.defaultBranch,
      description: info.description,
      primaryLanguage: info.primaryLanguage
    }, (current, total) => {
      const percent = Math.min(70, 10 + Math.round((current / Math.max(1, total)) * 60));
      if (percent !== lastPercent) {
        lastPercent = percent;
        step("parse", { current, total, message: `Parsing files ${current}/${total}` }, percent);
      }
    });

    step("ai", { message: "Generating architecture with AI…" }, 75);

    // 3. AI architect (LLM with strict validation, heuristic fallback)
    const { architecture, engine }: { architecture: Architecture; engine: string } =
      await generateArchitecture(outcome.metadata);

    step("city", { message: "Laying out the 3D city…" }, 85);

    // 3b. City builder: districts, positions, visuals, paths, deps, diff
    const previousDoc = await AnalysisModel.findOne({
      project: analysis.project,
      status: "completed",
      _id: { $ne: analysis._id }
    })
      .sort({ createdAt: -1 })
      .select("architecture")
      .lean();

    const city = buildCityWorld(
      architecture,
      outcome.metadata,
      previousDoc?.architecture
        ? {
            id: String(previousDoc._id),
            components: previousDoc.architecture.components ?? [],
            connections: previousDoc.architecture.connections ?? []
          }
        : null,
      new Date()
    );

    step("save", { message: "Saving analysis…" }, 92);

    // 3c. deterministic city-health telemetry for the frontend overlay
    const health = computeCityHealth(city, outcome.metadata.stats);

    // 4. Persist
    const durationMs = Date.now() - startedAt;
    const updated = await AnalysisModel.findByIdAndUpdate(
      analysisId,
      {
        status: "completed",
        repoInfo: {
          fullName: info.fullName,
          defaultBranch: info.defaultBranch,
          primaryLanguage: info.primaryLanguage,
          description: info.description,
          stars: info.stars
        },
        stats: {
          ...outcome.metadata.stats,
          scannedFiles: outcome.scan.files.length,
          truncatedScan: outcome.scan.truncated,
          ignoredDirs: outcome.scan.ignoredDirsHit.slice(0, 12),
          aiEngine: engine,
          healthScore: health.healthScore,
          bottlenecks: health.bottlenecks
        },
        metadata: outcome.metadata as unknown as Record<string, unknown>,
        architecture: city.architecture,
        districts: city.districts,
        dependencies: city.dependencies,
        techStack: city.techStack,
        changes: city.changes,
        failures: outcome.failures.slice(0, 50),
        durationMs,
        completedAt: new Date()
      },
      { new: true }
    );

    const { ProjectModel } = await import("../projects/project.model");
    await ProjectModel.updateOne({ _id: projectId }, { $set: { lastAnalysis: analysisId } }).exec();

    emitToProject(projectId, "analysis:completed", {
      analysisId,
      projectId,
      stats: {
        filesConsidered: outcome.metadata.stats.filesConsidered,
        filesParsedBabel: outcome.metadata.stats.filesParsedBabel,
        filesFallback: outcome.metadata.stats.filesFallback,
        routes: outcome.metadata.stats.totalRoutes,
        models: outcome.metadata.stats.totalModels,
        durationMs,
        healthScore: health.healthScore,
        bottlenecks: health.bottlenecks
      },
      architecture: {
        componentCount: city.architecture.components.length,
        connectionCount: city.architecture.connections.length,
        districts: city.districts.map((d) => ({ id: d.id, color: d.color })),
        components: city.architecture.components.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          district: c.district,
          position: c.position
        }))
      },
      engine,
      aiEngine: engine
    });

    logger.info("Analysis completed", {
      analysisId,
      repo: info.fullName,
      engine,
      components: city.architecture.components.length,
      connections: city.architecture.connections.length,
      durationMs
    });
    void updated;
  } finally {
    await cleanedUp();
  }
}

/**
 * Deterministic 0-100 "city health" summary for frontend overlays:
 * - healthScore: starts at 100, reduced by average building complexity and
 *   the share of files that failed to parse (never below 5).
 * - bottlenecks: up to 3 most complex hub components (complexity >= 60),
 *   tie-broken by importance then id for stable ordering.
 */
function computeCityHealth(
  city: CityWorld,
  stats: { filesFailed: number; filesConsidered: number }
): { healthScore: number; bottlenecks: string[] } {
  const comps = city.architecture.components;
  const avgComplexity =
    comps.reduce((sum, c) => sum + c.visual.complexity, 0) / Math.max(1, comps.length);
  const failureRatio = stats.filesFailed / Math.max(1, stats.filesConsidered);
  const healthScore = Math.round(
    Math.min(100, Math.max(5, 100 - avgComplexity * 0.45 - failureRatio * 40))
  );

  const bottlenecks = [...comps]
    .sort(
      (a, b) =>
        b.visual.complexity - a.visual.complexity ||
        b.visual.importance - a.visual.importance ||
        a.id.localeCompare(b.id)
    )
    .filter((c) => c.visual.complexity >= 60)
    .slice(0, 3)
    .map((c) => c.id);

  return { healthScore, bottlenecks };
}

import type { AnalysisDocument } from "../analysis/analysis.model";
import { AnalysisModel } from "../analysis/analysis.model";
import { parseGitHubUrl } from "./repo-url.util";
import { ApiError } from "../../shared/utils/api-error";

export interface RepoExplanation {
  summary: string;
  highlights: {
    filesAnalyzed: number | null;
    components: number;
    connections: number;
    districts: number;
    routes: number | null;
    models: number | null;
    healthScore: number | null;
    aiEngine: string | null;
  };
}

export interface RepoExplanationPayload {
  cached: true;
  analysisId: string;
  projectId: string;
  repoInfo: NonNullable<AnalysisDocument["repoInfo"]> & {
    techStack: AnalysisDocument["techStack"] | null;
  };
  stats: Record<string, unknown>;
  explanation: RepoExplanation;
  districts: AnalysisDocument["districts"];
  architecture: NonNullable<AnalysisDocument["architecture"]>;
  dependencies: AnalysisDocument["dependencies"];
  changes: AnalysisDocument["changes"] | null;
  durationMs: number;
  analyzedAt: Date;
}

/**
 * Looks up the latest completed analysis for a GitHub repository URL —
 * across ALL projects in the database, not just the caller's own.
 * The repo itself is public, so its derived city plan is safe to share;
 * ownership walls still apply to every project-scoped endpoint.
 */
export async function explainRepo(url: string): Promise<RepoExplanationPayload> {
  const parsed = parseGitHubUrl(url);
  const fullName = `${parsed.owner}/${parsed.repo}`.toLowerCase();

  const doc = (await AnalysisModel.findOne({
    status: "completed",
    "repoInfo.fullName": fullName
  })
    .sort({ createdAt: -1 })
    .limit(1)) as AnalysisDocument | null;

  if (!doc || !doc.architecture) {
    throw ApiError.notFound(
      `No cached analysis for ${fullName} yet. Analyze it first to populate the database.`
    );
  }

  return {
    cached: true,
    analysisId: String(doc._id),
    projectId: String(doc.project),
    repoInfo: { ...doc.repoInfo!, techStack: doc.techStack ?? null },
    stats: doc.stats ?? {},
    explanation: buildExplanation(doc),
    districts: doc.districts ?? [],
    architecture: doc.architecture,
    dependencies: doc.dependencies ?? { runtime: [], dev: [] },
    changes: doc.changes ?? null,
    durationMs: doc.durationMs ?? 0,
    analyzedAt: doc.completedAt ?? doc.createdAt
  };
}

/** Deterministic human-readable walkthrough of what the stored analysis found. */
function buildExplanation(doc: AnalysisDocument): RepoExplanation {
  const info = doc.repoInfo!;
  const arch = doc.architecture!;
  const stats = (doc.stats ?? {}) as Record<string, unknown>;
  const num = (key: string): number | null =>
    typeof stats[key] === "number" ? (stats[key] as number) : null;

  const byType = new Map<string, string[]>();
  for (const c of arch.components) {
    const list = byType.get(c.type) ?? [];
    list.push(c.name);
    byType.set(c.type, list);
  }
  const topTypes = [...byType.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([type, names]) => `${names.length} ${type}${names.length === 1 ? "" : "s"}`)
    .join(", ");

  const languages = doc.techStack?.languages?.length
    ? ` Built with ${doc.techStack.languages.join(", ")}.`
    : "";
  const stars = info.stars > 0 ? ` (${info.stars} ★)` : "";

  const summary =
    `${info.fullName}${stars} is a ${info.primaryLanguage ?? "JavaScript"} repository` +
    `${info.description ? ` — "${info.description}"` : ""}.${languages} ` +
    `The analyzer processed ${num("filesConsidered") ?? num("scannedFiles") ?? "an unknown number of"} files` +
    `${doc.durationMs ? ` in ${(doc.durationMs / 1000).toFixed(1)}s` : ""} and produced a 3D city of ` +
    `${arch.components.length} buildings across ${(doc.districts ?? []).length} districts, ` +
    `connected by ${arch.connections.length} roads (${topTypes}).`;

  return {
    summary,
    highlights: {
      filesAnalyzed: num("filesConsidered") ?? num("scannedFiles"),
      components: arch.components.length,
      connections: arch.connections.length,
      districts: (doc.districts ?? []).length,
      routes: num("totalRoutes"),
      models: num("totalModels"),
      healthScore: num("healthScore"),
      aiEngine: typeof stats.aiEngine === "string" ? stats.aiEngine : null
    }
  };
}

import { ApiError } from "../../shared/utils/api-error";
import type { ProjectDocument } from "./project.model";
import { ProjectModel } from "./project.model";
import type { CreateProjectInput } from "./project.validation";

/** Idempotent: submitting the same repoUrl twice returns the existing project. */
export async function createProject(
  userId: string,
  input: CreateProjectInput
): Promise<{ project: ProjectDocument; reused: boolean }> {
  const existing = await ProjectModel.findOne({ owner: userId, repoUrl: input.repoUrl }).catch(
    () => null
  );
  if (existing) return { project: existing, reused: true };
  return { project: await ProjectModel.create({ ...input, owner: userId }), reused: false };
}

export async function listProjects(userId: string): Promise<unknown[]> {
  const docs = await ProjectModel.find({ owner: userId }).sort({ createdAt: -1 }).limit(100).lean();
  // .lean() bypasses toJSON transforms — normalize ids manually for a stable contract
  return docs.map(({ _id, __v, owner, lastAnalysis, ...rest }) => ({
    ...rest,
    id: String(_id),
    ownerId: String(owner),
    lastAnalysisId: lastAnalysis ? String(lastAnalysis) : null
  }));
}

/** Loads the project AND enforces ownership (throws 403 otherwise). */
export async function getOwnedProject(
  projectId: string,
  userId: string
): Promise<ProjectDocument> {
  if (!projectId || projectId.length < 12) {
    throw ApiError.notFound("Project not found");
  }
  const project = await ProjectModel.findById(projectId);
  if (!project) throw ApiError.notFound("Project not found");
  if (String(project.owner) !== String(userId)) {
    throw ApiError.forbidden("You do not own this project");
  }
  return project;
}

export async function deleteProject(projectId: string, userId: string): Promise<void> {
  const project = await getOwnedProject(projectId, userId);
  // Best-effort cleanup of related analyses (kept simple on purpose).
  const { AnalysisModel } = await import("../analysis/analysis.model");
  try {
    await AnalysisModel.deleteMany({ project: project._id });
  } catch {
    /* non-fatal */
  }
  await ProjectModel.findByIdAndDelete(project._id);
}

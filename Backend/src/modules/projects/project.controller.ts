import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/utils/async-handler";
import * as projectService from "./project.service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { project, reused } = await projectService.createProject(req.user!.id, req.body as never);
  res.status(reused ? 200 : 201).json({
    success: true,
    message: reused ? "Existing project for this repository returned" : "Project created",
    data: { project, reused }
  });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const projects = await projectService.listProjects(req.user!.id);
  res.status(200).json({ success: true, data: { projects } });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectService.getOwnedProject(String(req.params.id), req.user!.id);
  res.status(200).json({
    success: true,
    data: {
      project: {
        id: project._id.toString(),
        name: project.name,
        description: project.description ?? "",
        repoUrl: project.repoUrl,
        source: (project as unknown as { source?: string }).source ?? "github",
        lastAnalysisId: project.lastAnalysis?.toString() ?? null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      }
    }
  });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await projectService.deleteProject(String(req.params.id), req.user!.id);
  res.status(200).json({ success: true, message: "Project deleted" });
});

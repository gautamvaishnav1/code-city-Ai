import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/utils/async-handler";
import { explainRepo } from "./repo-explain.service";

/** POST /repos/explain — cached repo walkthrough for a GitHub URL. */
export const explain = asyncHandler(async (req: Request, res: Response) => {
  const data = await explainRepo(String(req.body?.url ?? ""));
  res.status(200).json({ success: true, data });
});

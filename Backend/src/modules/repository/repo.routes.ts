import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../shared/middleware/auth.middleware";
import { validate } from "../../shared/middleware/validate.middleware";
import { explain } from "./repo-explain.controller";

const router = Router();

const explainSchema = z.object({
  url: z.string().trim().min(1, "Repository URL is required")
});

router.use(requireAuth);
router.post("/explain", validate({ body: explainSchema }), explain);

export default router;

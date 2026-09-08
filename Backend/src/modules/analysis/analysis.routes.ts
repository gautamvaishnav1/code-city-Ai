import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../shared/middleware/auth.middleware";
import { validate } from "../../shared/middleware/validate.middleware";
import { aiLimiter, readLimiter } from "../../shared/middleware/rate-limiter.middleware";
import { start, getAnalysis, getStatus, getArchitecture } from "./analysis.controller";

const router = Router();
const idParam = z.object({ id: z.string().min(1) });

router.use(requireAuth);

// POST /api/v1/projects/:id/analyze
router.post("/projects/:id/analyze", aiLimiter, validate({ params: idParam }), start);

// GET /api/v1/analyses/:id and /api/v1/analyses/:id/status
// (status is polled during analysis — keep it under the global limit only)
router.get("/analyses/:id", readLimiter, validate({ params: idParam }), getAnalysis);
router.get("/analyses/:id/status", validate({ params: idParam }), getStatus);

// GET /api/v1/projects/:id/architecture
router.get("/projects/:id/architecture", readLimiter, validate({ params: idParam }), getArchitecture);

export default router;

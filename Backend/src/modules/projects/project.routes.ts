import { Router } from "express";
import { z } from "zod";
import { create, list, getOne, remove } from "./project.controller";
import { validate } from "../../shared/middleware/validate.middleware";
import { requireAuth, requireDemoForGuest } from "../../shared/middleware/auth.middleware";
import { createProjectSchema } from "./project.validation";

const router = Router();
const idParam = z.object({ id: z.string().min(1) });

router.use(requireAuth);
// guests (anonymous demo sessions) may only create demo:// projects — the
// sign-in gate for real repositories is enforced here, not just in the UI
router.post("/", requireDemoForGuest, validate({ body: createProjectSchema }), create);
router.get("/", list);
router.get("/:id", validate({ params: idParam }), getOne);
router.delete("/:id", validate({ params: idParam }), remove);

export default router;

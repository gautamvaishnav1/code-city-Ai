import express from "express";
import helmet from "helmet";
import cors from "cors";
import mongoose from "mongoose";
import type { NextFunction, Request, Response } from "express";
import { env } from "./config/env";
import { apiLimiter } from "./shared/middleware/rate-limiter.middleware";
import { sanitizeRequest } from "./shared/middleware/sanitize.middleware";
import { errorHandler, notFoundHandler } from "./shared/errors/error.middleware";
import authRoutes from "./modules/auth/auth.routes";
import repoRoutes from "./modules/repository/repo.routes";
import projectRoutes from "./modules/projects/project.routes";
import analysisRoutes from "./modules/analysis/analysis.routes";
import chatRoutes from "./modules/ai/ai.routes";
import logRoutes from "./modules/logs/logs.routes";
import insightRoutes from "./modules/insights/insights.routes";

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.corsOrigins.includes("*") || env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(null, false);
    },
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

// input hardening before anything reads user data: strips NoSQL operator keys
// ($gt, $where, dotted paths, __proto__) and collapses duplicated query params
app.use(sanitizeRequest);

// lightweight request logging with duration
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health") return next();
  const startedAt = Date.now();
  res.on("finish", () => {
    // eslint-disable-next-line no-console
    console.log(
      `${new Date().toISOString()} [HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`
    );
  });
  next();
});

app.use(apiLimiter);

/* ------------------------------- health ------------------------------- */
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    db:
      mongoose.connection.readyState === 1
        ? "connected"
        : mongoose.connection.readyState === 2
          ? "connecting"
          : "disconnected",
    timestamp: new Date().toISOString()
  });
});

/* ------------------------------- routes ------------------------------- */
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", logRoutes); // SSE log tail — must precede analysis routes (they auth-wall /api/v1)
app.use("/api/v1", insightRoutes); // AI insights
app.use("/api/v1/repos", repoRoutes); // cached repo explanations (URL -> stored analysis)
app.use("/api/v1/projects", projectRoutes); // create/list/get/delete
app.use("/api/v1", analysisRoutes); // analyze / analyses / architecture
app.use("/api/v1", chatRoutes); // chat

/* --------------------------- error handling ---------------------------- */
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

import http from "node:http";
import { Server } from "socket.io";
import app from "./app";
import { env, isProd } from "./config/env";
import { logger, } from "./shared/utils/logger";
import { connectDB, disconnectDB } from "./infrastructure/database/db.connect";
import { setIO } from "./infrastructure/realtime/io";
import { registerSocketServer } from "./modules/realtime/socket.server";
import { cleanupStaleWorkDirs, logCloneToolchain } from "./infrastructure/github/github.service";

async function main(): Promise<void> {
  logger.secretWarning();

  // Report git/tar versions so production logs confirm the clone toolchain is
  // ready before the first analysis (the git-clone fallback needs git present).
  await logCloneToolchain();

  // Sweep orphaned repo-download/git-clone temp dirs left behind by any
  // crashed or restarted process before we start taking on new work.
  const swept = cleanupStaleWorkDirs();
  if (swept > 0) logger.info(`Cleaned up ${swept} stale temp work dir(s) from a previous run`);

  await connectDB(env.mongoUri);

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || env.corsOrigins.includes("*") || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(null, false);
      },
      credentials: true
    }
  });
  setIO(io);
  registerSocketServer(io);

  const server = httpServer.listen(env.port, () => {
    logger.info(`Software World API listening on port ${env.port} (${env.nodeEnv})`);
    logger.info(`Health:      http://localhost:${env.port}/health`);
    logger.info(`Auth:        POST http://localhost:${env.port}/api/v1/auth/register`);
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(
        `Port ${env.port} is already in use. Another server instance is running.\n` +
          `  Fix 1: stop it            -> npx kill-port ${env.port}   (or close that terminal)\n` +
          `  Fix 2: use another port   -> set PORT=${env.port === 5000 ? 5001 : 5000} in .env`
      );
    } else {
      logger.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.warn(`${signal} received — shutting down gracefully…`);
    server.close(async () => {
      io.close();
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason: String(reason) });
  });
  // A stray throw outside any request (e.g. a console EPIPE on a closed pipe)
  // would otherwise hard-crash with no log and no graceful shutdown.
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception — shutting down", {
      message: err.message,
      stack: isProd ? undefined : err.stack
    });
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", {
    message: err instanceof Error ? err.message : String(err)
  });
  process.exit(1);
});

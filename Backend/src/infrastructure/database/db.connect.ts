import mongoose from "mongoose";
import { logger } from "../../shared/utils/logger";

export async function connectDB(uri: string): Promise<void> {
  mongoose.connection.on("connected", () => {
    logger.info(`MongoDB connected -> ${mongoose.connection.host}/${mongoose.connection.name}`);
  });
  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB connection error", { message: err.message });
  });
  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 10,
    minPoolSize: 2,
    waitQueueTimeoutMS: 3_000,
  });
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  logger.info("MongoDB connection closed");
}

import mongoose from "mongoose";
import type {
  AnalysisStatus,
  Architecture,
  ChangeTracking,
  District,
  RuntimeDependency,
  TechStack
} from "./analysis.types";

export interface AnalysisDocument extends mongoose.Document {
  project: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  status: AnalysisStatus;
  repoInfo?: {
    fullName: string;
    defaultBranch: string;
    primaryLanguage?: string;
    description?: string;
    stars: number;
  };
  stats?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  architecture?: Architecture;
  districts?: District[];
  dependencies?: { runtime: RuntimeDependency[]; dev: string[] };
  techStack?: TechStack;
  changes?: ChangeTracking;
  failures?: Array<{ file: string; error: string; strategy: string }>;
  error?: { message: string };
  durationMs?: number;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const analysisSchema = new mongoose.Schema<AnalysisDocument>(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["running", "completed", "failed"],
      default: "running",
      index: true
    },
    repoInfo: {
      fullName: String,
      defaultBranch: String,
      primaryLanguage: String,
      description: String,
      stars: Number
    },
    stats: { type: mongoose.Schema.Types.Mixed },
    metadata: { type: mongoose.Schema.Types.Mixed }, // compact ProjectMetadata JSON
    architecture: { type: mongoose.Schema.Types.Mixed }, // validated Architecture JSON
    districts: { type: mongoose.Schema.Types.Mixed }, // 3D city districts
    dependencies: { type: mongoose.Schema.Types.Mixed }, // runtime npm graph + dev list
    techStack: { type: mongoose.Schema.Types.Mixed }, // categorized tech detection
    changes: { type: mongoose.Schema.Types.Mixed }, // diff vs previous analysis
    failures: [
      {
        file: String,
        error: String,
        strategy: String
      }
    ],
    error: { message: String },
    durationMs: Number,
    startedAt: { type: Date, default: Date.now },
    completedAt: Date
  },
  { timestamps: true }
);

// powers POST /repos/explain — latest completed analysis per repository
analysisSchema.index({ "repoInfo.fullName": 1, status: 1, createdAt: -1 });

export const AnalysisModel = mongoose.model<AnalysisDocument>("Analysis", analysisSchema);

// Fast repo-URL cache lookups (see startAnalysis in analysis.pipeline.ts)
analysisSchema.index({ "repoInfo.fullName": 1, status: 1, createdAt: -1 });

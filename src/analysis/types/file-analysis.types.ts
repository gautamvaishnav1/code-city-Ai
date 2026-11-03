import { GraphEdgeDraft, GraphNodeDraft } from "./graph.types.js";

export type AnalysisStatus =
  | 'ok'
  | 'parse_error'
  | 'traverse_error'
  | 'skipped';

export interface FileMetrics {
  loc: number;

  imports: string[];
  requires: string[];
  exports: string[];

  classes: string[];
  functions: string[];

  complexity: number;

  hasTryCatch: boolean;
  hasThrow: boolean;
  hasAwait: boolean;
  hasProcessEnv: boolean;

  hasConsoleLog: boolean;
  hasConsoleError: boolean;
  hasSilentCatch: boolean;

  hasExternalCall: boolean;
  hasDecorator: boolean;
}

export interface FileAnalysis {
  file: string;
  status: AnalysisStatus;
  metrics?: FileMetrics;
  error?: string;
  reason?: string;
}

export interface AnalysisContext {
  relativePath: string;
  fileKey: string;
  metrics: FileMetrics;
  nodes: GraphNodeDraft[];
  edges: GraphEdgeDraft[];
  addNode: (node: GraphNodeDraft) => void;
  addEdge: (edge: GraphEdgeDraft) => void;
}
export interface ResolvedGraph {
  nodes: GraphNodeDraft[];
  edges: GraphEdgeDraft[];
}
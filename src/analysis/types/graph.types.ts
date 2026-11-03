import { AnalysisStatus, FileMetrics } from "./file-analysis.types.js";

export type GraphNodeType =
  | 'file'
  | 'class'
  | 'function'
  | 'method'
  | 'external_package'
  | 'unresolved';

export type GraphEdgeType ='contains' | 'calls' | 'imports'|'requires' | 'unresolved_calls';

export interface GraphNodeDraft{
    key:string;
    type:GraphNodeType;
    name:string;
    path?:string;
    qualifiedName?:string;
    parentKey?:string;
    metrics?:Record<string,any>;
}

export interface GraphEdgeDraft{
    fromKey:string;
    toKey?:string;
    toName?:string;
    type:GraphEdgeType;
    weight?:number;
    resolved?:boolean;
    meta?:Record<string,any>;
}

export interface FileGraphAnalysis{
    file:string;
    status:AnalysisStatus;
    metrics?:FileMetrics;
    nodes:GraphNodeDraft[];
    edges:GraphEdgeDraft[];
    error?:string;
    reason?:string;
    sizeBytes?:number;
}
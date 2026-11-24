// ─────────────────────────────────────────────
// What kinds of THINGS exist in the city
// ─────────────────────────────────────────────
export type NodeType = 'file'|'class'|'method'|'package'|'unresolved'|'function'

// ─────────────────────────────────────────────
// What kinds of CONNECTIONS exist
// ─────────────────────────────────────────────
export type EdgeType = 'contains'|'imports'|'requires'|'calls'|'unresolved_calls'

// ─────────────────────────────────────────────
// A THING
// ─────────────────────────────────────────────

export interface GraphNode{
    key:string;
    Type:NodeType;
    name:string;
    path?:string;
    qualifiedName?:string;
    parentKey?:string;
    metrics?:Record<string,any>
}

// ─────────────────────────────────────────────
// A CONNECTION
// ─────────────────────────────────────────────

export interface GraphEdge{
    fromKey:string;
    toName?:string;
    toKey?:string;
    type:EdgeType;
    resolved?:boolean
}

// ─────────────────────────────────────────────
// MEASUREMENTS for one file
// ─────────────────────────────────────────────

export interface FileMetrics{
    loc:number;
    complexity:number;

    imports:string[];
    requires:string[];
    exports:string[];
    classes:string[];
    functions:string[];

    hasTryCatch:boolean;
    hasAwait:boolean;
    hasThrow:boolean;
    hasProcessEnv:boolean;
    hasConsoleLog:boolean;
    hasConsoleError:boolean;
    hasSilentCatch:boolean;
    hasExternalCall:boolean;
    hasDecorator:boolean;
}
// ─────────────────────────────────────────────
// RESULT of reading ONE file (draft)
// ─────────────────────────────────────────────

export interface FileGraph{
    file:string;
    edges:GraphEdge[];
    nodes:GraphNode[];
    status:'ok'|'parse_error'|'skipped';
    metrics?:FileMetrics;
    error?:string;
    size?:number;
}

export interface RepoGraph{
    nodes:GraphNode[];
    edges:GraphEdge[];
}
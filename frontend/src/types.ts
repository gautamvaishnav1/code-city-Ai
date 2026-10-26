export type Stack = "frontend" | "backend" | "database" | "external";
export type Kind =
  | "page"
  | "component"
  | "context"
  | "route"
  | "controller"
  | "service"
  | "middleware"
  | "model"
  | "api";

export interface FunctionNode {
  name: string;
  args: string;
  returns: string;
  purpose: string;
}

export interface BuildingNode {
  id: string;
  name: string;
  kind: Kind;
  loc: number;
  health: "ok" | "warn" | "error";
  /** deterministic 0..100 complexity from the analyzer — drives bottlenecks */
  complexity?: number;
  functions: FunctionNode[];
  /** real Express endpoint this route building serves (recovered by the AST
   *  analyzer). Present on `route` buildings only — it's what lets a traced
   *  request carry a true method/URL and know whether it needs a JWT. */
  route?: { method: string; path: string; handler?: string; guarded?: boolean };
}

export interface DistrictNode {
  id: string;
  name: string;
  stack: Stack;
  buildings: BuildingNode[];
}

export interface EdgeNode {
  from: string;
  to: string;
  kind: "http" | "query" | "import";
}

export interface CityJSON {
  project: { id?: string; name: string; stack: string };
  districts: DistrictNode[];
  edges: EdgeNode[];
  flows: Record<string, string[]>;
  /** 0..100 city health score from the analyzer (missing on older payloads) */
  healthScore?: number;
}

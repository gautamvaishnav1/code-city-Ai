/**
 * Data contracts produced by the parser module.
 * Babel converts source -> AST; ast-analyzer turns the AST into these compact
 * JSON structures. Raw ASTs NEVER leave this module.
 */

export type FileRole =
  | "entry"
  | "routes"
  | "controller"
  | "service"
  | "model"
  | "middleware"
  | "config"
  | "test"
  | "component"
  | "other";

export interface ImportFact {
  file: string;
  source: string;
  specifiers: string[];
}

export interface ExportFact {
  file: string;
  names: string[];
  kind: "named" | "default" | "module";
}

export interface FunctionFact {
  name: string;
  file: string;
  line: number;
  params: string[];
  isAsync: boolean;
  exported: boolean;
  kind: "function" | "arrow" | "method";
}

export interface ClassFact {
  name: string;
  file: string;
  line: number;
  extends: string | null;
  methods: string[];
  exported: boolean;
}

export interface RouteFact {
  /** HTTP method, or MOUNT when a router/app is mounted, or USE for app.use middleware. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "USE" | "ALL" | "MOUNT";
  path: string;
  handler: string;
  file: string;
}

export interface ModelFact {
  name: string;
  file: string;
  collection: string | null;
  fields: string[];
}

export interface ComponentFact {
  name: string;
  file: string;
  kind: "controller" | "service";
  type: "function" | "class" | "file";
  routeCount?: number;
}

export interface AuthIndicators {
  jwtLibraryUsed: boolean;
  passwordHashingUsed: boolean;
  passportUsed: boolean;
  sessionUsed: boolean;
  oauthUsed: boolean;
  authMiddlewareDetected: boolean;
  evidence: string[];
}

/** ES6+ syntax features detected in a single file. */
export interface SyntaxFacts {
  hasArrowFunctions: boolean;
  hasTemplateLiterals: boolean;
  hasDestructuring: boolean;
  hasSpreadOperator: boolean;
  hasAsyncAwait: boolean;
  hasGenerators: boolean;
  hasForOf: boolean;
  hasDefaultParams: boolean;
  hasClasses: boolean;
  hasGettersSetters: boolean;
  hasComputedProps: boolean;
  hasLetConst: boolean;
  hasModules: boolean; // import/export or require/module.exports
  /** True if file uses any ES6+ feature beyond basic ES5. */
  isES6Plus: boolean;
}

/** Runtime / diagnostic usage signals extracted from the AST. */
export interface RuntimeSignals {
  processEnvUsage: number;
  consoleErrorCalls: number;
  consoleWarnCalls: number;
  consoleLogCalls: number;
  awaitCalls: number;
  /** try/catch blocks where the catch body does NOT rethrow (error swallowed). */
  swallowedErrors: number;
  /** require() call count (CommonJS modules). */
  requireCalls: number;
  /** module.exports or exports.xxx assignment count. */
  cjsExports: number;
}

export interface FileFacts {
  path: string;
  lines: number;
  bytes: number;
  role: FileRole;
  syntax?: SyntaxFacts;
  signals?: RuntimeSignals;
  imports: ImportFact[];
  exports: ExportFact[];
  functions: FunctionFact[];
  classes: ClassFact[];
  routes: RouteFact[];
  models: ModelFact[];
  controllers: ComponentFact[];
  services: ComponentFact[];
  authEvidence: string[];
  parse: {
    ok: boolean;
    strategy: "babel" | "fallback";
    durationMs: number;
    error?: string;
  };
}

export interface ProjectStats {
  filesConsidered: number;
  filesParsedBabel: number;
  filesFallback: number;
  filesFailed: number;
  totalFunctions: number;
  totalClasses: number;
  totalRoutes: number;
  totalModels: number;
  durationMs: number;
}

/** The complete, compact JSON we persist and (trimmed) send to the AI. */
export interface ProjectMetadata {
  generatedAt: string;
  project: {
    name: string;
    repo: string; // owner/name
    branch?: string;
    description?: string;
    primaryLanguage?: string;
  };
  stats: ProjectStats;
  /** Aggregated ES6+ syntax signals across all files. */
  syntax?: {
    es6PlusFiles: number;
    totalFiles: number;
    arrowFunctions: number;
    asyncAwait: number;
    templateLiterals: number;
    destructuring: number;
    classes: number;
    modules: number;
  };
  /** Aggregated runtime/diagnostic signals across all files. */
  signals?: RuntimeSignals;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  files: Array<{ path: string; bytes: number; lines: number; role: FileRole }>;
  imports: ImportFact[];
  exports: ExportFact[];
  functions: FunctionFact[];
  classes: ClassFact[];
  routes: RouteFact[];
  controllers: ComponentFact[];
  services: ComponentFact[];
  models: ModelFact[];
  authIndicators: AuthIndicators;
}

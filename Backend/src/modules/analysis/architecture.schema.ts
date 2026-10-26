import { z } from "zod";
import { ApiError } from "../../shared/utils/api-error";
import type { Architecture, ArchitectureComponent, ArchitectureConnection } from "./analysis.types";

/** Raw shape we demand from the LLM. */
const rawComponentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z.string().min(1),
  description: z.string().optional(),
  files: z.array(z.string()).optional()
});

const rawArchitectureSchema = z.object({
  components: z.array(rawComponentSchema).min(1),
  connections: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional()
      })
    )
    .default([])
});

export interface RawArchitectureInput {
  components: Array<{
    id?: string;
    name: string;
    type: string;
    description?: string;
    files?: string[];
  }>;
  connections: Array<{ from: string; to: string; label?: string }>;
}

export function isArchitectureLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.components);
}

export function parseRawArchitecture(value: unknown): RawArchitectureInput {
  const result = rawArchitectureSchema.safeParse(value);
  if (!result.success) {
    throw ApiError.unprocessable("AI returned an invalid architecture structure", {
      issues: result.error.issues.slice(0, 8).map((i) => ({
        path: i.path.join("."),
        message: i.message
      }))
    });
  }
  return result.data as unknown as RawArchitectureInput;
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "component";
}

/** Aliases the LLM (and heuristics) commonly emit → the canonical type the
 *  city builder, district mapper and frontend renderer all agree on. Without
 *  this, "page"/"view"/"react" silently land in the Core district and render
 *  as generic `api` boxes — which is exactly how a repo's UI goes missing. */
const TYPE_ALIASES: Record<string, string> = {
  // UI surfaces
  frontend: "frontend",
  front_end: "frontend",
  front: "frontend",
  ui: "frontend",
  view: "frontend",
  page: "frontend",
  pages: "frontend",
  screen: "frontend",
  screens: "frontend",
  component: "frontend",
  components: "frontend",
  react: "frontend",
  vue: "frontend",
  svelte: "frontend",
  angular: "frontend",
  client: "frontend",
  web: "frontend",
  spa: "frontend",
  // HTTP layer
  route: "routes",
  routes: "routes",
  router: "routes",
  routers: "routes",
  endpoint: "routes",
  endpoints: "routes",
  controller: "controller",
  controllers: "controller",
  handler: "controller",
  handlers: "controller",
  routehandler: "controller",
  service: "service",
  services: "service",
  business: "service",
  logic: "service",
  // data layer
  model: "model",
  models: "model",
  schema: "model",
  schemas: "model",
  entity: "model",
  entities: "model",
  dao: "model",
  repository: "model",
  db: "database",
  database: "database",
  databases: "database",
  datastore: "database",
  storage: "database",
  persistence: "database",
  collection: "database",
  // cross-cutting
  middleware: "middleware",
  middlewares: "middleware",
  guard: "middleware",
  interceptor: "middleware",
  plugin: "middleware",
  auth: "auth",
  authentication: "auth",
  authorization: "auth",
  security: "auth",
  session: "auth",
  jwt: "auth",
  oauth: "auth",
  // outbound
  integration: "integration",
  integrations: "integration",
  external: "external",
  thirdparty: "external",
  third_party: "external",
  external_api: "external",
  third_party_api: "external",
  api_client: "external",
  sdk: "external",
  vendor: "external",
  // plumbing — only the aliases that would otherwise fall through to "other"
  // and lose their district; genuinely unknown types keep their raw slug so
  // nothing that used to work moves district.
  config: "config",
  configuration: "config",
  settings: "config",
  env: "config",
  bootstrap: "config",
  entry: "config",
  server: "config",
  app: "config",
  util: "config",
  utils: "config",
  helper: "config"
};

/** Canonical city type for any raw type string (idempotent). */
export function canonicalType(raw: string): string {
  const key = slugify(raw).replace(/-/g, "_");
  return TYPE_ALIASES[key] ?? key;
}

/**
 * Normalizes AI output into a strict, frontend-safe architecture:
 * - stable kebab-case ids (regenerated when missing/duplicated)
 * - connections filtered to reference existing component ids only
 */
export function normalizeArchitecture(raw: RawArchitectureInput): Architecture {
  const used = new Set<string>();
  const idByOriginal = new Map<string, string>();
  const components: ArchitectureComponent[] = [];
  let counter = 0;

  for (const c of raw.components) {
    let id = slugify(c.id ?? c.name ?? "");
    while (used.has(id)) {
      counter++;
      id = `${id}-${counter}`;
    }
    used.add(id);
    if (c.id) idByOriginal.set(c.id, id);
    idByOriginal.set(c.name, id);

    components.push({
      id,
      name: c.name.trim().slice(0, 120),
      type: canonicalType(c.type),
      description: (c.description ?? "").trim().slice(0, 500) || undefined,
      files: Array.isArray(c.files) ? c.files.slice(0, 12).map((f) => f.replace(/\\/g, "/")) : []
    });
  }

  // second pass: remap connection endpoints that referenced pre-normalized ids/names
  const resolveEndpoint = (endpoint: string): string | null => {
    if (used.has(endpoint)) return endpoint;
    const remapped = idByOriginal.get(endpoint);
    if (remapped && used.has(remapped)) return remapped;
    const fuzzy = slugify(endpoint);
    if (used.has(fuzzy)) return fuzzy;
    return null;
  };

  const seenConnections = new Set<string>();
  const connections: ArchitectureConnection[] = [];
  for (const conn of raw.connections) {
    const from = resolveEndpoint(conn.from);
    const to = resolveEndpoint(conn.to);
    if (!from || !to || from === to) continue; // dangling/self references dropped
    const key = `${from}->${to}:${conn.label ?? ""}`;
    if (seenConnections.has(key)) continue;
    seenConnections.add(key);
    connections.push({ from, to, label: (conn.label ?? "").slice(0, 80) || "uses" });
  }

  return { components: components.slice(0, 60), connections };
}

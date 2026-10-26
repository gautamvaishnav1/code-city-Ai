import { useMemo } from "react";
import { buildLayout } from "./layout";
import { useCity } from "../store/useCity";
import type { CityJSON, Kind, Stack } from "../types";

/* ── Backend architecture payload → CityJSON adapter ────────────── */

interface BackendComponent {
  id: string;
  name: string;
  type: string;
  description?: string;
  district: string;
  files?: Array<{ path: string; lines: number; functions?: string[] }>;
  /** deterministic 0..100 complexity from the analyzer (city builder) */
  visual?: { complexity?: number };
}

interface BackendConnection {
  id: string;
  from: string;
  to: string;
  type?: string;
}

interface BackendArchitecture {
  analysisId: string;
  projectId: string;
  repoInfo?: { fullName?: string; name?: string; defaultBranch?: string; techStack?: { languages?: string[] } | null } | null;
  /** GET /projects/:id/architecture */
  stats?: { healthScore?: number; bottlenecks?: string[] } | null;
  /** POST /repos/explain cache hit carries the score under explanation.highlights */
  explanation?: { highlights?: { healthScore?: number | null } } | null;
  districts?: Array<{ id: string; name: string }>;
  /** real Express routes from the AST analyzer (method + path + owning file);
   *  `guarded` = a router-level `router.use(requireAuth)` covers this path */
  routes?: Array<{ method: string; path: string; handler?: string; file?: string; guarded?: boolean }>;
  architecture: { components: BackendComponent[]; connections: BackendConnection[] };
}

const DISTRICT_STACK: Record<string, Stack> = {
  "frontend-district": "frontend",
  "backend-district": "backend",
  "data-district": "database",
  "external-district": "external",
  "core-district": "backend",
};

/** Backend component type → building kind. Alias-aware so a payload that says
 *  "page"/"view"/"ui" still renders a real UI building (kind `page`) instead of
 *  falling through to the generic `api` box. Canonical types behave exactly as
 *  before. */
function kindFor(type: string): Kind {
  const t = (type || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (
    t === "frontend" || t === "front_end" || t === "ui" || t === "view" ||
    t === "page" || t === "pages" || t === "screen" || t === "screens" ||
    t === "react" || t === "vue" || t === "svelte" || t === "client" || t === "spa"
  ) return "page";
  if (t === "component" || t === "components") return "component";
  if (t === "context" || t === "contexts" || t === "provider" || t === "store") return "context";
  if (t === "routes" || t === "route" || t === "router" || t === "routers" || t === "endpoint") return "route";
  if (t === "controller" || t === "controllers" || t === "handler" || t === "handlers") return "controller";
  if (t === "service" || t === "services") return "service";
  if (t === "middleware" || t === "middlewares" || t === "auth" || t === "guard" || t === "plugin") return "middleware";
  if (
    t === "model" || t === "models" || t === "schema" || t === "schemas" ||
    t === "database" || t === "databases" || t === "db" || t === "entity" ||
    t === "dao" || t === "repository" || t === "storage"
  ) return "model";
  return "api";
}

function edgeKind(type: string | undefined): "http" | "query" | "import" {
  if (type === "storage") return "query";
  if (!type || type === "internal" || type === "dependency") return "import";
  return "http"; // http · auth-flow · external-api
}

/** Analyzed-complexity → building health. Mirrors the backend's bottleneck
 *  rule (complexity >= 60 = a hot hub) and adds an elevated tier at >= 40. */
function healthFor(complexity: number | undefined): "ok" | "warn" | "error" {
  if (complexity == null) return "ok";
  if (complexity >= 60) return "error";
  if (complexity >= 40) return "warn";
  return "ok";
}

/** Best real endpoint for a route building: match the parser's RouteFacts by
 *  owning file, then prefer the most specific path (a file usually declares
 *  several; "/login" beats a bare "/"). Returns undefined for non-route
 *  buildings or when the analyzer recovered nothing. */
function routeFor(
  c: BackendComponent,
  facts: BackendArchitecture["routes"] = [],
): { method: string; path: string; handler?: string; guarded?: boolean } | undefined {
  if (facts.length === 0) return undefined;
  if (c.type !== "routes" && c.type !== "route" && c.type !== "router" && c.type !== "endpoint") return undefined;
  const files = new Set((c.files ?? []).map((f) => f.path.replace(/\\/g, "/")));
  const mine = facts.filter((f) => f.file && files.has(f.file) && f.path);
  if (mine.length === 0) return undefined;
  const best = mine.reduce((a, b) => (b.path.length > a.path.length ? b : a));
  return { method: best.method, path: best.path, handler: best.handler, guarded: best.guarded };
}

/** One backend component → one CityJSON building (shared by the district pass
 *  and the orphan-recovery pass so both produce identical buildings). */
function toBuilding(c: BackendComponent, data: BackendArchitecture) {
  return {
    id: c.id,
    name: c.name,
    kind: kindFor(c.type),
    loc: (c.files ?? []).reduce((a, f) => a + (f.lines ?? 0), 0),
    health: healthFor(c.visual?.complexity),
    complexity: c.visual?.complexity,
    functions: Array.from(new Set((c.files ?? []).flatMap((f) => f.functions ?? [])))
      .slice(0, 12)
      .map((name) => ({ name, args: "", returns: "—", purpose: c.description ?? "" })),
    // real endpoint this route building serves — matched by owning file
    route: routeFor(c, data.routes ?? []),
  };
}

/** Converts the validated CityWorld payload from
 *  GET /api/v1/projects/:id/architecture into the renderer's CityJSON. */
export function architectureToCity(data: BackendArchitecture): CityJSON {
  const components = data.architecture.components ?? [];

  /** district a component BELONGS to — falls back to the stack its type implies
   *  so a payload whose `district` id drifted (or is missing) still lands on a
   *  real street instead of silently disappearing from the city. */
  const stackForType = (type: string): Stack => {
    const k = kindFor(type);
    if (k === "page" || k === "component" || k === "context") return "frontend";
    if (k === "model") return "database";
    return "backend";
  };

  const districts = (data.districts ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    stack: DISTRICT_STACK[d.id] ?? "backend",
    buildings: components
      .filter((c) => c.district === d.id)
      .map((c) => toBuilding(c, data)),
  }));

  // orphan pass — components pointing at an unknown district id
  const known = new Set(districts.map((d) => d.id));
  const orphans = components.filter((c) => c.district && !known.has(c.district));
  for (const c of orphans) {
    const stack = stackForType(c.type);
    const target =
      districts.find((d) => d.stack === stack && d.buildings.length < 40) ??
      districts.find((d) => d.stack === stack);
    if (target) {
      target.buildings.push(toBuilding(c, data));
      continue;
    }
    districts.push({
      id: `recovered-${stack}-district`,
      name: `${stack === "frontend" ? "Frontend" : stack === "database" ? "Data" : "Backend"} District (recovered)`,
      stack,
      buildings: [toBuilding(c, data)],
    });
  }

  const ids = new Set<string>();
  for (const d of districts) for (const b of d.buildings) ids.add(b.id);

  return {
    project: {
      name: data.repoInfo?.fullName ?? data.repoInfo?.name ?? data.projectId,
      stack: data.repoInfo?.techStack?.languages?.join(" · ") || "javascript / typescript",
    },
    districts,
    // drop connections whose endpoints never became buildings — a dangling
    // edge renders as a dead arc and pollutes the flow inspector
    edges: (data.architecture.connections ?? [])
      .filter((c) => ids.has(c.from) && ids.has(c.to))
      .map((c) => ({
        from: c.from,
        to: c.to,
        kind: edgeKind(c.type),
      })),
    flows: {},
    healthScore: data.stats?.healthScore ?? data.explanation?.highlights?.healthScore ?? undefined,
  };
}

/** Layout derived reactively from the active CityJSON in the store. */
export function useCityLayout() {
  const city = useCity((s) => s.city);
  return useMemo(() => buildLayout(city), [city]);
}

/* ── API workflow derivation ────────────────────────────────────── */

const HOP_RANK: Record<string, number> = {
  controller: 0,
  service: 1,
  model: 2,
  api: 3,
  middleware: 4,
  route: 5,
  page: 8,
  component: 9,
  context: 10,
};

/**
 * Derives runnable API workflows from a repo's component graph when the
 * analyzer didn't emit explicit flows. Every `route` building seeds one
 * workflow: entry caller (whoever http-calls it) → route → controller →
 * service → model/external, following the highest-ranked outgoing edge.
 * Deterministic, cycle-safe, capped at 8 hops.
 */
export function deriveFlows(city: CityJSON): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const kindOf = new Map<string, Kind>();
  for (const d of city.districts) for (const b of d.buildings) kindOf.set(b.id, b.kind);
  const edges = city.edges ?? [];

  for (const d of city.districts) {
    for (const b of d.buildings) {
      if (b.kind !== "route") continue;

      // follow outgoing edges, preferring controller → service → model/api
      const chain: string[] = [b.id];
      const visited = new Set(chain);
      let cur = b.id;
      while (chain.length < 8) {
        const outs = edges
          .filter((e) => e.from === cur && !visited.has(e.to) && kindOf.has(e.to))
          .sort((x, y) => (HOP_RANK[kindOf.get(x.to)!] ?? 9) - (HOP_RANK[kindOf.get(y.to)!] ?? 9));
        if (outs.length === 0) break;
        cur = outs[0].to;
        visited.add(cur);
        chain.push(cur);
        const k = kindOf.get(cur);
        if (k === "model" || k === "api") break; // terminal hop
      }

      // prepend the entry caller (page/component that hits this route)
      const entry = edges.find(
        (e) => e.to === b.id && ["page", "component", "context", "api"].includes(kindOf.get(e.from) ?? ""),
      );
      if (entry && !visited.has(entry.from)) chain.unshift(entry.from);

      out[`auto:${b.id}`] = chain;
    }
  }
  return out;
}

/** pretty label for the built-in demo flows (static analysis can't recover
    the URL, so the curated three keep their real paths).
    `requiresAuth` mirrors the server: `requireAuth` guards /repos/explain,
    /projects, /analysis, /chat and /me — login MINTS the JWT so it can't
    need one. */
export const FLOW_META: Record<string, { label: string; method: string; path: string; requiresAuth: boolean }> = {
  login: { label: "Login", method: "POST", path: "/api/v1/auth/login", requiresAuth: false },
  payment: { label: "Payment", method: "POST", path: "/api/v1/payments", requiresAuth: true },
  cart: { label: "Cart sync", method: "PATCH", path: "/api/v1/cart/:id", requiresAuth: true },
};

/** Route names that are public on the server — a derived flow whose route
 *  building matches one of these is traced WITHOUT an Authorization header. */
export const PUBLIC_ROUTE_RE =
  /(login|sign-?in|register|sign-?up|verify-?otp|resend-?otp|oauth|google|github|forgot|reset-password|refresh|logout|health|public|insights)/i;

/** Auth middlewares seen in a recovered handler chain
 *  (`isAuthenticatedUser, isBlocked, getDashboardData`). When the analyzer
 *  gives us the handler list, that chain is stronger evidence than the URL:
 *  `GET /` is public because nothing guards it, `/update-user` is protected
 *  because `isAuthenticatedUser` sits in front of it. */
const AUTH_GUARD_RE =
  /\b(requireAuth|requireAdmin|requireRole|requireLogin|isAuthenticated\w*|isRefreshTokenValid|isTokenValid|isLoggedIn|protect\w*|verifyToken|validateToken|checkToken|checkAuth|ensureAuth|guard\w*|requireUser|isAdmin|isBlocked)\b/i;

export interface FlowAuth {
  /** true → the request sits behind requireAuth() and needs a valid JWT */
  requiresAuth: boolean;
  method: string;
  /** real URL when known (curated flows); "" = static analysis couldn't recover it */
  path: string;
  label: string;
  /** the recovered handler chain, e.g. "isAuthenticatedUser, isBlocked, getDashboardData" */
  guard?: string;
}

/** Auth policy for one flow — the single source of truth the courier, the
 *  REQUEST FLOW rows and the building sidebar all read.
 *  Curated flows carry an explicit flag. Derived flows read the REAL endpoint
 *  the analyzer recovered for their route building (method + path), preferring
 *  the recovered handler chain (does an auth middleware sit in front of it?)
 *  and falling back to a path-name heuristic when no handler was recovered. */
export function flowAuth(key: string, city: CityJSON): FlowAuth {
  const meta = FLOW_META[key];
  if (meta) return { requiresAuth: meta.requiresAuth, method: meta.method, path: meta.path, label: meta.label };

  // derived flows: real endpoint from the AST analyzer, if it was recovered
  const routeId = key.startsWith("auto:") ? key.slice("auto:".length) : key;
  const route = city.districts.flatMap((d) => d.buildings).find((b) => b.id === routeId);
  const name = route?.name ?? routeId;

  if (route?.route?.path) {
    const handler = route.route.handler?.replace(/\s+/g, " ").trim();
    // three signals, strongest first: a router-level guard (`router.use(requireAuth)`
    // covers every path in the file), then the per-route handler chain, then the URL name
    const requiresAuth =
      route.route.guarded === true
        ? true
        : handler
          ? AUTH_GUARD_RE.test(handler)
          : !PUBLIC_ROUTE_RE.test(route.route.path);
    return {
      requiresAuth,
      method: route.route.method,
      path: route.route.path,
      label: name,
      guard: handler ?? (route.route.guarded ? "router.use(requireAuth)" : undefined),
    };
  }
  return { requiresAuth: !PUBLIC_ROUTE_RE.test(name), method: "POST", path: "", label: name };
}

/** flow keys whose hop chain passes through this building (sidebar badges). */
export function flowsThrough(city: CityJSON, buildingId: string): string[] {
  const out: string[] = [];
  for (const [key, chain] of Object.entries(allFlows(city))) {
    if (chain.includes(buildingId)) out.push(key);
  }
  return out;
}

/**
 * The one merge point for "every runnable workflow": hand-authored
 * `city.flows` win; derived auto-flows are dropped when a hand-authored flow
 * already covers the same route building (no duplicate rows / curves).
 */
export function allFlows(city: CityJSON): Record<string, string[]> {
  const derived = deriveFlows(city);
  const covered = new Set<string>();
  for (const chain of Object.values(city.flows ?? {})) {
    for (const id of chain) if (id.startsWith("be-") && id.includes("route")) covered.add(id);
  }
  const out: Record<string, string[]> = {};
  for (const [key, chain] of Object.entries(derived)) {
    const routeId = key.slice("auto:".length);
    if (!covered.has(routeId)) out[key] = chain;
  }
  return { ...out, ...(city.flows ?? {}) };
}

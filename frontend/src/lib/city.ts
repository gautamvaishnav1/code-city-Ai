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
  districts?: Array<{ id: string; name: string }>;
  architecture: { components: BackendComponent[]; connections: BackendConnection[] };
}

const DISTRICT_STACK: Record<string, Stack> = {
  "frontend-district": "frontend",
  "backend-district": "backend",
  "data-district": "database",
  "external-district": "external",
  "core-district": "backend",
};

function kindFor(type: string): Kind {
  if (type === "frontend") return "page";
  if (type === "routes") return "route";
  if (type === "controller") return "controller";
  if (type === "service") return "service";
  if (type === "middleware" || type === "auth") return "middleware";
  if (type === "model" || type === "database") return "model";
  return "api";
}

function edgeKind(type: string | undefined): "http" | "query" | "import" {
  if (type === "storage") return "query";
  if (!type || type === "internal" || type === "dependency") return "import";
  return "http"; // http · auth-flow · external-api
}

/** Converts the validated CityWorld payload from
 *  GET /api/v1/projects/:id/architecture into the renderer's CityJSON. */
export function architectureToCity(data: BackendArchitecture): CityJSON {
  const components = data.architecture.components ?? [];
  const districts = (data.districts ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    stack: DISTRICT_STACK[d.id] ?? "backend",
    buildings: components
      .filter((c) => c.district === d.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: kindFor(c.type),
        loc: (c.files ?? []).reduce((a, f) => a + (f.lines ?? 0), 0),
        health: "ok" as const,
        functions: Array.from(new Set((c.files ?? []).flatMap((f) => f.functions ?? [])))
          .slice(0, 12)
          .map((name) => ({ name, args: "", returns: "—", purpose: c.description ?? "" })),
      })),
  }));

  return {
    project: {
      name: data.repoInfo?.fullName ?? data.repoInfo?.name ?? data.projectId,
      stack: data.repoInfo?.techStack?.languages?.join(" · ") || "javascript / typescript",
    },
    districts,
    edges: (data.architecture.connections ?? []).map((c) => ({
      from: c.from,
      to: c.to,
      kind: edgeKind(c.type),
    })),
    flows: {},
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
    the URL, so the curated three keep their real paths) */
export const FLOW_META: Record<string, { label: string; method: string; path: string }> = {
  login: { label: "Login", method: "POST", path: "/api/v1/auth/login" },
  payment: { label: "Payment", method: "POST", path: "/api/v1/payments" },
  cart: { label: "Cart sync", method: "PATCH", path: "/api/v1/cart/:id" },
};

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

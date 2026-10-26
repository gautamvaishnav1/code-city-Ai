/**
 * City builder: turns a validated Architecture into a strict, deterministic
 * "3D city world" for the frontend renderer.
 *
 * Guarantees (enforced again by assertCityWorld before persisting):
 *  - every component has district + position + size (no overlaps)
 *  - every connection references existing ids and its path starts at
 *    from.position and ends at to.position
 *  - all arrays are sorted -> byte-identical JSON for identical input
 */
import { ApiError } from "../../shared/utils/api-error";
import { canonicalType } from "../analysis/architecture.schema";
import type { ProjectMetadata } from "../parser/parser.types";
import type {
  Architecture,
  CityComponent,
  CityConnection,
  CityWorld,
  ConnectionType,
  District,
  FileMeta,
  Position3,
  RuntimeDependency,
  TechStack,
  TrafficVolume
} from "../analysis/analysis.types";

/* ------------------------------------------------------------------ */
/* Districts                                                           */
/* ------------------------------------------------------------------ */

interface DistrictSpec {
  id: string;
  name: string;
  color: string;
  slot: Position3;
}

const DISTRICT_SPECS: Record<string, DistrictSpec> = {
  frontend: { id: "frontend-district", name: "Frontend District", color: "#00F0FF", slot: { x: 0, y: 0, z: 140 } },
  backend: { id: "backend-district", name: "Backend District", color: "#A855F7", slot: { x: 0, y: 0, z: -140 } },
  data: { id: "data-district", name: "Data District", color: "#FF2E97", slot: { x: -240, y: 0, z: 0 } },
  external: { id: "external-district", name: "External District", color: "#FFB020", slot: { x: 240, y: 0, z: 0 } },
  core: { id: "core-district", name: "Core District", color: "#8A8F98", slot: { x: 0, y: 0, z: 340 } }
};

const DISTRICT_BOUNDS = { width: 160, depth: 160 };

function districtKeyFor(type: string): keyof typeof DISTRICT_SPECS {
  const t = canonicalType(type);
  if (t === "frontend") return "frontend";
  if (t === "model" || t === "database") return "data";
  if (t === "integration" || t === "external") return "external";
  if (
    t === "routes" ||
    t === "controller" ||
    t === "service" ||
    t === "middleware" ||
    t === "auth" ||
    t === "config"
  ) {
    return "backend";
  }
  return "core";
}

const BUILDING_STYLE: Record<string, CityComponent["visual"]["buildingStyle"]> = {
  frontend: "modern",
  routes: "gate",
  controller: "block",
  service: "block",
  middleware: "tower",
  auth: "tower",
  config: "lowrise",
  model: "datacenter",
  database: "datacenter",
  integration: "antenna",
  external: "antenna",
  other: "lowrise",
  utility: "lowrise"
};

const GLOW_BY_TYPE: Record<string, string> = {
  frontend: "#00FFFF",
  routes: "#C084FC",
  controller: "#A78BFA",
  service: "#A78BFA",
  middleware: "#F472B6",
  auth: "#F472B6",
  config: "#94A3B8",
  model: "#FF5CAD",
  database: "#FF5CAD",
  integration: "#FFC85C",
  external: "#FFC85C",
  other: "#B6BBC4",
  utility: "#B6BBC4"
};

/* ------------------------------------------------------------------ */
/* Connection classification                                          */
/* ------------------------------------------------------------------ */

const CONN_COLOR: Record<ConnectionType, string> = {
  http: "#00FF88",
  storage: "#FF2E97",
  "auth-flow": "#FFD166",
  "external-api": "#FFB020",
  internal: "#00F0FF",
  dependency: "#8A8F98"
};

const CONN_PROTOCOL: Record<ConnectionType, string> = {
  http: "REST",
  storage: "MongoDB",
  "auth-flow": "JWT",
  "external-api": "HTTPS",
  internal: "in-process",
  dependency: "npm"
};

function classifyConnection(label: string): ConnectionType {
  const l = label.toLowerCase();
  if (/persist|store|database|save|write/.test(l)) return "storage";
  if (/guard|auth|jwt|token|session/.test(l)) return "auth-flow";
  if (/integrat|external|third|webhook|sdk/.test(l)) return "external-api";
  if (/send|request|http|rest|fetch/.test(l)) return "http";
  if (/delegate|call|use|invoke|handle|dispatch/.test(l)) return "internal";
  return "dependency";
}

/* ------------------------------------------------------------------ */
/* Deterministic math helpers                                         */
/* ------------------------------------------------------------------ */

/** round to 1 decimal so identical inputs always serialize identically */
const r1 = (v: number): number => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** NOTE: these MUST compare exactly the way assertCityWorld's isSortedStrings()
 *  does — it checks the CONCATENATED key `from|to|label` with localeCompare,
 *  and sorting field-by-field gives a different order (ICU weights the "|"
 *  separator differently from the field boundary), which made every analysis
 *  fail with "connections array not deterministically sorted". */
function sortedComponents<T extends { id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.id.localeCompare(b.id));
}
function sortedConnections(list: Array<{ from: string; to: string; label: string }>) {
  const key = (c: { from: string; to: string; label: string }) => `${c.from}|${c.to}|${c.label}`;
  return [...list].sort((a, b) => key(a).localeCompare(key(b)));
}

/* ------------------------------------------------------------------ */
/* Tech stack detection                                               */
/* ------------------------------------------------------------------ */

const TECH_MAP: Array<{ category: keyof TechStack; matchers: RegExp[] }> = [
  {
    category: "frontend",
    matchers: [/^react$/, /^react-dom$/, /^vue$/, /^svelte$/, /^@angular\/core$/, /^next$/, /^nuxt$/, /^vite$/, /^tailwindcss$/, /^sass$/, /^webpack$/]
  },
  {
    category: "backend",
    matchers: [/^express$/, /^fastify$/, /^koa$/, /^@nestjs\/core$/, /^hapi$/, /^socket\.io$/, /^cors$/]
  },
  {
    category: "database",
    matchers: [/^mongoose$/, /^mongodb$/, /^pg$/, /^mysql2?$/, /^redis$/, /^prisma$/, /^@prisma\/client$/, /^sqlite3$/, /^sequelize$/, /^typeorm$/, /^knex$/]
  },
  {
    category: "authentication",
    matchers: [/^jsonwebtoken$/, /^jwt-simple$/, /^jose$/, /^passport/, /^bcrypt/, /^argon2$/, /^express-session$/, /^cookie-session$/, /^oauth/]
  },
  {
    category: "tooling",
    matchers: [/^(jest|vitest|mocha|chai|supertest)$/, /^(nodemon|tsx|ts-node)$/, /^(eslint|prettier)$/, /^(typescript|docker-compose)$/]
  }
];

function detectTechStack(m: ProjectMetadata): TechStack {
  const stack: TechStack = { languages: [], frontend: [], backend: [], database: [], authentication: [], tooling: [] };
  if (m.project.primaryLanguage) stack.languages.push(m.project.primaryLanguage);

  // dependencies AND observed package imports both count as stack signals
  const seen = new Set<string>();
  const names: string[] = [];
  const push = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };
  for (const d of Object.keys(m.dependencies)) push(d);
  for (const d of Object.keys(m.devDependencies)) push(d);
  for (const imp of m.imports) {
    if (imp.source.startsWith(".") || imp.source.startsWith("/")) continue;
    push(imp.source.startsWith("@") ? imp.source.split("/").slice(0, 2).join("/") : imp.source.split("/")[0]);
  }

  for (const name of names) {
    for (const rule of TECH_MAP) {
      if (rule.matchers.some((re) => re.test(name))) {
        const bucket = stack[rule.category];
        if (!bucket.includes(name)) bucket.push(name);
        break;
      }
    }
  }
  for (const key of Object.keys(stack) as Array<keyof TechStack>) {
    stack[key].sort();
  }
  if (!stack.languages.length) stack.languages.push("Unknown");
  return stack;
}

/* ------------------------------------------------------------------ */
/* Main builder                                                       */
/* ------------------------------------------------------------------ */

export interface PreviousAnalysisSnapshot {
  id: string;
  components: Array<{ id: string; files?: string[] }>;
  connections: Array<{ from: string; to: string }>;
}

const GRID_CELL = 26;

export function buildCityWorld(
  arch: Architecture,
  metadata: ProjectMetadata,
  previous?: PreviousAnalysisSnapshot | null,
  analyzedAt: Date = new Date()
): CityWorld {
  /* ---------- per-file lookup tables from parser facts ---------- */
  const fileMetaByPath = new Map<string, { bytes: number; lines: number }>();
  for (const f of metadata.files) fileMetaByPath.set(f.path, { bytes: f.bytes, lines: f.lines });

  const functionsByFile = new Map<string, string[]>();
  for (const fn of metadata.functions) {
    const list = functionsByFile.get(fn.file);
    const nm = fn.name === "anonymous" ? null : fn.name;
    if (!nm) continue;
    if (list) {
      if (!list.includes(nm) && list.length < 12) list.push(nm);
    } else {
      functionsByFile.set(fn.file, [nm]);
    }
  }

  // package imports per file (relative imports excluded)
  const pkgImportsByFile = new Map<string, Set<string>>();
  for (const imp of metadata.imports) {
    if (imp.source.startsWith(".") || imp.source.startsWith("/")) continue;
    const pkg = imp.source.startsWith("@") ? imp.source.split("/").slice(0, 2).join("/") : imp.source.split("/")[0];
    let set = pkgImportsByFile.get(imp.file);
    if (!set) {
      set = new Set();
      pkgImportsByFile.set(imp.file, set);
    }
    set.add(pkg);
  }

  const comps = sortedComponents(arch.components);

  /* ---------- degree + importance ---------- */
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const c of arch.connections) {
    outDeg.set(c.from, (outDeg.get(c.from) ?? 0) + 1);
    inDeg.set(c.to, (inDeg.get(c.to) ?? 0) + 1);
  }
  const fileCountOf = (id: string): number => arch.components.find((c) => c.id === id)?.files?.length ?? 0;
  const importanceOf = (id: string): number => {
    const deg = (outDeg.get(id) ?? 0) + (inDeg.get(id) ?? 0);
    return clamp(Math.round(1 + deg * 1.4 + Math.min(fileCountOf(id), 8) * 0.45), 1, 10);
  };

  /* ---------- districts ---------- */

  // group members per district first; bounds scale with member count so big
  // repos never spill outside a district (validation would reject that).
  const membersBySpec = new Map<string, typeof comps>();
  for (const spec of Object.values(DISTRICT_SPECS)) {
    const members = comps.filter((c) => districtKeyFor(c.type) === spec.id.replace("-district", ""));
    if (members.length) membersBySpec.set(spec.id, members);
  }
  const boundsFor = (n: number): { width: number; depth: number } => {
    const cols = Math.ceil(Math.sqrt(n));
    const span = Math.max(1, cols - 1) * GRID_CELL;
    const size = Math.max(DISTRICT_BOUNDS.width, span + GRID_CELL * 2);
    return { width: size, depth: size };
  };

const usedKeys = new Set(comps.map((c) => districtKeyFor(c.type)));
  const districts: District[] = Object.values(DISTRICT_SPECS)
    .filter((spec) => usedKeys.has(spec.id.replace("-district", "") as keyof typeof DISTRICT_SPECS))
    .map((spec) => ({
      id: spec.id,
      name: spec.name,
      position: { ...spec.slot },
      bounds: boundsFor(membersBySpec.get(spec.id)?.length ?? 1),
      color: spec.color
    }));

  // grid layout inside each district, centered, deterministic order.
  const positionById = new Map<string, Position3>();
  for (const spec of Object.values(DISTRICT_SPECS)) {
    const members = membersBySpec.get(spec.id);
    if (!members) continue;
    const cols = Math.ceil(Math.sqrt(members.length));
    members.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const rows = Math.ceil(members.length / cols);
      const x = spec.slot.x + (col - (cols - 1) / 2) * GRID_CELL;
      const z = spec.slot.z + (row - (rows - 1) / 2) * GRID_CELL;
      positionById.set(c.id, { x: r1(x), y: 0, z: r1(z) });
    });
  }

  /* ---------- components ---------- */
  const maxLines = Math.max(
    1,
    ...comps.map((c) => (c.files ?? []).reduce((sum, p) => sum + (fileMetaByPath.get(p)?.lines ?? 0), 0))
  );

  const cityComponents: CityComponent[] = comps.map((c) => {
    const files: FileMeta[] = (c.files ?? []).slice(0, 12).map((p) => ({
      path: p,
      size: fileMetaByPath.get(p)?.bytes ?? 0,
      lines: fileMetaByPath.get(p)?.lines ?? 0,
      functions: functionsByFile.get(p) ?? [],
      lastModified: null // GitHub commits API is too expensive for MVP
    }));
    const totalLines = (c.files ?? []).reduce((sum, p) => sum + (fileMetaByPath.get(p)?.lines ?? 0), 0);
    const n = (c.files ?? []).length;
    const importance = importanceOf(c.id);
    const width = r1(clamp(8 + n * 0.8, 8, 16));

    const compImports = new Set<string>();
    for (const p of c.files ?? []) {
      for (const pkg of pkgImportsByFile.get(p) ?? []) compImports.add(pkg);
    }

    return {
      id: c.id,
      name: c.name,
      type: c.type,
      description: c.description,
      district: DISTRICT_SPECS[districtKeyFor(c.type)].id,
      floor: 0,
      parent: null,
      children: [],
      belongsTo: [],
      position: positionById.get(c.id) ?? { x: 0, y: 0, z: 0 },
      size: { width, height: r1(clamp(10 + importance * 2.2, 10, 34)), depth: width },
      visual: {
        primaryColor: GLOW_BY_TYPE[c.type] ?? GLOW_BY_TYPE.other,
        glowColor: GLOW_BY_TYPE[c.type] ?? GLOW_BY_TYPE.other,
        buildingStyle: BUILDING_STYLE[c.type] ?? "lowrise",
        importance,
        complexity: totalLines > 0 ? clamp(5 + Math.round((totalLines / maxLines) * 90), 5, 95) : 5
      },
      files,
      metrics: { requestCount: 0, avgLatencyMs: 0, errorRate: 0, lastActivity: null, health: "healthy" },
      dependencies: { imports: [...compImports].sort(), uses: [] }
    };
  });

  /* ---------- connections ---------- */
  const connTypeOf = new Map<string, ConnectionType>();
  const cityConnections: CityConnection[] = sortedConnections(
    arch.connections.map((c) => ({ from: c.from, to: c.to, label: c.label ?? "uses" }))
  ).map((c, i) => {
    const type = classifyConnection(c.label);
    connTypeOf.set(`${c.from}->${c.to}`, type);
    const fromPos = positionById.get(c.from) ?? { x: 0, y: 0, z: 0 };
    const toPos = positionById.get(c.to) ?? { x: 0, y: 0, z: 0 };
    const sameDistrict =
      districtKeyFor(comps.find((x) => x.id === c.from)?.type ?? "other") ===
      districtKeyFor(comps.find((x) => x.id === c.to)?.type ?? "other");
    const elevation: CityConnection["elevation"] = sameDistrict ? "ground" : "bridge";

    // curved road hint: midpoint lifted, pushed sideways perpendicular to XZ dir
    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const lift = elevation === "bridge" ? 18 : 4;
    const bow = Math.min(len * 0.15, 20);
    const mid: Position3 = {
      x: r1((fromPos.x + toPos.x) / 2 + nx * bow),
      y: lift,
      z: r1((fromPos.z + toPos.z) / 2 + nz * bow)
    };

    const weightBase: Record<ConnectionType, number> = {
      http: 60,
      storage: 55,
      "auth-flow": 50,
      "external-api": 45,
      internal: 40,
      dependency: 30
    };
    const weight = clamp(weightBase[type] + 8 * Math.min(outDeg.get(c.from) ?? 0, 3), 20, 95);
    const trafficVolume: TrafficVolume = weight >= 70 ? "high" : weight >= 45 ? "medium" : "low";

    return {
      id: `conn-${String(i + 1).padStart(3, "0")}`,
      from: c.from,
      to: c.to,
      label: c.label,
      type,
      direction: type === "http" || type === "external-api" ? "bidirectional" : "unidirectional",
      weight,
      trafficVolume,
      protocol: CONN_PROTOCOL[type],
      latencyMs: 0, // runtime telemetry not available yet
      status: "healthy",
      path: [{ ...fromPos }, mid, { ...toPos }],
      pathType: "curved",
      elevation,
      visual: {
        color: CONN_COLOR[type],
        width: trafficVolume === "high" ? 4 : trafficVolume === "medium" ? 3 : 2,
        glowIntensity: trafficVolume === "high" ? 0.9 : trafficVolume === "medium" ? 0.65 : 0.4
      }
    };
  });

  // fill component.dependencies.uses from outgoing edges
  const compById = new Map(cityComponents.map((c) => [c.id, c]));
  for (const conn of cityConnections) {
    const fromComp = compById.get(conn.from);
    if (fromComp && !fromComp.dependencies.uses.includes(conn.to)) {
      fromComp.dependencies.uses.push(conn.to);
    }
  }
  for (const c of cityComponents) c.dependencies.uses.sort();

  /* ---------- npm dependency graph ---------- */
  const runtime: RuntimeDependency[] = Object.entries(metadata.dependencies)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 60)
    .map(([name, version]) => ({
      name,
      version,
      usedBy: cityComponents.filter((c) => c.dependencies.imports.includes(name)).map((c) => c.id),
      hasVulnerabilities: false, // no audit API call in MVP
      lastUpdated: null
    }));

  /* ---------- changes vs previous run ---------- */
  const changes: CityWorld["changes"] = previous
    ? computeChanges(cityComponents, cityConnections, previous, analyzedAt)
    : {
        lastAnalyzed: analyzedAt.toISOString(),
        filesChanged: 0,
        componentsAffected: [],
        newConnections: 0,
        removedConnections: 0,
        previousAnalysisId: null
      };

  const world: CityWorld = {
    districts,
    architecture: { components: cityComponents, connections: cityConnections },
    dependencies: { runtime, dev: Object.keys(metadata.devDependencies).sort().slice(0, 40) },
    techStack: detectTechStack(metadata),
    changes
  };

  assertCityWorld(world);
  return world;
}

/** Diffes the current world against a previous analysis snapshot. */
function computeChanges(
  cityComponents: CityComponent[],
  cityConnections: CityConnection[],
  previous: PreviousAnalysisSnapshot,
  analyzedAt: Date
): CityWorld["changes"] {
  const prevCompIds = new Set(previous.components.map((c) => c.id));
  const nextCompIds = new Set(cityComponents.map((c) => c.id));
  const prevConnKeys = new Set(previous.connections.map((c) => `${c.from}->${c.to}`));
  const nextConnKeys = new Set(cityConnections.map((c) => `${c.from}->${c.to}`));

  const affected = new Set<string>();
  for (const id of nextCompIds) if (!prevCompIds.has(id)) affected.add(id);
  for (const id of prevCompIds) if (!nextCompIds.has(id)) affected.add(id);
  let filesChanged = affected.size;
  const prevFilesById = new Map(previous.components.map((c) => [c.id, [...(c.files ?? [])].sort()]));
  for (const c of cityComponents) {
    if (!prevFilesById.has(c.id)) continue;
    const before = prevFilesById.get(c.id)!;
    const after = c.files.map((f) => f.path).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      filesChanged++;
      affected.add(c.id);
    }
  }

  return {
    lastAnalyzed: analyzedAt.toISOString(),
    filesChanged,
    componentsAffected: [...affected].sort(),
    newConnections: [...nextConnKeys].filter((k) => !prevConnKeys.has(k)).length,
    removedConnections: [...prevConnKeys].filter((k) => !nextConnKeys.has(k)).length,
    previousAnalysisId: previous.id
  };
}

/* ------------------------------------------------------------------ */
/* Validation (spec rules)                                            */
/* ------------------------------------------------------------------ */

export function assertCityWorld(world: CityWorld): void {
  const problems: string[] = [];
  const byId = new Map(world.architecture.components.map((c) => [c.id, c]));

  for (const d of world.districts) {
    const specId = d.id.replace("-district", "");
    const spec = DISTRICT_SPECS[specId];
    if (spec && (d.position.x !== spec.slot.x || d.position.z !== spec.slot.z || d.color !== spec.color)) {
      problems.push(`district ${d.id} deviates from canonical slot`);
    }
  }

  for (const c of world.architecture.components) {
    if (!c.id || !c.name || !c.type) problems.push(`component missing identity: ${c.id}`);
    if (!c.position || !c.district || !c.size) problems.push(`component ${c.id} missing position/district/size`);
    if (!world.districts.some((d) => d.id === c.district)) {
      problems.push(`component ${c.id} references unknown district ${c.district}`);
    }
    const d = world.districts.find((x) => x.id === c.district);
    if (d && c.position) {
      const withinX = Math.abs(c.position.x - d.position.x) <= d.bounds.width / 2;
      const withinZ = Math.abs(c.position.z - d.position.z) <= d.bounds.depth / 2;
      if (!withinX || !withinZ) problems.push(`component ${c.id} outside district bounds`);
    }
  }

  // AABB overlap check inside each district
  for (const d of world.districts) {
    const members = world.architecture.components.filter((c) => c.district === d.id);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        const overlapX = Math.abs(a.position.x - b.position.x) < (a.size.width + b.size.width) / 2;
        const overlapZ = Math.abs(a.position.z - b.position.z) < (a.size.depth + b.size.depth) / 2;
        if (overlapX && overlapZ) problems.push(`components ${a.id} and ${b.id} overlap`);
      }
    }
  }

  for (const conn of world.architecture.connections) {
    if (!byId.has(conn.from)) problems.push(`connection ${conn.id}: unknown 'from' ${conn.from}`);
    if (!byId.has(conn.to)) problems.push(`connection ${conn.id}: unknown 'to' ${conn.to}`);
    const from = byId.get(conn.from);
    const to = byId.get(conn.to);
    const start = conn.path[0];
    const end = conn.path[conn.path.length - 1];
    if (from && start && (start.x !== from.position.x || start.z !== from.position.z)) {
      problems.push(`connection ${conn.id} path does not start at from.position`);
    }
    if (to && end && (end.x !== to.position.x || end.z !== to.position.z)) {
      problems.push(`connection ${conn.id} path does not end at to.position`);
    }
  }

  const compIds = world.architecture.components.map((c) => c.id);
  const connKeys = world.architecture.connections.map((c) => `${c.from}|${c.to}|${c.label}`);
  if (!isSortedStrings(compIds)) problems.push("components array not deterministically sorted");
  if (!isSortedStrings(connKeys)) problems.push("connections array not deterministically sorted");

  if (problems.length) {
    throw ApiError.internal("City world validation failed", { problems: problems.slice(0, 20) });
  }
}

function isSortedStrings(list: string[]): boolean {
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].localeCompare(list[i]) > 0) return false;
  }
  return true;
}

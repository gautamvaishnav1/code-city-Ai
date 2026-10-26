/**
 * LAYOUT INVARIANTS — the regression net for "the city reads as a systematic map".
 *
 *   run:  ..\Backend\node_modules\.bin\tsx.cmd scripts\assert-layout.ts
 *
 * There is no test runner in this repo, so this script asserts the geometry
 * rules that were the actual bugs — against BOTH a small city and a big one
 * (16-building backend district, which is what the Beach Resort demo produces):
 *
 *   1. every building clears every road by >= 1 m (visible sidewalk gap)
 *   2. buildings inside a district never overlap (gap between buildings)
 *   3. no district plinth covers ASPHALT (the plinth used to bury the ring
 *      roads, the z=-8 trunk and both database ramps — cars drove into it)
 *   4. every car waypoint sits on a drivable surface (never across a lawn)
 *   5. the bridge profile is applied without backtracking (cars used to
 *      reverse 3.4 u at each ramp and drive into the ramp slab)
 *   6. architectureToCity never drops a component and never keeps a dangling edge
 *
 * Exits non-zero when any assertion fails.
 */
import {
  BRIDGE,
  FOOTPRINT,
  ROAD_Y,
  buildLayout,
  withRiverCrossing,
  type CityLayout,
  type RoadSeg,
  type Waypoint,
} from "../src/lib/layout";
import { architectureToCity } from "../src/lib/city";
import type { CityJSON, Kind, Stack } from "../src/types";

const failures: string[] = [];
const notes: string[] = [];
const check = (cond: boolean, msg: string) => {
  if (!cond) failures.push(msg);
};

const distToSeg = (
  px: number,
  pz: number,
  a: [number, number],
  b: [number, number],
): number => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
};

const district = (id: string, name: string, stack: Stack, kinds: Kind[]) => ({
  id,
  name,
  stack,
  buildings: kinds.map((k, i) => ({
    id: `${id}-${i}`,
    name: `${k} ${i}`,
    kind: k,
    loc: 120 + i * 40,
    health: "ok" as const,
    functions: [],
  })),
});

const rep = <T>(n: number, maker: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => maker(i));

/* ── the demo-shaped city: 4 districts, 3-column grids, a database row ────── */
const smallCity: CityJSON = {
  project: { name: "layout-assert", stack: "typescript" },
  districts: [
    district("frontend-district", "Frontend District", "frontend", [
      "page", "page", "page", "component", "component", "context",
    ]),
    district("backend-district", "Backend District", "backend", [
      "route", "route", "controller", "controller", "service", "service", "middleware",
    ]),
    district("data-district", "Data District", "database", rep(5, () => "model" as Kind)),
    district("external-district", "External District", "external", ["api", "api"]),
  ],
  edges: [],
  flows: {},
};

/* ── a BIG city: 16 backend buildings = six grid rows (the demo's real shape) */
const bigCity: CityJSON = {
  project: { name: "layout-assert-big", stack: "typescript" },
  districts: [
    district("frontend-district", "Frontend District", "frontend", [
      "page", "page", "page", "component", "component", "context",
      "page", "page", "component", "context",
    ]),
    district("backend-district", "Backend District", "backend", [
      "route", "route", "route", "route",
      "controller", "controller", "controller", "controller",
      "service", "service", "service", "service",
      "middleware", "auth", "config", "controller",
    ]),
    district("data-district", "Data District", "database", rep(5, () => "model" as Kind)),
  ],
  edges: [],
  flows: {},
};

/* ══ 1-5 · geometry, per fixture ═══════════════════════════════════════════ */
function geometry(label: string, city: CityJSON): CityLayout {
  const L: CityLayout = buildLayout(city);
  const tag = (m: string) => `${label}: ${m}`;

  /* ── 1 · building ↔ road clearance ─────────────────────────────────────── */
  {
    let minGap = Infinity;
    let worst = "";
    for (const b of L.buildings) {
      const half = FOOTPRINT[b.kind] / 2;
      for (const r of L.roads) {
        const gap = distToSeg(b.pos[0], b.pos[2], r.a, r.b) - r.w / 2 - half;
        if (gap < minGap) { minGap = gap; worst = `${b.id} vs [${r.a} → ${r.b}]`; }
      }
    }
    check(minGap >= 0.95, tag(`building is too close to a road: min gap ${minGap.toFixed(2)} u (${worst})`));
    notes.push(`${label} building ↔ road gap   ${minGap.toFixed(2)} u (min 1.0 required)`);
  }

  /* ── 2 · building ↔ building gap inside a district ─────────────────────── */
  {
    let minGap = Infinity;
    let worst = "";
    for (let i = 0; i < L.buildings.length; i++) {
      for (let j = i + 1; j < L.buildings.length; j++) {
        const a = L.buildings[i], b = L.buildings[j];
        if (a.districtId !== b.districtId) continue;
        const ax = FOOTPRINT[a.kind] / 2, bx = FOOTPRINT[b.kind] / 2;
        const gx = Math.abs(a.pos[0] - b.pos[0]) - ax - bx;
        const gz = Math.abs(a.pos[2] - b.pos[2]) - ax - bx;
        if (gx <= 0 && gz <= 0) { minGap = -1; worst = `${a.id}/${b.id}`; continue; }
        if (gx > 0 && gz > 0) continue; // diagonal — not touching
        const gap = Math.max(gx, gz);
        if (gap < minGap) { minGap = gap; worst = `${a.id}/${b.id}`; }
      }
    }
    check(minGap > 0, tag(`two buildings touch or overlap (gap ${minGap.toFixed(2)} u, ${worst})`));
    notes.push(`${label} building ↔ building   ${minGap > 0 ? minGap.toFixed(2) : "OVERLAP"} u (${worst})`);
  }

  /* ── 3 · no plinth covers ASPHALT (whole road area, not just the line) ── */
  {
    const offenders: string[] = [];
    for (const d of L.districts) {
      if (!d.slabs || d.slabs.length === 0) { offenders.push(`${d.id}: no slab computed`); continue; }
      for (const [ox, oz, sw, sd] of d.slabs) {
        const x0 = d.center[0] + ox, x1 = x0 + sw;
        const z0 = d.center[1] + oz, z1 = z0 + sd;
        for (const r of L.roads) {
          const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
          const steps = Math.max(2, Math.ceil(len / 0.4));
          const dx = (r.b[0] - r.a[0]) / (len || 1);
          const dz = (r.b[1] - r.a[1]) / (len || 1);
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const cx = r.a[0] + (r.b[0] - r.a[0]) * t;
            const cz = r.a[1] + (r.b[1] - r.a[1]) * t;
            for (const off of [-0.4, 0, 0.4]) {
              const px = cx + -dz * off * r.w;
              const pz = cz + dx * off * r.w;
              if (px > x0 + 0.02 && px < x1 - 0.02 && pz > z0 + 0.02 && pz < z1 - 0.02) {
                offenders.push(`${d.id} pad [${sw.toFixed(1)}×${sd.toFixed(1)}] buries asphalt of [${r.a} → ${r.b}] at (${px.toFixed(1)}, ${pz.toFixed(1)})`);
                s = steps + 1;
                break;
              }
            }
          }
        }
      }
    }
    check(offenders.length === 0, tag(`plinth covers asphalt:\n    ${offenders.slice(0, 6).join("\n    ")}`));
    notes.push(`${label} plinth ↔ asphalt      ${offenders.length === 0 ? "clear" : `${offenders.length} collision(s)`}`);
    // the split itself is part of the design — report it
    const splits = L.districts.filter((d) => (d.slabs?.length ?? 0) > 1);
    if (splits.length) notes.push(`${label} plinth split by roads  ${splits.map((d) => `${d.id}×${d.slabs!.length}`).join(", ")}`);
  }

  /* ── 4 · every car waypoint is on a drivable surface ───────────────────── */
  {
    const drivable: RoadSeg[] = [...L.roads, { a: [-BRIDGE.halfSpan, BRIDGE.axisZ], b: [BRIDGE.halfSpan, BRIDGE.axisZ], w: 6.4, kind: "bridge" }];
    const lanes = Object.entries(L.flowPaths);
    check(lanes.length > 0, tag("no demo street lanes were built — ambient traffic would be empty"));
    let worst = -Infinity;
    let worstAt = "";
    for (const [name, pts] of lanes) {
      check(pts.length >= 2, tag(`lane "${name}" has fewer than 2 waypoints`));
      for (const [x, , z] of pts) {
        let clearance = Infinity;
        for (const r of drivable) clearance = Math.min(clearance, distToSeg(x, z, r.a, r.b) - r.w / 2);
        if (clearance > worst) { worst = clearance; worstAt = `${name} @ (${x.toFixed(1)}, ${z.toFixed(1)})`; }
      }
    }
    check(worst <= 0.6, tag(`a car waypoint is off the road by ${worst.toFixed(2)} u (${worstAt})`));
    notes.push(`${label} car waypoint ↔ road   worst ${worst.toFixed(2)} u (<= 0.6 allowed) · ${lanes.length} lanes`);
  }

  return L;
}

/* ══ 5 · bridge profile: no backtracking, correct deck height ══════════════ */
{
  const deckY = BRIDGE.deckTop + 0.06;
  const east: Waypoint[] = [[-42, ROAD_Y, -8], [-6, ROAD_Y, -8], [6, ROAD_Y, -8], [42, ROAD_Y, -8]];
  const west: Waypoint[] = [...east].reverse();

  for (const [label, raw] of [["eastbound", east], ["westbound", west]] as const) {
    const out = withRiverCrossing(raw);
    const sign = label === "eastbound" ? 1 : -1;
    let prev = -Infinity;
    let monotonic = true;
    for (const [x] of out) {
      const v = sign * x;
      if (v < prev - 1e-6) monotonic = false;
      prev = Math.max(prev, v);
    }
    check(monotonic, `${label} lane backtracks across the bridge: ${out.map((p) => p[0].toFixed(1)).join(" → ")}`);

    for (const [x, y, z] of out) {
      if (Math.abs(z - BRIDGE.axisZ) > 1.5 || Math.abs(x) > BRIDGE.halfSpan + BRIDGE.rampRun) continue;
      const ax = Math.abs(x);
      const want =
        ax <= BRIDGE.halfSpan
          ? deckY
          : ROAD_Y + ((BRIDGE.halfSpan + BRIDGE.rampRun - ax) / BRIDGE.rampRun) * (deckY - ROAD_Y);
      check(Math.abs(y - want) < 1e-6, `lane y=${y.toFixed(3)} at x=${x.toFixed(2)}, expected ${want.toFixed(3)}`);
    }
  }

  const preSplit: Waypoint[] = [
    [-11, ROAD_Y, -8], [-6.2, ROAD_Y, -8], [6.2, ROAD_Y, -8], [11, ROAD_Y, -8],
  ];
  const out = withRiverCrossing(preSplit);
  check(out.length === 6, `pre-split bridge lane grew to ${out.length} points (expected 6: ramp feet inserted once)`);
  check(out.some((p) => Math.abs(p[0] - -9.6) < 1e-6) && out.some((p) => Math.abs(p[0] - 9.6) < 1e-6),
    "ramp feet missing on a pre-split bridge lane");
  check(out.filter((p) => Math.abs(Math.abs(p[0]) - BRIDGE.halfSpan) < 1e-6 && Math.abs(p[1] - deckY) < 1e-6).length === 2,
    "deck nodes were not lifted onto the deck height");
}

/* ══ 6 · architectureToCity never loses a component, never keeps a ghost edge */
{
  const payload = {
    analysisId: "a",
    projectId: "p",
    repoInfo: { fullName: "acme/app" },
    architecture: {
      components: [
        { id: "login-page", name: "Login page", type: "page", district: "frontend-district", files: [] },
        { id: "weird", name: "Legacy widget", type: "view", district: "does-not-exist" },
        { id: "users", name: "Users model", type: "db", district: "data-district", files: [] },
      ],
      connections: [
        { id: "c1", from: "login-page", to: "users", type: "http" },
        { id: "c2", from: "login-page", to: "ghost-building", type: "import" },
      ],
    },
    districts: [
      { id: "frontend-district", name: "Frontend District" },
      { id: "data-district", name: "Data District" },
    ],
  };
  const c = architectureToCity(payload as never);
  const ids = c.districts.flatMap((d) => d.buildings.map((b) => b.id));
  check(ids.includes("weird"), "a component whose district id was unknown VANISHED from the city");
  check(c.districts.find((d) => d.buildings.some((b) => b.id === "weird"))?.stack === "frontend",
    "recovered component did not land on a frontend street");
  check(ids.includes("login-page"), "page component missing");
  const page = c.districts.flatMap((d) => d.buildings).find((b) => b.id === "login-page");
  check(page?.kind === "page", `type "page" should render as a page building, got ${page?.kind}`);
  const model = c.districts.flatMap((d) => d.buildings).find((b) => b.id === "users");
  check(model?.kind === "model", `type "db" should render as a model building, got ${model?.kind}`);
  check(!c.edges.some((e) => e.to === "ghost-building"), "a dangling edge survived — it renders as a dead arc");
  check(c.edges.length === 1, `expected 1 surviving edge, got ${c.edges.length}`);
}

/* ══ run both fixtures ═════════════════════════════════════════════════════ */
const small = geometry("small", smallCity);
const big = geometry("big", bigCity);

/* ══ report ════════════════════════════════════════════════════════════════ */
for (const n of notes) console.log(`  ${n}`);
if (failures.length) {
  console.error(`\n✗ ${failures.length} layout assertion(s) failed:`);
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}
console.log(
  `\n✓ all layout assertions passed — small: ${small.buildings.length} buildings / ${small.roads.length} roads / ${Object.keys(small.flowPaths).length} lanes · big: ${big.buildings.length} buildings / ${big.roads.length} roads / ${Object.keys(big.flowPaths).length} lanes`,
);

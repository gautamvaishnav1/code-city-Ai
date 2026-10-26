import type { CityJSON, Stack, Kind, BuildingNode, DistrictNode } from "../types";

export interface LaidBuilding extends BuildingNode {
  pos: [number, number, number];
  h: number;
  color: string;
  stack: Stack;
  districtId: string;
  districtName: string;
}
export interface LaidDistrict extends DistrictNode {
  center: [number, number];
  /** ring road half-extents — derived from the district's own content */
  ringR: number;
  ringD: number;
  /** ground slab size (x, z). Derived from the FINAL building positions so
   *  the plinth always stops at the road's inner edge — computed in
   *  buildLayout's slab pass, never hand-tuned. */
  slab?: [number, number];
  /** the plinth SPLIT into renderable rectangles (x, z offset from the
   *  district centre, then width, depth). Any road crossing the district
   *  interior is subtracted, so an arterial can never be buried under the
   *  0.5 m-tall pad (cars would drive through solid ground). */
  slabs?: [number, number, number, number][];
}
export interface RoadSeg {
  a: [number, number];
  b: [number, number];
  w: number;
  kind: "road" | "highway" | "bridge";
}
export interface Dash {
  p: [number, number];
  rot: number;
  /** arterial dashes are chunky; street/ring dashes render thinner + dimmer */
  size: "arterial" | "street";
}
/** one zebra stripe of a crosswalk (gate stubs get five) */
export interface Crossing { p: [number, number]; rot: number }
/** 3D waypoint chain (x, y, z) a car follows; y lifts it onto the bridge deck. */
export type Waypoint = [number, number, number];
/** the JWT toll plaza on the western approach to the bridge */
export interface TollInfo { x: number; z: number; lanes: readonly number[] }
export interface CityLayout {
  buildings: LaidBuilding[];
  districts: LaidDistrict[];
  roads: RoadSeg[];
  bridges: number[];
  trees: [number, number][];
  lamps: [number, number][];
  people: { a: [number, number]; b: [number, number] }[];
  pipes: RoadSeg[];
  dashes: Dash[];
  crossings: Crossing[];
  flowPaths: Record<string, Waypoint[]>;
  byId: Map<string, LaidBuilding>;
  toll: TollInfo;
}

export const KIND_COLOR: Record<Kind, string> = {
  page: "#38bdf8",
  component: "#7dd3fc",
  context: "#818cf8",
  route: "#fbbf24",
  controller: "#fb923c",
  service: "#f472b6",
  middleware: "#facc15",
  model: "#34d399",
  api: "#22d3ee",
};

/**
 * World footprint (width/depth) per building kind — THE single source of truth
 * for both the renderer and the layout maths, so a lot can never be smaller
 * than the building standing on it.
 *
 * Sizing rule (the "you can see which building connects to which" requirement):
 *   • grid columns are 6.5 apart  → widest lot 3.8 leaves a 2.7 u alley
 *   • grid rows are 7 apart       → 3.2 u between facing walls
 *   • lot edge → ring road        → 1.35 u of visible sidewalk before the kerb
 */
export const FOOTPRINT: Record<Kind, number> = {
  page: 3.4,
  component: 3.4,
  context: 3.6,
  route: 3,
  controller: 3.6,
  service: 3.6,
  middleware: 3,
  model: 3.8,
  api: 2.8,
};
/** half of the widest lot — used by the overlap / road-clearance passes */
export const FOOTPRINT_HALF = 1.9;

/** district identity — name the stack from across the river */
export const STACK_ACCENT: Record<Stack, string> = {
  frontend: "#22d3ee",
  backend: "#f59e0b",
  database: "#34d399",
  external: "#a78bfa",
};

const ZONE: Record<Stack, [number, number]> = {
  frontend: [-42, -8],
  backend: [42, -8],
  database: [0, 56],
  external: [0, 94],
};

const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ─── lane helpers ────────────────────────────────────────────────────────────
export const ROAD_Y = 0.18;
/** Metres of visible ground kept between a building wall and the kerb — the
 *  "you can see which building connects to which" gap. Used by the grid, the
 *  ring fit AND the road-clearance pass so all three agree. */
export const SIDEWALK = 1.0;
/** half-width of a ring road (every ring road is w = 2.5) */
const ROAD_RING_HALF = 1.25;
/** Bridge profile — THE single source of truth. Infrastructure.tsx builds the
 *  slabs from these numbers and the lanes ride them, so geometry and traffic
 *  can never drift apart again (that drift was the "cars jump at the bridge"
 *  bug: lanes climbed to y=1.54 in 2 world units while the ramps tilted the
 *  wrong way, and Traffic added a 0.35 hover lift on top). */
export const BRIDGE = {
  deckTop: 0.55,   // walkable/drivable surface of the main span
  halfSpan: 6.2,   // deck runs -6.2..6.2 across the river (water is |x|<5)
  rampRun: 3.4,    // horizontal run of each approach ramp (6.2 → 9.6)
  approachY: ROAD_Y,
  /** the trunk road the bridge carries — every crossing rides this axis */
  axisZ: -8,
} as const;
/** half-width of the trunk road the bridge carries (5 m wide). A district
 *  ring must stay TRUNK_HALF + a sidewalk clear of that axis — an arterial
 *  inside the district pushes its building rows off the kerb and into
 *  each other. */
const TRUNK_HALF = 2.5;
/** right-hand-traffic: shift every leg of the polyline sideways by `off` */
function lane(pts: Waypoint[], off = 0.75): Waypoint[] {  const rights: [number, number][] = [];
  const shifted: Waypoint[][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    // right-hand normal in XZ
    rights.push([(-dz / len) * off, (dx / len) * off]);
    shifted.push([
      [a[0] + rights[i][0], a[1], a[2] + rights[i][1]],
      [b[0] + rights[i][0], b[1], b[2] + rights[i][1]],
    ]);
  }
  // miter join: intersect consecutive offset legs so corners stay sharp
  const out: Waypoint[] = [shifted[0][0]];
  for (let i = 1; i < shifted.length; i++) {
    const [p0, p1] = shifted[i - 1];
    const [q0, q1] = shifted[i];
    const d1x = p1[0] - p0[0], d1z = p1[2] - p0[2];
    const d2x = q1[0] - q0[0], d2z = q1[2] - q0[2];
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-6) {
      out.push([p1[0], p1[1], p1[2]]); // parallel legs — plain midpoint
    } else {
      const tt = ((q0[0] - p0[0]) * d2z - (q0[2] - p0[2]) * d2x) / den;
      out.push([p0[0] + d1x * tt, p1[1], p0[2] + d1z * tt]);
    }
  }
  out.push(shifted[shifted.length - 1][1]);
  return out;
}
export { lane as offsetLane };

/** Post-process a lane so any leg crossing the river rides the bridge deck
 *  instead of ploughing through the water.
 *
 *  This REWRITES the crossing leg rather than appending a ramp profile after
 *  it. The old version pushed `p` and then inserted the four ramp/deck points,
 *  so a road-routed lane — which already contains the deck edge as a real
 *  graph edge — backtracked 3.4 u at each ramp end: cars visibly reversed,
 *  then drove down INTO the ramp slab. Waypoints inside the crossing zone are
 *  now lifted onto the ramp profile and a waypoint is dropped exactly where a
 *  leg enters/leaves it, keeping the polyline monotonic. */
export function withRiverCrossing(pts: Waypoint[]): Waypoint[] {
  const foot = BRIDGE.halfSpan + BRIDGE.rampRun;           // ±9.6 — ramp meets the road
  const deckY = BRIDGE.deckTop + 0.06;                     // deck + wheel clearance
  const halfW = Math.abs(foot) + 1e-9;
  const zLo = BRIDGE.axisZ - 1.5, zHi = BRIDGE.axisZ + 1.5; // 3 u wide crossing corridor

  /** lane y for a point inside the crossing corridor, else null (ground level) */
  const zoneY = (x: number, z: number): number | null => {
    if (z < zLo || z > zHi) return null;
    const ax = Math.abs(x);
    if (ax > halfW) return null;
    if (ax <= BRIDGE.halfSpan) return deckY;
    const t = (halfW - ax) / (halfW - BRIDGE.halfSpan); // 0 at the ramp foot, 1 at the deck
    return BRIDGE.approachY + (deckY - BRIDGE.approachY) * t;
  };

  /** x positions where the profile changes grade — every leg crossing the
   *  corridor is split at these, so the ramp always starts exactly on the
   *  ramp slab whatever shape the incoming lane has. */
  const BREAKS = [-foot, -BRIDGE.halfSpan, BRIDGE.halfSpan, foot];

  const out: Waypoint[] = [];
  const emit = (x: number, y: number, z: number) => {
    const zy = zoneY(x, z);
    out.push([x, zy ?? y, z]);
  };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    emit(p[0], p[1], p[2]);
    if (!q) break;

    const dx = q[0] - p[0], dz = q[2] - p[2];
    const ts = new Set<number>();
    const split = (target: number, d: number, o: number) => {
      if (Math.abs(d) < 1e-9) return;
      const t = (target - o) / d;
      if (t > 1e-4 && t < 1 - 1e-4) ts.add(t);
    };
    for (const x of BREAKS) split(x, dx, p[0]);
    split(zLo, dz, p[2]);
    split(zHi, dz, p[2]);

    for (const t of [...ts].sort((a, b) => a - b)) {
      const x = p[0] + dx * t;
      const z = p[2] + dz * t;
      if (zoneY(x, z) === null) continue; // outside the crossing corridor
      emit(x, p[1] + (q[1] - p[1]) * t, z);
    }
  }
  return out;
}

export function buildLayout(city: CityJSON): CityLayout {
  const rnd = mulberry(1337);
  const buildings: LaidBuilding[] = [];
  const districts: LaidDistrict[] = [];
  const roads: RoadSeg[] = [];
  const trees: [number, number][] = [];
  const lamps: [number, number][] = [];
  const people: { a: [number, number]; b: [number, number] }[] = [];
  const pipes: RoadSeg[] = [];
  const dashes: Dash[] = [];
  const crossings: Crossing[] = [];
  const counters: Record<string, number> = {};
  /** depth already claimed north of the trunk, per stack (row ≥ 1 districts) */
  const northDepth: Partial<Record<Stack, number>> = {};

  city.districts.forEach((d) => {
    const [zx, zz] = ZONE[d.stack];
    const i = (counters[d.stack] = (counters[d.stack] ?? -1) + 1);
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = d.stack === "database" || d.stack === "external" ? zx : zx + (col - 0.5) * 26;

    // ── fit the ring road to the content (was a fixed R11/D9 rectangle that
    //    the 7th+ building spilled out of). Grid is CENTERED so overflow is
    //    symmetric and the ring can grow around it.
    //    The ring is derived from the grid's REAL extent plus one full
    //    sidewalk's worth of clearance: a district with 16 buildings needs six
    //    rows, and the old hard cap (ringD ≤ 13) left rows 5+ standing ON —
    //    or outside — the ring road, after which the clearance pass piled them
    //    on top of each other.
    const n = d.buildings.length;
    const rows = d.stack === "database" ? 1 : Math.ceil(n / 3);
    const cols = 3;
    const ringR = Math.max(
      11,
      ((cols - 1) / 2) * 6.5 + FOOTPRINT_HALF + SIDEWALK + ROAD_RING_HALF,
    );
    const ringD =
      d.stack === "database"
        ? 9
        : Math.max(9, ((rows - 1) / 2) * 7 + FOOTPRINT_HALF + SIDEWALK + ROAD_RING_HALF);

    // ── north/south anchor. ZONE.frontend/backend sit ON the trunk road
    //    (z = BRIDGE.axisZ, 5 m wide) — a ring whose interior swallows that
    //    arterial forces the clearance pass to shove its building rows apart,
    //    and the rows then collide with each other (0.2 u gaps in the big
    //    fixture). Each district is therefore planted a kerb + sidewalk AWAY
    //    from the trunk, on the side its row belongs to.
    let cz: number;
    if (d.stack === "database" || d.stack === "external") {
      cz = zz;
    } else if (row === 0) {
      cz = zz - TRUNK_HALF - SIDEWALK - ringD;
    } else {
      const prev = northDepth[d.stack] ?? 0;
      cz = zz + TRUNK_HALF + SIDEWALK + ringD + prev;
      northDepth[d.stack] = prev + ringD * 2 + 4;
    }

    districts.push({ ...d, center: [cx, cz], ringR, ringD });

    d.buildings.forEach((b, bi) => {
      let x: number, z: number;
      if (d.stack === "database") {
        // single front row of collections. Spacing is capped so the row always
        // fits INSIDE the platform: the slab may reach x ±19.4 (wider and it
        // swallows the ramp whose foot sits at x≈19.9), which leaves a 15.7 u
        // half-span for the row itself before the 1.9 u half-lot.
        const step = n > 1 ? Math.max(4.4, Math.min(8, 31.4 / (n - 1))) : 0;
        x = (bi - (n - 1) / 2) * step;
        z = 0;
      } else {
        const rows = Math.ceil(n / 3);
        x = ((bi % 3) - 1) * 6.5;
        z = (Math.floor(bi / 3) - (rows - 1) / 2) * 7; // centered rows
      }
      // height budget: no single file towers over its whole district
      const hCap = 1.2 * Math.min(ringR, ringD);
      const h = Math.min(2 + Math.min(9, b.loc / 25), hCap);
      buildings.push({
        ...b,
        pos: [cx + x, 0, cz + z],
        h,
        color: KIND_COLOR[b.kind],
        stack: d.stack,
        districtId: d.id,
        districtName: d.name,
      });
    });

    if (d.stack !== "database") {
      const R = ringR, D = ringD;
      roads.push(
        { a: [cx - R, cz - D], b: [cx + R, cz - D], w: 2.5, kind: "road" },
        { a: [cx - R, cz + D], b: [cx + R, cz + D], w: 2.5, kind: "road" },
        { a: [cx - R, cz - D], b: [cx - R, cz + D], w: 2.5, kind: "road" },
        { a: [cx + R, cz - D], b: [cx + R, cz + D], w: 2.5, kind: "road" },
      );
      // thinner street markings so ring roads read as drivable
      for (const seg of [
        { a: [cx - R, cz - D] as [number, number], b: [cx + R, cz - D] as [number, number] },
        { a: [cx - R, cz + D] as [number, number], b: [cx + R, cz + D] as [number, number] },
        { a: [cx - R, cz - D] as [number, number], b: [cx - R, cz + D] as [number, number] },
        { a: [cx + R, cz - D] as [number, number], b: [cx + R, cz + D] as [number, number] },
      ]) {
        const dx = seg.b[0] - seg.a[0];
        const dz = seg.b[1] - seg.a[1];
        const len = Math.hypot(dx, dz);
        const cnt = Math.max(1, Math.floor(len / 4.5));
        const rot = -Math.atan2(dz, dx);
        for (let k = 0; k < cnt; k++) {
          const t = (k + 0.5) / cnt;
          dashes.push({ p: [seg.a[0] + dx * t, seg.a[1] + dz * t], rot, size: "street" });
        }
      }
      // lamps stand on the sidewalk OUTSIDE the ring corner, not on the asphalt
      lamps.push([cx - R - 2.4, cz - D - 2.4], [cx + R + 2.4, cz + D + 2.4]);
      for (let t = 0; t < 6; t++) trees.push([cx - R + rnd() * 2 * R, cz - D - 2.5 - rnd() * 2]);
    }
  });

  // ── global overlap pass — nudge buildings apart along the smaller
  //    penetration axis; overlaps at this point mean upstream districts
  //    drifted too close. Cheap O(n²): n ≤ ~150 buildings.
  {
    const HALF = FOOTPRINT_HALF; // widest lot half-extent (model fp=3.8 → 1.9)
    let overlaps = 0;
    for (let pass = 0; pass < 3; pass++) {
      overlaps = 0;
      for (let a = 0; a < buildings.length; a++) {
        for (let b = a + 1; b < buildings.length; b++) {
          const A = buildings[a], B = buildings[b];
          if (A.districtId === B.districtId && A.stack !== "database") continue; // grid handles intra-district
          const px = B.pos[0] - A.pos[0];
          const pz = B.pos[2] - A.pos[2];
          const ox = 2 * HALF - Math.abs(px);
          const oz = 2 * HALF - Math.abs(pz);
          if (ox <= 0 || oz <= 0) continue;
          overlaps++;
          if (ox < oz) {
            const dir = px >= 0 ? 1 : -1;
            A.pos[0] -= (dir * ox) / 2;
            B.pos[0] += (dir * ox) / 2;
          } else {
            const dir = pz >= 0 ? 1 : -1;
            A.pos[2] -= (dir * oz) / 2;
            B.pos[2] += (dir * oz) / 2;
          }
        }
      }
      if (overlaps === 0) break;
    }
    console.info(`[layout] building overlaps after nudge pass: ${overlaps}`);
  }

  // ── arterial network (every district connects to it via a gate stub) ──
  const highways: RoadSeg[] = [
    // west & east avenues (the two N-S spines)
    { a: [-42, -29], b: [-42, 52], w: 5, kind: "highway" },
    { a: [42, -29], b: [42, 44], w: 5, kind: "highway" },
    // east-west trunk through the bridge
    { a: [-42, -8], b: [-6, -8], w: 5, kind: "highway" },
    { a: [6, -8], b: [42, -8], w: 5, kind: "highway" },
    // NOTE: no road plane across the water — the real deck lives in Infrastructure.tsx
    // database platform ramps + external spur
    { a: [24, 54], b: [42, 44], w: 5, kind: "highway" },
    { a: [-42, 44], b: [-24, 54], w: 5, kind: "highway" },
    { a: [0, 61], b: [0, 85], w: 5, kind: "highway" },
  ];
  // NOTE: highways are pushed into `roads` AFTER the dynamic gate-stub pass
  // below — that pass splits them at each ring's landing point, and the road
  // graph only ever sees segment endpoints.
  // data-stores frontage alley (cars cruise this lane behind the collections)
  roads.push({ a: [-19, 61], b: [19, 61], w: 2.5, kind: "road" });
  // connector: extends the Cart district's west ring edge north to its gate
  // stub so the payment lane never drives on bare grass (z -11 → 4)
  roads.push({ a: [-40, -11], b: [-40, 4], w: 2.5, kind: "road" });
  // ramp feet connecting the diagonals down to the alley
  roads.push(
    { a: [24, 54], b: [19, 61], w: 2.5, kind: "road" },
    { a: [-24, 54], b: [-19, 61], w: 2.5, kind: "road" },
  );

  // gate stubs: ring edge midpoint → nearest avenue
  const gateStubs: { a: [number, number]; b: [number, number] }[] = [
    { a: [-44, -20], b: [-42, -20] },
    { a: [-44, 4], b: [-42, 4] },
    { a: [-44, 52], b: [-42, 52] },
    { a: [-40, -20], b: [-42, -20] },
    { a: [-40, 4], b: [-42, 4] },
    { a: [40, -20], b: [42, -20] },
    { a: [40, 4], b: [42, 4] },
    { a: [44, -20], b: [42, -20] },
    { a: [44, 4], b: [42, 4] },
  ];
  gateStubs.forEach((s) => roads.push({ ...s, w: 2.5, kind: "road" }));

  /* ── DYNAMIC gate stubs ──────────────────────────────────────────────────
     The stubs above only fit the demo's default district positions. When a
     district ring lands anywhere else its ring becomes an ISLAND in the road
     graph and no route can be driven to it. So every ring gets a real stub
     to the nearest arterial: project the ring centre onto the closest
     highway, SPLIT that highway at the landing point (the landing must be a
     graph node or Dijkstra still can't see it) and pave between them. */
  {
    const arterials = highways.map((h) => ({ h, seg: [h.a, h.b] as [number, number][] }));
    districts
      .filter((d) => d.stack !== "database")
      .forEach((d) => {
        const [cx, cz] = d.center;
        const R = d.ringR;
        const D = d.ringD;
        // ring perimeter as four segments
        const ring: [number, number][][] = [
          [[cx - R, cz - D], [cx + R, cz - D]],
          [[cx + R, cz - D], [cx + R, cz + D]],
          [[cx + R, cz + D], [cx - R, cz + D]],
          [[cx - R, cz + D], [cx - R, cz - D]],
        ];
        // nearest point on any highway to the ring centre…
        let bestArterial: { h: (typeof highways)[number]; p: [number, number] } | null = null;
        let bd = Infinity;
        for (const a of arterials) {
          const p = projOnSeg(cx, cz, a.seg[0], a.seg[1]);
          const dist = Math.hypot(p[0] - cx, p[1] - cz);
          if (dist < bd) { bd = dist; bestArterial = { h: a.h, p }; }
        }
        if (!bestArterial) return;
        // …and the closest ring edge to that landing point
        let ringP: [number, number] = bestArterial.p;
        let rd = Infinity;
        for (const seg of ring) {
          const p = projOnSeg(bestArterial.p[0], bestArterial.p[1], seg[0], seg[1]);
          const dist = Math.hypot(p[0] - bestArterial.p[0], p[1] - bestArterial.p[1]);
          if (dist < rd) { rd = dist; ringP = p; }
        }
        // a hardcoded stub already lands here (or the ring touches the road)
        if (rd < 0.6) return;
        roads.push({ a: ringP, b: bestArterial.p, w: 2.5, kind: "road" });
      });
    // arterials last (split segments included) — the graph is built from these
    roads.push(...highways);
  }

  /* ── JUNCTION PASS ───────────────────────────────────────────────────────
     Any road endpoint landing in the INTERIOR of another segment is a T
     junction — gate stubs hit ring edges at their midpoints, and Dijkstra
     only knows segment ENDPOINTS, so those junctions were invisible and
     every district ended up on its own island. Split the host segment at
     each landing so the meeting point becomes a real node. */
  {
    const pts: [number, number][] = [];
    for (const r of roads) pts.push(r.a, r.b);
    const bySeg = new Map<number, [number, number][]>();
    roads.forEach((r, i) => {
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1];
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) return;
      for (const p of pts) {
        if ((p[0] === r.a[0] && p[1] === r.a[1]) || (p[0] === r.b[0] && p[1] === r.b[1])) continue;
        if (Math.abs(distToSeg(p[0], p[1], r.a, r.b)) > 0.02) continue; // not on this line
        const dot = (p[0] - r.a[0]) * dx + (p[1] - r.a[1]) * dz;
        if (dot <= 0.02 || dot >= len2 - 0.02) continue; // endpoint, not interior
        if (!bySeg.has(i)) bySeg.set(i, []);
        bySeg.get(i)!.push([p[0], p[1]]);
      }
    });
    // splice back-to-front so earlier indices stay valid
    for (const [i, ats] of [...bySeg.entries()].sort((a, b) => b[0] - a[0])) {
      const r = roads[i];
      const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1];
      const len2 = dx * dx + dz * dz;
      ats.sort(
        (p, q) =>
          ((p[0] - r.a[0]) * dx + (p[1] - r.a[1]) * dz) / len2 -
          ((q[0] - r.a[0]) * dx + (q[1] - r.a[1]) * dz) / len2,
      );
      const chain = [r.a, ...ats, r.b];
      const parts: RoadSeg[] = [];
      for (let k = 0; k < chain.length - 1; k++) parts.push({ a: chain[k], b: chain[k + 1], w: r.w, kind: r.kind });
      roads.splice(i, 1, ...parts);
    }
  }

  /* ── ROAD-CLEARANCE PASS ──────────────────────────────────────────────
     Runs after every road exists (rings, stubs, avenues, trunk, ramps).
     No building may stand on asphalt: each lot is projected onto the nearest
     drivable surface and pushed back until it clears the kerb by MIN_GAP.
     This is what guarantees a visible strip of sidewalk between every wall
     and every road — "you can see which building connects to which". In a
     well-formed grid this pass is a no-op; it is the safety net for layouts
     the grid maths didn't anticipate (huge districts, odd district counts). */
  {
    const MIN_GAP = SIDEWALK; // metres of ground between wall and kerb
    let adjusted = 0;
    let worstWho = "";
    let worstGap = 0;
    for (const b of buildings) {
      const half = FOOTPRINT[b.kind] / 2;
      for (let pass = 0; pass < 5; pass++) {
        let pushX = 0, pushZ = 0, deficit = 0;
        let pushFrom = "";
        for (const r of roads) {
          const p = projOnSeg(b.pos[0], b.pos[2], r.a, r.b);
          let dx = b.pos[0] - p[0], dz = b.pos[2] - p[1];
          let dist = Math.hypot(dx, dz);
          const want = r.w / 2 + half + MIN_GAP;
          if (dist >= want) continue;
          if (dist < 1e-4) {
            // sitting ON the centre-line — shove along the road's normal
            const ex = r.b[0] - r.a[0], ez = r.b[1] - r.a[1];
            const el = Math.hypot(ex, ez) || 1;
            dx = -ez / el; dz = ex / el; dist = 0;
          }
          const gap = want - dist;
          if (gap > deficit) {
            deficit = gap;
            pushX = dx / (dist || 1);
            pushZ = dz / (dist || 1);
            pushFrom = `${b.id} → [${r.a} → ${r.b}] by ${gap.toFixed(2)}`;
          }
        }
        if (deficit <= 0) break;
        b.pos[0] += pushX * deficit;
        b.pos[2] += pushZ * deficit;
        adjusted++;
        if (deficit > worstGap) { worstGap = deficit; worstWho = pushFrom; }
      }
    }
    if (adjusted) console.info(`[layout] road-clearance pass nudged ${adjusted} lot(s) off the asphalt (last: ${worstWho})`);
  }

  // dashed centre-line markings on arterials (skipped over the bridge span)
  highways.forEach((seg) => {
    const dx = seg.b[0] - seg.a[0];
    const dz = seg.b[1] - seg.a[1];
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.floor(len / 4.5));
    const rot = -Math.atan2(dz, dx);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const mx = seg.a[0] + dx * t;
      const mz = seg.a[1] + dz * t;
      // skip the river gap (bridge has its own deck)
      if (mz === -8 && Math.abs(mx) < 6.5) continue;
      dashes.push({ p: [mx, mz], rot, size: "arterial" });
    }
  });

  // zebra crosswalks where gate stubs meet the avenues — five stripes each
  gateStubs.forEach((s) => {
    const dx = s.b[0] - s.a[0];
    const dz = s.b[1] - s.a[1];
    const rot = -Math.atan2(dz, dx); // stripe lies ACROSS the walking direction
    for (let k = 0; k < 5; k++) {
      const t = 0.2 + (k / 4) * 0.6;
      crossings.push({
        p: [s.a[0] + dx * t, s.a[1] + dz * t],
        rot: rot + Math.PI / 2,
      });
    }
  });

  // ── underground pipes = query edges ──
  city.edges
    .filter((e) => e.kind === "query")
    .forEach((e) => {
      const a = buildings.find((b) => b.id === e.from)!;
      const b = buildings.find((x) => x.id === e.to)!;
      if (!a || !b) return;
      pipes.push({ a: [a.pos[0], a.pos[2]], b: [b.pos[0], b.pos[2]], w: 1, kind: "road" });
    });

  // ── commuters: pedestrians walk real commute lines along district rings ──
  people.length = 0;
  for (const d of districts) {
    if (d.stack === "database") continue;
    const px = d.ringR + 2.2;
    const pz = d.ringD + 1.6; // just outside the (content-fitted) ring road
    people.push({ a: [d.center[0] - px, d.center[1] + pz], b: [d.center[0] + px, d.center[1] + pz] });
    people.push({ a: [d.center[0] + px, d.center[1] - pz], b: [d.center[0] - px, d.center[1] - pz] });
  }
  people.push({ a: [-46.8, -29], b: [-46.8, 52] }); // west avenue sidewalk
  people.push({ a: [46.8, -29], b: [46.8, 44] });   // east avenue sidewalk

  const byId = new Map(buildings.map((b) => [b.id, b]));

  // ── furniture post-pass: nothing natural stands on asphalt ──
  // Trees/lamps sampled near ring corners can land on the ring road, the
  // trunk, or an avenue once districts grow — drop anything with < 1.2
  // clearance and pull lamps out of the road corners.
  const clearable = (x: number, z: number, margin = 1.2) => {
    for (const r of roads) {
      if (distToSeg(x, z, r.a, r.b) < r.w / 2 + margin) return false;
    }
    return true;
  };
  const treesSafe = trees.filter(([x, z]) => clearable(x, z));
  trees.length = 0;
  trees.push(...treesSafe);

  const lampsSafe: [number, number][] = [];
  for (const [x, z] of lamps) {
    if (clearable(x, z, 0.8)) lampsSafe.push([x, z]);
  }
  lamps.length = 0;
  lamps.push(...lampsSafe);

  /* ── SLAB PASS ────────────────────────────────────────────────────────
     The district plinth is sized from the FINAL building positions:
       • ring districts → stop exactly at the ring road's INNER edge, so the
         asphalt, the curbs and the traffic stay above ground (the old slab
         overshot the ring by 2.5 u and buried all three — cars looked like
         they were driving through solid ground);
       • the database platform → hug its collections but never reach the
         frontage alley (inner edge z ≈ 59.75) or the ramp foot (x ≈ 19.9).
     Then every road that cuts through the district interior is SUBTRACTED
     from the pad (the plinth is 0.5 m tall, so an arterial crossing it would
     swallow the asphalt — the backend plinth used to bury the z=-8 trunk and
     the data platform buried both ramps). What's left is a set of rectangles
     the renderer draws as one broken-up sidewalk. */
  type Rect = [number, number, number, number]; // x0, z0, x1, z1 (world)
  const roadCutters: Rect[] = roads.map((r) => {
    const m = r.w / 2 + 0.08; // hair of grass between pad and asphalt
    return [
      Math.min(r.a[0], r.b[0]) - m,
      Math.min(r.a[1], r.b[1]) - m,
      Math.max(r.a[0], r.b[0]) + m,
      Math.max(r.a[1], r.b[1]) + m,
    ];
  });
  /** base − cutters → disjoint rectangles (thin grazes are ignored so the
   *  pad's own ring-road edge never shaves a 8 cm sliver off every side). */
  const carve = (base: Rect, minOverlap = 0.3): Rect[] => {
    let pieces: Rect[] = [base];
    for (const c of roadCutters) {
      const next: Rect[] = [];
      for (const p of pieces) {
        const ix0 = Math.max(p[0], c[0]), iz0 = Math.max(p[1], c[1]);
        const ix1 = Math.min(p[2], c[2]), iz1 = Math.min(p[3], c[3]);
        if (ix1 - ix0 < minOverlap || iz1 - iz0 < minOverlap) {
          next.push(p);
          continue;
        }
        if (p[0] < ix0) next.push([p[0], p[1], ix0, p[3]]);
        if (ix1 < p[2]) next.push([ix1, p[1], p[2], p[3]]);
        if (p[1] < iz0) next.push([p[0], p[1], p[2], iz0]);
        if (iz1 < p[3]) next.push([p[0], iz1, p[2], p[3]]);
      }
      pieces = next;
    }
    // drop slivers thinner than 0.6 u — they render as a stray stripe
    return pieces.filter((p) => p[2] - p[0] > 0.6 && p[3] - p[1] > 0.6);
  };

  for (const d of districts) {
    let sx: number, sz: number;
    if (d.stack !== "database") {
      sx = Math.max(2, (d.ringR - ROAD_RING_HALF) * 2);
      sz = Math.max(2, (d.ringD - ROAD_RING_HALF) * 2);
    } else {
      let hx = 0;
      let hz = 0;
      for (const b of buildings) {
        if (b.districtId !== d.id) continue;
        const half = FOOTPRINT[b.kind] / 2;
        hx = Math.max(hx, Math.abs(b.pos[0] - d.center[0]) + half);
        hz = Math.max(hz, Math.abs(b.pos[2] - d.center[1]) + half);
      }
      sx = 2 * Math.min(hx + 1.8, 19.4);
      sz = 2 * Math.min(hz + 1.8, 3.7);
    }
    d.slab = [sx, sz];
    const base: Rect = [
      d.center[0] - sx / 2, d.center[1] - sz / 2,
      d.center[0] + sx / 2, d.center[1] + sz / 2,
    ];
    const pieces = carve(base);
    d.slabs = pieces.map((p) => [
      p[0] - d.center[0],
      p[1] - d.center[1],
      p[2] - p[0],
      p[3] - p[1],
    ]);
  }

  const L: CityLayout = {
    buildings, districts, roads, bridges: [-8], trees, lamps, people, pipes, dashes, crossings,
    flowPaths: {}, byId,
    // toll centered on the ACTUAL eastbound flow lane (lane() shifts +0.75 off
    // the road center, so traffic crosses x=-13 at z=-7.25, not -8)
    toll: { x: -13, z: -7.25, lanes: [0] },
  };

  /* ── DEMO STREET LANES ────────────────────────────────────────────────
     Three storytelling routes (Login / Payment / Cart) BUILT from real
     building doors and routed over the road graph, so every waypoint sits on
     asphalt. The old hand-drawn lanes carried curb/doorway waypoints that
     drove cars across the sidewalk plinth (top y=0.5) at lane height
     (y=0.18) — that is exactly what made traffic look like it was running
     off the road. A lane is only emitted when this city has the buildings it
     needs, so a backend-only repo simply gets fewer demo lanes. */
  const demoStops = (i: number): [number, number][] | null => {
    const pick = (k: Kind): LaidBuilding | null => {
      const list = buildings.filter((b) => b.kind === k);
      return list.length ? list[i % list.length] : null;
    };
    const seq = [pick("page"), pick("route"), pick("controller"), pick("service"), pick("model")].filter(
      (b): b is LaidBuilding => b !== null,
    );
    if (seq.length < 2) return null;
    return seq.map((b) => [b.pos[0], b.pos[2]] as [number, number]);
  };
  ["login", "payment", "cart"].forEach((key, i) => {
    const stops = demoStops(i);
    if (!stops) return;
    const onRoads = snapToRoads(L, stops);
    if (!onRoads) return;
    const wps = onRoads.map(([x, z]) => [x, ROAD_Y, z] as Waypoint);
    const path = lane(withRiverCrossing(wps), 0.75);
    if (path.length >= 2) L.flowPaths[key] = path;
  });

  return L;
}

// ─── road-network routing (derived flows drive ON streets, not over lawns) ──

/** perpendicular distance from point to segment */
function distToSeg(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

/** the closest point ON segment ab to (px, pz) — used to drop gate stubs and
 *  building driveways onto the road surface exactly where they meet it */
export function projOnSeg(
  px: number,
  pz: number,
  a: [number, number],
  b: [number, number],
): [number, number] {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
  return [a[0] + dx * t, a[1] + dz * t];
}

/** clearance between a point and every drivable surface (negative = inside) */
export function roadClearance(L: CityLayout, x: number, z: number) {
  let min = Infinity;
  for (const r of L.roads) min = Math.min(min, distToSeg(x, z, r.a, r.b) - r.w / 2);
  return min;
}

/** Dijkstra over the road graph: segment endpoints are nodes, segments are
 *  edges, plus one virtual bridge edge across the river. Returns XZ waypoints
 *  (collinear points merged) or null when both ends can't be joined. */
export function snapToRoads(L: CityLayout, stops: [number, number][]): [number, number][] | null {
  const K = (x: number, z: number) => `${Math.round(x * 2) / 2}|${Math.round(z * 2) / 2}`;
  const nodes = new Map<string, [number, number]>();
  const adj = new Map<string, Map<string, number>>();
  const nodeAt = (p: [number, number]) => {
    const k = K(p[0], p[1]);
    nodes.set(k, p);
    return k;
  };
  const link = (ka: string, kb: string, w: number) => {
    if (!adj.has(ka)) adj.set(ka, new Map());
    if (!adj.has(kb)) adj.set(kb, new Map());
    const m = adj.get(ka)!;
    if (!m.has(kb) || m.get(kb)! > w) m.set(kb, w);
    const n = adj.get(kb)!;
    if (!n.has(ka) || n.get(ka)! > w) n.set(ka, w);
  };
  const connect = (p: [number, number], q: [number, number]) =>
    link(nodeAt(p), nodeAt(q), Math.hypot(q[0] - p[0], q[1] - p[1]));

  const segs: [number, number][][] = L.roads.map((r) => [r.a, r.b]);
  // virtual bridge span (the deck is not a road plane)
  const deck: [number, number][] = [[-BRIDGE.halfSpan, -8], [BRIDGE.halfSpan, -8]];
  segs.push(deck);
  for (const s of segs) connect(s[0], s[1]);

  /** drop a stop onto the nearest road SURFACE, splitting that segment so the
   *  driveway always joins the same component the road belongs to (nearest
   *  NODE would happily pick a corner of a different district's ring) */
  const anchorOf = (p: [number, number]): string => {
    let best: { proj: [number, number]; seg: [number, number][] } | null = null;
    let bd = Infinity;
    for (const s of segs) {
      const proj = projOnSeg(p[0], p[1], s[0], s[1]);
      const d = Math.hypot(proj[0] - p[0], proj[1] - p[1]);
      if (d < bd) { bd = d; best = { proj, seg: s }; }
    }
    if (!best) return "";
    const anchor = nodeAt(best.proj);
    // split the segment at the landing point so the anchor is a real node
    const e0 = nodeAt(best.seg[0]);
    const e1 = nodeAt(best.seg[1]);
    if (e0 !== anchor) link(anchor, e0, Math.hypot(best.proj[0] - best.seg[0][0], best.proj[1] - best.seg[0][1]));
    if (e1 !== anchor) link(anchor, e1, Math.hypot(best.proj[0] - best.seg[1][0], best.proj[1] - best.seg[1][1]));
    return anchor;
  };

  const dijkstra = (from: string, to: string): string[] | null => {
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([from]);
    const closed = new Set<string>();
    while (open.size) {
      let cur = "";
      let cd = Infinity;
      for (const k of open) {
        const d = dist.get(k) ?? Infinity;
        if (d < cd) { cd = d; cur = k; }
      }
      if (!cur) return null;
      open.delete(cur);
      closed.add(cur);
      if (cur === to) break;
      for (const [nb, w] of adj.get(cur) ?? []) {
        if (closed.has(nb)) continue;
        const nd = cd + w;
        if (nd < (dist.get(nb) ?? Infinity)) {
          dist.set(nb, nd);
          prev.set(nb, cur);
          open.add(nb);
        }
      }
    }
    if (!closed.has(to)) return null;
    const path: string[] = [to];
    while (path[0] !== from) path.unshift(prev.get(path[0])!);
    return path;
  };

  const points: [number, number][] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const nA = anchorOf(a);
    const nB = anchorOf(b);
    if (!nA || !nB) return null;
    const seg = dijkstra(nA, nB);
    if (!seg) return null;
    const leg = seg.map((k) => nodes.get(k)!);
    // NOTE: no driveway stubs. The lane starts and ends on the PROJECTED road
    // anchor — the old door-to-road stubs drove cars off the asphalt and
    // across the sidewalk plinth (top y=0.5) at lane height (y=0.18), which
    // is what made traffic look like it was running off the road.
    points.push(...leg);
  }
  if (points.length < 2) return null;

  // merge collinear waypoints so the curve stays smooth, not wobbly
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1], c = points[i], n = points[i + 1];
    const c1 = (c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]);
    const d1 = (c[0] - p[0]) * (n[0] - c[0]) + (c[1] - p[1]) * (n[1] - c[1]);
    if (Math.abs(c1) > 0.01 || d1 < 0) out.push(c);
  }
  out.push(points[points.length - 1]);
  return out;
}


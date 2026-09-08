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
} as const;
/** lane height while ON the deck — deck top + wheel clearance */
const BRIDGE_Y = BRIDGE.deckTop + 0.06;
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

const P = (x: number, z: number, y: number = ROAD_Y): Waypoint => [x, y, z];

/** Post-process a derived (building-center) lane so any leg crossing the
 *  river rides the bridge instead of ploughing through the water. */
export function withRiverCrossing(pts: Waypoint[]): Waypoint[] {  const out: Waypoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    out.push(p);
    if (!q) break;
    const crosses =
      (p[0] < -BRIDGE.halfSpan + 0.3 && q[0] > BRIDGE.halfSpan - 0.3) ||
      (p[0] > BRIDGE.halfSpan - 0.3 && q[0] < -BRIDGE.halfSpan + 0.3);
    if (!crosses) continue;
    // land the crossing at the bridge line z=-8, ramp feet → deck → ramp feet
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const total = Math.abs(q[0] - p[0]);
    const at = (x: number) => lerp(p[2], q[2], Math.abs(x - p[0]) / total);
    const west = p[0] < 0;
    const footW = west ? -9.6 : 9.6;
    const footE = west ? 9.6 : -9.6;
    out.push(
      [footW, ROAD_Y, at(footW)],
      [BRIDGE.halfSpan * Math.sign(footW), BRIDGE.deckTop + 0.06, -8],
      [BRIDGE.halfSpan * Math.sign(footE), BRIDGE.deckTop + 0.06, -8],
      [footE, ROAD_Y, at(footE)],
    );
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

  city.districts.forEach((d) => {
    const [zx, zz] = ZONE[d.stack];
    const i = (counters[d.stack] = (counters[d.stack] ?? -1) + 1);
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = d.stack === "database" || d.stack === "external" ? zx : zx + (col - 0.5) * 26;
    const cz =
      d.stack === "database" || d.stack === "external"
        ? zz
        : zz + (row - 0.5) * 24 + (i > 3 ? 24 : 0);

    // ── fit the ring road to the content (was a fixed R11/D9 rectangle that
    //    the 7th+ building spilled out of). Grid is CENTERED so overflow is
    //    symmetric and the ring can grow around it.
    const n = d.buildings.length;
    const ringR = 11;
    let ringD = 9;
    if (d.stack !== "database") {
      const rows = Math.ceil(n / 3);
      ringD = Math.min(13, Math.max(9, (rows * 7) / 2 + 3));
    }
    districts.push({ ...d, center: [cx, cz], ringR, ringD });

    d.buildings.forEach((b, bi) => {
      let x: number, z: number;
      if (d.stack === "database") {
        x = (bi - (n - 1) / 2) * 8;
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
    const HALF = 3.3; // conservative max footprint half-extent (model fp=6.4)
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
  roads.push(...highways);
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

  // ── vehicle lanes: routes follow streets, not building centers ──
  // The hand-authored lanes hug specific ring edges (e.g. the login lane rolls
  // along the frontend district's SOUTH edge). Rings now grow with content, so
  // resolve those edges from the LAID districts instead of hardcoding -29.
  const loginDistrict =
    districts.find((d) => d.buildings.some((b) => b.id === "fe-login")) ??
    districts.find((d) => d.stack === "frontend");
  const loginZ = loginDistrict ? loginDistrict.center[1] - loginDistrict.ringD : -29;

  const bridgeEast = (): Waypoint[] => [
    P(-11, -8),                 // trunk, road level
    P(-9.6, -8),                // west ramp foot
    P(-6.2, -8, BRIDGE_Y),      // ramp head → deck (gentle 7° climb)
    P(6.2, -8, BRIDGE_Y),       // straight across the span
    P(9.6, -8),                 // east ramp foot
    P(11, -8),                  // back on the trunk
  ];

  const loginRaw: Waypoint[] = [
    P(-61.5, loginZ + 2),       // fe-login door, roll south to the ring
    P(-61.5, loginZ),
    P(-44, loginZ),             // east along the ring south edge
    P(-44, -20),                // ring corner → gate
    P(-42, -20),                // west avenue
    P(-42, -8),                 // trunk junction
    ...bridgeEast(),
    P(42, -8),
    P(42, -20),                 // east avenue down to the Routes gate
    P(40, -20),
    P(40, -23.5),               // Routes curb (authRoutes.js)
    P(40, -20),
    P(42, -20),
    P(42, -8),
    P(42, 4),                   // north up the east avenue
    P(40, 4),                   // Services gate
    P(40, 0.5),                 // Services curb (authService.js)
    P(40, 4),
    P(42, 4),
    P(42, 44),                  // long haul north
    P(24, 54),                  // database ramp
    P(19, 61),                  // frontage alley
    P(0, 61),
    P(-16, 61),
    P(-16, 60),                 // curb at users
  ];

  const paymentRaw: Waypoint[] = [
    P(-35.5, 2),                // fe-payment door
    P(-40, 2),                  // west to the ring edge
    P(-40, 4),
    P(-42, 4),                  // Payment gate → west avenue
    P(-42, -8),                 // down the west avenue
    ...bridgeEast(),
    P(42, -8),
    P(42, -20),
    P(40, -20),
    P(40, -23.5),               // Routes curb (paymentRoutes.js)
    P(40, -20),
    P(42, -20),                 // cross the avenue
    P(44, -20),
    P(44, -23.5),               // Controllers curb (paymentController.js)
    P(44, -20),
    P(42, -20),
    P(42, 4),                   // north to Services gate
    P(40, 4),
    P(40, 0.5),                 // Services curb (paymentService.js)
    P(40, 4),
    P(42, 4),
    P(42, 44),                  // long haul: avenue → platform ramp → spur
    P(24, 54),
    P(19, 61),
    P(0, 61),
    P(0, 66),
    P(0, 85),
    P(-3.5, 88),
    P(-6.5, 89.5),              // Stripe API tower curb
    P(-3.5, 88),
    P(0, 85),
    P(0, 61),                   // back down the spur
    P(16, 61),                  // east along the frontage
    P(16, 60),                  // payments collection
  ];

  const cartRaw: Waypoint[] = [
    P(-35.5, -22),              // fe-cart door
    P(-40, -22),
    P(-40, -20),                // Cart gate
    P(-42, -20),
    P(-42, -8),
    ...bridgeEast(),
    P(42, -8),
    P(42, -20),
    P(40, -20),
    P(40, -23.5),               // Routes curb (cartRoutes.js)
    P(40, -20),
    P(42, -20),
    P(44, -20),
    P(44, -23.5),               // Controllers curb (cartController.js)
    P(44, -20),
    P(42, -20),
    P(42, 4),
    P(42, 44),
    P(24, 54),
    P(19, 61),
    P(0, 61),
    P(0, 60),                   // carts collection
  ];

  const flowPaths: Record<string, Waypoint[]> = {
    login: lane(loginRaw),
    payment: lane(paymentRaw),
    cart: lane(cartRaw),
  };

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

  return {
    buildings, districts, roads, bridges: [-8], trees, lamps, people, pipes, dashes, crossings, flowPaths, byId,
    // toll centered on the ACTUAL eastbound flow lane (lane() shifts +0.75 off
    // the road center, so traffic crosses x=-13 at z=-7.25, not -8)
    toll: { x: -13, z: -7.25, lanes: [0] },
  };
}

// ─── road-network routing (derived flows drive ON streets, not over lawns) ──

/** perpendicular distance from point to segment */
function distToSeg(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
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
  const link = (ka: string, kb: string, w: number) => {
    if (!adj.has(ka)) adj.set(ka, new Map());
    if (!adj.has(kb)) adj.set(kb, new Map());
    const m = adj.get(ka)!;
    if (!m.has(kb) || m.get(kb)! > w) m.set(kb, w);
    const n = adj.get(kb)!;
    if (!n.has(ka) || n.get(ka)! > w) n.set(ka, w);
  };
  for (const r of L.roads) {
    const ka = K(r.a[0], r.a[1]);
    const kb = K(r.b[0], r.b[1]);
    nodes.set(ka, r.a);
    nodes.set(kb, r.b);
    link(ka, kb, Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]));
  }
  // virtual bridge span (the deck is not a road plane)
  const bw = K(-BRIDGE.halfSpan, -8);
  const be = K(BRIDGE.halfSpan, -8);
  nodes.set(bw, [-BRIDGE.halfSpan, -8]);
  nodes.set(be, [BRIDGE.halfSpan, -8]);
  link(bw, be, BRIDGE.halfSpan * 2);

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
    const nA = nearestNode(nodes, a);
    const nB = nearestNode(nodes, b);
    if (!nA || !nB) return null;
    const seg = dijkstra(nA, nB);
    if (!seg) return null;
    const leg = seg.map((k) => nodes.get(k)!);
    if (i === 0) points.push(a);           // driveway out of the origin door
    points.push(...leg);
    if (i === stops.length - 2) points.push(b); // driveway into the destination
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

/** node key nearest to a point */
function nearestNode(nodes: Map<string, [number, number]>, p: [number, number]): string {
  let best = "";
  let bd = Infinity;
  for (const [k, v] of nodes) {
    const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}


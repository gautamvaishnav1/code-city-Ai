import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CityLayout } from "../lib/layout";
import { withRiverCrossing, snapToRoads, offsetLane, ROAD_Y } from "../lib/layout";
import { allFlows } from "../lib/city";
import { useCity, followTarget } from "../store/useCity";
import { ENV } from "./env";
import { VEHICLE_FAST, VEHICLE_MED, VEHICLE_SLOW, VEHICLE_HERO, pick } from "./assets";
import { TollGate } from "./Toll";
import type { Verb } from "./missionTypes";

/** world-units per SECOND — divided by each lane's real length in useFrame,
 *  so a car crosses any lane in (laneLength / speed) seconds regardless of
 *  how the curve is parameterized. medium ≈ 5.5 u/s ⇒ ~50 s over the login
 *  avenue instead of the old racetrack. */
const SPEED = { fast: 9, medium: 5.5, slow: 3 };
const LAT_COLOR = { fast: "#22c55e", medium: "#eab308", slow: "#ef4444" };

/**
 * Models whose nose points at −Z in local space. `lookAt` aims +Z along the
 * travel tangent, so these would drive in reverse unless we spin them 180°.
 * (Measured from wheel nodes: ferrari front axle sits at z=−1.15, rear +1.5.)
 */
const REVERSE_MODELS = new Set(["/models/vehicles/ferrari.glb"]);

/**
 * Build a driving curve for a flow. Prefers the hand-authored street lane in
 * L.flowPaths (cars ride actual roads); falls back to building centers only
 * when no lane exists for that flow.
 */
function makeCurve(L: CityLayout, name: string, ids: string[]): THREE.CatmullRomCurve3 | null {
  const lanePts = L.flowPaths?.[name];
  if (lanePts && lanePts.length >= 2) {
    return new THREE.CatmullRomCurve3(
      lanePts.map(([x, y, z]) => new THREE.Vector3(x, y + 0.06, z)),
      false,
      "catmullrom",
      0.08,
    );
  }
  // derived flows have no hand-authored lane — route them along the REAL
  // road network (Dijkstra over streets + bridge), not straight over lawns
  console.info(`[Traffic] no street lane for "${name}" — routing over the road graph`);
  const centers = ids.filter(Boolean).map((id) => {
    const b = L.byId.get(id);
    if (!b) console.warn(`[Traffic] unknown flow id "${id}" — skipped`);
    return b;
  }).filter(Boolean).map((b) => [(b as any).pos[0], (b as any).pos[2]] as [number, number]);
  if (centers.length < 2) return null;
  const onRoads = snapToRoads(L, centers);
  let wps: [number, number, number][] = (onRoads ?? centers).map(([x, z]) => [x, ROAD_Y, z]);
  wps = withRiverCrossing(wps); // bridge legs (also fixes the virtual span edge)
  wps = offsetLane(wps, 0.75);  // right-hand traffic
  return new THREE.CatmullRomCurve3(
    wps.map(([x, y, z]) => new THREE.Vector3(x, y + 0.06, z)),
    false,
    "catmullrom",
    0.15,
  );
}

function GltfCar({ url, color }: { url: string; color?: string }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const done = useRef(false);
  if (color && !done.current) {
    cloned.traverse((o: any) => {
      if (o.isMesh && o.material?.color) {
        o.material = o.material.clone();
        o.material.color.lerp(new THREE.Color(color), 0.45);
      }
    });
    done.current = true;
  }
  return <primitive object={cloned} />;
}

function Headlights({ flip = false }: { flip?: boolean }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null!);
  const z = flip ? -1.05 : 1.05;
  useFrame(() => { if (mat.current) mat.current.emissiveIntensity = ENV.night * 2; });
  return (
    <group>
      <mesh position={[-0.28, 0.45, z]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.09, 10]} />
        <meshStandardMaterial ref={mat} color="#fff7d6" emissive="#ffdf8a" emissiveIntensity={0} />
      </mesh>
      <mesh position={[0.28, 0.45, z]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.09, 10]} />
        <meshStandardMaterial color="#fff7d6" emissive="#ffdf8a" emissiveIntensity={0} />
      </mesh>
    </group>
  );
}

function Car({ curve, offset, latencyKey, hero, stuck, color }: any) {
  const ref = useRef<THREE.Group>(null!);
  const cur = useCity((s) => s.latency);
  // latency only restyles the beacon + model; ambient pace stays stately
  // (clamped to ≤1.5× medium) so one HUD toggle can't turn the city into a
  // racetrack. An explicit latencyKey still sets that specific car's speed.
  const key: keyof typeof SPEED = latencyKey ?? "medium";
  const laneLen = useMemo(() => curve.getLength(), [curve]);
  // stagger start offsets by lane length so gaps look natural on any curve
  const t = useRef(((offset * laneLen) / 40) % 1);
  const url = useMemo(
    () => (hero ? VEHICLE_HERO : cur === "fast" ? pick(VEHICLE_FAST, offset * 100) : cur === "slow" ? pick(VEHICLE_SLOW, offset * 100) : pick(VEHICLE_MED, offset * 100)),
    [cur, offset, hero],
  );
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // clamp tab-switch/GC spikes → no teleporting actors
    if (!stuck) {
      const spd = Math.min(SPEED[key], SPEED.medium * 1.5);
      // while a mission is running the courier is the star — ambient traffic crawls
      const missionActive = useCity.getState().mission != null;
      const factor = missionActive ? 0.35 : 1;
      t.current = (t.current + (dt * spd * factor) / laneLen) % 1;
    }
    const u = stuck ? 0.55 : t.current;
    const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
    // lane waypoints already carry the bridge deck height (BRIDGE_Y) — no
    // extra lift, or cars hover over the deck and "drop" off it
    ref.current.position.set(p.x, p.y, p.z);
    ref.current.lookAt(p.clone().add(tan));
    // nose-at-−Z models would otherwise drive in reverse — spin them round
    if (REVERSE_MODELS.has(url)) ref.current.rotateY(Math.PI);
    // NOTE: ambient traffic NEVER touches followTarget — the cinematic camera
    // is reserved exclusively for dispatched missions (RUN buttons)
  });
  return (
    <group ref={ref}>
      <GltfCar url={url} color={typeof color === "string" && color.startsWith("#") ? color : undefined} />
      <Headlights flip={REVERSE_MODELS.has(url)} />
      <mesh position={[0, 1.1, -0.6]}><sphereGeometry args={[0.07, 8, 8]} /><meshStandardMaterial color={LAT_COLOR[cur]} emissive={LAT_COLOR[cur]} emissiveIntensity={0.6 + ENV.night * 3} /></mesh>
    </group>
  );
}

// ─── request missions ────────────────────────────────────────────────────────
// A dispatched API call becomes a courier car: it leaves the origin building's
// door, cruises the flow lane SLOWLY, decelerates into every gateway, dwells
// under a floating card explaining exactly what happens at that hop, then
// reports 200 OK at the destination and dematerialises.

interface HopSpec {
  /** stop beside this building (u computed from its layout position) */
  buildingId?: string;
  /** …or at a named landmark on the lane */
  landmark?: "start" | "toll" | "end";
  title: string;
  verb: Verb;
  detail: string[];
}

const MISSION_SPECS: Record<string, HopSpec[]> = {
  login: [
    { landmark: "start", title: "Login.jsx · handleSubmit()", verb: "dispatch", detail: ["Sign-in clicked — React validates the", "email + password shape client-side,", "then dispatches POST /api/v1/auth/login."] },
    { landmark: "toll", title: "JWT Toll Plaza", verb: "gate", detail: ["The river crossing is paid territory:", "unauthenticated cars must stop here.", "Credentials are exchanged for a ticket", "(Authorization header) beyond this point."] },
    { buildingId: "be-authroute", title: "authRoutes.js", verb: "arrive", detail: ["Express matches POST /auth/login.", "Route-level validators run, then the", "request is handed to the controller."] },
    { buildingId: "be-authctrl", title: "authController.js", verb: "work", detail: ["Parses + normalises the body,", "wraps errors for errorMiddleware,", "delegates verification to the service."] },
    { buildingId: "be-authsvc", title: "authService.js", verb: "verify", detail: ["Password compared against the bcrypt", "hash · createToken() signs a JWT", "(HS256, user id, 24h expiry)."] },
    { buildingId: "db-users", title: "users collection", verb: "query", detail: ["SELECT … WHERE email = ? over the", "underground query pipe — the user row", "rides back up to authService."] },
    { landmark: "end", title: "200 OK · session created", verb: "done", detail: ["AuthResult { token, user } returns;", "AuthContext hydrates the session,", "gates lift app-wide. Welcome in."] },
  ],
  payment: [
    { landmark: "start", title: "PaymentPage.jsx · onPay()", verb: "dispatch", detail: ["Card form validated (Luhn + expiry),", "idempotency key minted, then the", "client dispatches POST /payments."] },
    { landmark: "toll", title: "JWT Toll Plaza", verb: "gate", detail: ["The barrier reads the Authorization", "ticket — no valid JWT, no crossing.", "Middleware stamps req.user and", "waves the courier through."] },
    { buildingId: "be-payroute", title: "paymentRoutes.js", verb: "arrive", detail: ["Express matches POST /api/v1/", "payments. Route chain attaches the", "amount validator before the ctrl."] },
    { buildingId: "be-payctrl", title: "paymentController.js", verb: "work", detail: ["Normalises amount/currency, loads", "the idempotency record — replays", "return the cached receipt instead", "of double-charging the card."] },
    { buildingId: "be-paysvc", title: "paymentService.js", verb: "verify", detail: ["Core money logic: fraud checks,", "balance math wrapped in a tx,", "then the Stripe charge is drafted."] },
    { buildingId: "ext-stripe", title: "Stripe · external API", verb: "gate", detail: ["The courier leaves the city walls:", "card → Stripe over HTTPS. A 2xx", "receipt comes back with the charge", "id; 402s bubble up as declines."] },
    { buildingId: "db-payments", title: "payments collection", verb: "query", detail: ["INSERT payment doc (status: paid)", "with the stripe id — the query pipe", "carries the receipt to the vault."] },
    { landmark: "end", title: "200 OK · receipt issued", verb: "done", detail: ["Receipt { chargeId, status } flows", "back through controller → route →", "client. UI flips to ✓ PAID."] },
  ],
  cart: [
    { landmark: "start", title: "CartDrawer.tsx · addItem()", verb: "dispatch", detail: ["Add-to-cart clicked — optimistic", "UI update first, then a background", "PATCH /cart/:id to persist it."] },
    { landmark: "toll", title: "JWT Toll Plaza", verb: "gate", detail: ["Same toll as every write: the JWT", "identifies whose cart this is.", "Anonymous carts never cross."] },
    { buildingId: "be-cartroute", title: "cartRoutes.js", verb: "arrive", detail: ["Router maps PATCH /cart/:id and", "guards it with requireAuth before", "anything touches the controller."] },
    { buildingId: "be-cartctrl", title: "cartController.js", verb: "work", detail: ["Merges the incoming line item with", "the session cart, clamps quantity", "to stock, dedupes product ids."] },
    { buildingId: "db-carts", title: "carts collection", verb: "query", detail: ["UPDATE carts SET items — the", "persisted cart rides the pipe back", "up so React can reconcile state."] },
    { landmark: "end", title: "200 OK · cart synced", verb: "done", detail: ["Server version of the cart lands;", "optimistic UI reconciles, badge", "count pulses. Item is durable."] },
  ],
};

interface Hop extends HopSpec { u: number }

/** verb for a hop, derived from the building's kind */
const KIND_VERB: Record<string, Verb> = {
  route: "arrive",
  controller: "work",
  service: "verify",
  model: "query",
  api: "gate",
  middleware: "gate",
  page: "dispatch",
  component: "dispatch",
  context: "dispatch",
};

/** Auto-flows (derived from a repo's graph) get synthesized hops: dispatch →
    one hop per building in the chain → 200 OK. Hand-authored flows keep their
    curated MISSION_SPECS. */
function autoSpec(chain: string[], L: CityLayout): HopSpec[] {
  const hops: HopSpec[] = [
    {
      landmark: "start",
      title: "Client · dispatch",
      verb: "dispatch",
      detail: ["Request leaves the client —", "follow the courier through the", "derived call chain to the response."],
    },
  ];
  for (const id of chain) {
    const b = L.byId.get(id);
    if (!b) continue;
    const fn = b.functions[0]?.name;
    hops.push({
      buildingId: id,
      title: b.name,
      verb: KIND_VERB[b.kind] ?? "work",
      detail: [
        `${b.districtName} district · ${b.kind}`,
        `${b.loc} LOC · health: ${b.health}`,
        fn ? `entry fn: ${fn}()` : "delegates to the next hop",
      ],
    });
  }
  hops.push({
    landmark: "end",
    title: "200 OK · response returned",
    verb: "done",
    detail: ["The response retraces the chain", "back to the caller. Flow complete."],
  });
  return hops;
}

function stopsFor(curve: THREE.CatmullRomCurve3, L: CityLayout, flow: string, chain: string[]): Hop[] {
  const spec = MISSION_SPECS[flow] ?? autoSpec(chain, L);
  if (spec.length === 0) return [];
  const N = 480;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= N; i++) pts.push(curve.getPointAt(i / N));
  const uFor = (x: number, z: number) => {
    const t = new THREE.Vector3(x, 0, z);
    let best = 0, bd = Infinity;
    for (let i = 0; i <= N; i++) {
      const d = pts[i].distanceToSquared(t);
      if (d < bd) { bd = d; best = i; }
    }
    return best / N;
  };
  const hops: Hop[] = spec.map((h) => ({
    ...h,
    u: h.buildingId
      ? uFor(L.byId.get(h.buildingId)?.pos[0] ?? 0, L.byId.get(h.buildingId)?.pos[2] ?? 0)
      : h.landmark === "toll"
        ? uFor(L.toll.x, L.toll.z)
        : h.landmark === "start"
          ? 0
          : h.landmark === "end"
            ? 0.975 // final 200-OK report at the lane tip
            : 0, // unused
  }));
  // clamp inside the drivable range, THEN enforce strictly increasing stops
  for (const h of hops) h.u = THREE.MathUtils.clamp(h.u, 0, 0.975);
  let prev = -0.02; // breathing room between consecutive stops
  for (const h of hops) { h.u = Math.min(Math.max(h.u, prev + 0.04), 0.975); prev = h.u; }
  return hops;
}

const MISSION_CRUISE = 0.03;   // u/sec — a stately roll, ~½ lap per minute
const MISSION_DWELL = 3.4;     // sec paused under each gateway card (was 2.6)
// runtime fast-forward (2× button in the mission strip, or ?fm=1 on load)
// → verification speed: ~10× cruise, snap dwells

function MissionCar({ curve, L, flow = "login", chain, onEnd }: { curve: THREE.CatmullRomCurve3; L: CityLayout; flow?: string; chain: string[]; onEnd: () => void }) {
  const ref = useRef<THREE.Group>(null!);
  const u = useRef(0);
  const hopIdx = useRef(0);
  const phase = useRef<"drive" | "dwell" | "done-hold">("drive");
  const dwellT = useRef(0);
  const [, force] = useState(0); // re-render when the active hop changes
  const activeHop = useRef(-1);
  const hops = useMemo(() => stopsFor(curve, L, flow, chain), [curve, L, flow, chain]);
  // cinematic camera state — a low chase cam while driving, a slow arc around
  // the gateway while dwelling. Angles are absolute world-space so the arc is
  // stable no matter which direction the car approached from.
  const camA = useRef(0);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const hudAcc = useRef(0);
  const activeHopDirty = useRef(true);

  useEffect(() => () => {
    followTarget.active = false;
    followTarget.mission = false;
    delete (window as any).__mc; // probe hook outlives the mission otherwise
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    if (!ref.current || hops.length === 0) return;
    const ff = useCity.getState().fastForward;
    const M_CRUISE = ff ? 0.3 : MISSION_CRUISE;
    const M_DWELL = ff ? 0.25 : MISSION_DWELL;
    const hop = hops[Math.min(hopIdx.current, hops.length - 1)];

    if (phase.current === "drive") {
      const remain = hop.u - u.current;
      // decelerate into the gateway — glide, never brake-check
      const spd = remain < 0.05 ? M_CRUISE * Math.max(0.22, remain / 0.05) : M_CRUISE;
      u.current += dt * spd;
      if (u.current >= hop.u) { u.current = hop.u; phase.current = "dwell"; dwellT.current = 0; }
    } else if (phase.current === "dwell") {
      dwellT.current += dt;
      if (dwellT.current >= M_DWELL) {
        hopIdx.current += 1;
        if (hopIdx.current >= hops.length) { phase.current = "done-hold"; dwellT.current = 0; }
        else phase.current = "drive";
      }
    } else {
      dwellT.current += dt;
      if (dwellT.current > 3.2) { onEndRef.current(); return; }
    }

    if (activeHop.current !== Math.min(hopIdx.current, hops.length - 1)) {
      activeHop.current = Math.min(hopIdx.current, hops.length - 1);
      activeHopDirty.current = true;
      force((n) => n + 1);
    }

    // feed the bottom-center mission strip (DOM overlay in the HUD).
    // Progress patches are throttled to ~4 Hz so the strip never re-renders
    // per frame; hop changes push through immediately via idxNow.
    const idxNow = Math.min(hopIdx.current, hops.length - 1);
    const curHop = hops[idxNow];
    hudAcc.current += dt;
    if (hudAcc.current > 0.25 || activeHopDirty.current) {
      hudAcc.current = 0;
      activeHopDirty.current = false;
      const progress = +u.current.toFixed(3);
      useCity.setState((s) => {
        const prev = s.missionHud;
        if (prev && prev.idx === idxNow && Math.abs(prev.progress - progress) < 0.005) return s;
        return {
          ...s,
          missionHud: {
            flow,
            idx: idxNow,
            total: hops.length,
            title: curHop.title,
            verb: curHop.verb,
            detail: curHop.detail,
            progress,
          },
        };
      });
    }

    const uu = THREE.MathUtils.clamp(u.current, 0, 0.999);
    const p = curve.getPointAt(uu), tan = curve.getTangentAt(uu);
    ref.current.position.set(p.x, p.y, p.z);
    ref.current.lookAt(p.clone().add(tan));
    if (REVERSE_MODELS.has(VEHICLE_HERO)) ref.current.rotateY(Math.PI);

    // ── cinematic follow feed (mission flag mutes the ambient hero car) ──
    followTarget.mission = true;
    followTarget.active = true;
    followTarget.x = p.x;
    followTarget.z = p.z;
    const inv = 1 / (Math.hypot(tan.x, tan.z) || 1);
    if (phase.current === "drive") {
      // chase cam parked behind-left of the car, looking ahead down the lane
      followTarget.tx = tan.x * inv; followTarget.tz = tan.z * inv; followTarget.dwell = false;
    } else {
      // dwell: slow full orbit around THIS gateway, tilted down at the car
      camA.current += dt * 0.5; // ~12.5 s per lap > dwell, so it never loops visibly
      followTarget.tx = Math.cos(camA.current); followTarget.tz = Math.sin(camA.current);
      followTarget.dwell = true;
    }
    (window as any).__mc = { u: +u.current.toFixed(4), hop: hopIdx.current, phase: phase.current, dwell: +dwellT.current.toFixed(2), hops: hops.map((h) => +h.u.toFixed(3)) };
  });

  if (hops.length === 0) return null;

  // The explainer cards used to float above the car in 3D (distanceFactor=52)
  // where they collided with district labels and right-rail panels. They now
  // live in the HUD's bottom-center MissionStrip; the car keeps only its
  // beacon so eyes can track it while the strip explains the hop.
  return (
    <group ref={ref}>
      <GltfCar url={VEHICLE_HERO} color="#e11d48" />
      <Headlights flip={REVERSE_MODELS.has(VEHICLE_HERO)} />
      {/* request beacon */}
      <mesh position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.09, 10, 10]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.4 + ENV.night * 3} />
      </mesh>
    </group>
  );
}

/** emerald delivery truck: slow loop on the query edge (services → database platform) */
function Truck({ curve, offset }: { curve: THREE.CatmullRomCurve3; offset: number }) {
  const ref = useRef<THREE.Group>(null!);
  const laneLen = useMemo(() => curve.getLength(), [curve]);
  const t = useRef(((offset * laneLen) / 40) % 1);
  const url = useMemo(() => pick(VEHICLE_SLOW, offset * 777), [offset]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // clamp tab-switch/GC spikes → no teleporting actors
    // while a mission is running the courier is the star — ambient traffic crawls
    const factor = useCity.getState().mission != null ? 0.35 : 1;
    t.current = (t.current + (dt * SPEED.slow * 0.7 * factor) / laneLen) % 1;
    const p = curve.getPointAt(t.current), tan = curve.getTangentAt(t.current);
    ref.current.position.set(p.x, p.y, p.z);
    ref.current.lookAt(p.clone().add(tan));
  });
  return (
    <group ref={ref}>
      <GltfCar url={url} />
      <mesh position={[0, 0.85, -0.35]}>
        <boxGeometry args={[1.15, 0.9, 1.9]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.25} roughness={0.6} />
      </mesh>
      <Headlights />
    </group>
  );
}

export function Traffic({ L }: { L: CityLayout }) {
  const traffic = useCity((s) => s.traffic);
  const failing = useCity((s) => s.failing);
  const failingId = useCity((s) => s.failingId);
  // dispatched request → courier car (null when no mission is running)
  const mission = useCity((s) => s.mission);
  const endMission = useCity((s) => s.endMission);
  const missionKey = `${mission?.flow ?? "none"}#${mission?.startedAt ?? 0}`;

  // curves built reactively from the active city's flows. Hand-authored
  // flows (demo lanes) win; everything else is derived from the repo graph
  // so ANY endpoint a developer's app exposes can be run.
  const city = useCity((s) => s.city);
  const merged = useMemo(() => allFlows(city), [city]);
  const curves = useMemo(() => {
    const out: Record<string, THREE.CatmullRomCurve3 | null> = {};
    for (const [name, ids] of Object.entries(merged)) out[name] = makeCurve(L, name, ids as string[]);
    return out;
  }, [merged, L]);

  // followTarget ghost fix: deactivate when this layer unmounts
  useEffect(() => () => { followTarget.active = false; }, []);

  const failB = failingId ? L.byId.get(failingId) : L.byId.get("be-payctrl");
  return (
    <group>
      <TollGate x={L.toll.x} z={L.toll.z} lanes={[...L.toll.lanes]} open={!failing} />
      {traffic && <>
        {curves.login && <Car curve={curves.login} offset={0.1} hero />}
        {curves.login && <Car curve={curves.login} offset={0.6} color="#38bdf8" />}
        {curves.payment && <Car curve={curves.payment} offset={0.3} stuck={failing} color={failing ? "#ef4444" : "#facc15"} />}
        {curves.cart && <Car curve={curves.cart} offset={0.75} latencyKey="medium" />}
        {curves.payment && <Truck curve={curves.payment} offset={0.45} />}
        {curves.cart && <Truck curve={curves.cart} offset={0.15} />}
      </>}
      {/* the dispatched request itself — slow courier with floating detail cards */}
      {mission && curves[mission.flow] && (
        <MissionCar
          key={missionKey}
          curve={curves[mission.flow]!}
          L={L}
          flow={mission.flow}
          chain={(merged[mission.flow] ?? []) as string[]}
          onEnd={() => endMission()}
        />
      )}
      {failing && failB && (
        <group position={[failB.pos[0], 0, failB.pos[2]]}>
          <mesh position={[0, 7, 0]}><coneGeometry args={[0.8, 1.6, 4]} /><meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2} /></mesh>
          <Html center position={[0, 9, 0]}><div className="px-2 py-1 rounded-lg bg-red-600/90 text-white text-xs font-bold whitespace-nowrap backdrop-blur">⚠ 500 — {failB.name}</div></Html>
        </group>
      )}
      {/* roadblock on the lane in front of the Controllers district gate */}
      {failing && (
        <mesh position={[43, 0.55, -20]}>
          <boxGeometry args={[6.5, 1, 0.5]} />
          <meshStandardMaterial color="#f97316" emissive="#f97316" emissiveIntensity={0.7} />
        </mesh>
      )}
    </group>
  );
}

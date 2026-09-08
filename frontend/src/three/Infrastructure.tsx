import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Instances, Instance, Line, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { CityLayout } from "../lib/layout";
import { BRIDGE, roadClearance } from "../lib/layout";
import { useCity } from "../store/useCity";
import { ENV } from "./env";
import { grassTexture, asphaltTexture, groundTextures } from "./textures";
import { TREES, ROCKS, BUSHES_PLANTS, PROP, BARRIER, FENCE, CONE, pick } from "./assets";

const seg = (a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dz = b[1] - a[1]; return { len: Math.hypot(dx, dz), rot: -Math.atan2(dz, dx), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; };

export function Ground() {
  const underground = useCity((s) => s.underground);
  const canvasMap = useMemo(() => grassTexture(), []);
  const pbr = useMemo(() => groundTextures(), []);
  return (
    <group>
      {/* PBR photo grass — tinted a lively green instead of the old gray-green */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial {...pbr} color="#7fbf6a" transparent opacity={underground ? 0.12 : 1} roughness={1} normalScale={new THREE.Vector2(0.7, 0.7)} />
      </mesh>
      {/* riverbed under the shader water */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -20]}>
        <planeGeometry args={[13, 132]} />
        <meshStandardMaterial map={canvasMap} color="#1c2b3a" roughness={1} />
      </mesh>
      {/* sandy banks hugging both river edges so the water reads as a real river */}
      {[-6.4, 6.4].map((bx, i) => (
        <mesh key={`bank${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[bx, 0.02, -22]} receiveShadow>
          <planeGeometry args={[2.6, 112]} />
          <meshStandardMaterial color="#c9b284" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export function Roads({ L }: { L: CityLayout }) {
  const hw = useMemo(() => asphaltTexture(true), []), st = useMemo(() => asphaltTexture(false), []);
  const arterials = useMemo(() => L.dashes.filter((d) => d.size === "arterial"), [L]);
  const streets = useMemo(() => L.dashes.filter((d) => d.size === "street"), [L]);
  // readability pass: asphalt sits well below the grass tone now, and every
  // drivable surface (rings included) carries markings — no more gray-on-gray
  const ASPHALT_STREET = "#1a1d24";
  const ASPHALT_HWY = "#232830";
  return (
    <group>
      {L.roads.map((s, i) => { const p = seg(s.a, s.b); const t = (s.kind === "highway" ? hw : st).clone(); t.repeat.set(p.len / 8, s.kind === "highway" ? 1.6 : 0.8); t.needsUpdate = true; return (
        <mesh key={i} rotation={[-Math.PI / 2, 0, Math.atan2(-(s.b[1] - s.a[1]), s.b[0] - s.a[0])]} position={[p.mid[0], s.kind === "highway" ? 0.09 : 0.08, p.mid[1]]} receiveShadow>
          <planeGeometry args={[p.len, s.w]} /><meshStandardMaterial map={t} color={s.kind === "highway" ? ASPHALT_HWY : ASPHALT_STREET} roughness={0.95} />
        </mesh> ); })}
      {/* chunky centre-line on the avenues/highways */}
      <Instances limit={400} frustumCulled={false}>
        <planeGeometry args={[1.6, 0.18]} />
        <meshStandardMaterial color="#e8d9a0" emissive="#f59e0b" emissiveIntensity={ENV.night * 0.8} transparent opacity={0.85} />
        {arterials.map((d, i) => <Instance key={i} position={[d.p[0], 0.105, d.p[1]]} rotation={[0, d.rot, 0]} />)}
      </Instances>
      {/* thinner, dimmer markings on district ring roads */}
      <Instances limit={600} frustumCulled={false}>
        <planeGeometry args={[1.25, 0.11]} />
        <meshStandardMaterial color="#cdbf95" emissive="#f59e0b" emissiveIntensity={ENV.night * 0.4} transparent opacity={0.5} />
        {streets.map((d, i) => <Instance key={i} position={[d.p[0], 0.095, d.p[1]]} rotation={[0, d.rot, 0]} />)}
      </Instances>
      {/* zebra crosswalks at every gate stub */}
      <Instances limit={300} frustumCulled={false}>
        <planeGeometry args={[2.2, 0.34]} />
        <meshStandardMaterial color="#dfe4ea" roughness={0.9} transparent opacity={0.75} />
        {L.crossings.map((c, i) => <Instance key={i} position={[c.p[0], 0.1, c.p[1]]} rotation={[0, c.rot, 0]} />)}
      </Instances>
      {/* curbs — a 0.15 lip around each district ring road sells "real street" */}
      {L.districts.map((d, di) => {
        if (d.stack === "database") return null;
        const R = d.ringR + 1.45, D = d.ringD + 1.45;
        return (
          <group key={`curb${di}`} position={[d.center[0], 0, d.center[1]]}>
            {[[-D], [D]].map(([z], i) => (
              <mesh key={`h${i}`} position={[0, 0.07, z as number]} receiveShadow>
                <boxGeometry args={[R * 2 + 0.35, 0.14, 0.35]} />
                <meshStandardMaterial color="#3a4150" roughness={0.85} />
              </mesh>
            ))}
            {[[-R], [R]].map(([x], i) => (
              <mesh key={`v${i}`} position={[x as number, 0.07, 0]} receiveShadow>
                <boxGeometry args={[0.35, 0.14, D * 2 + 0.35]} />
                <meshStandardMaterial color="#3a4150" roughness={0.85} />
              </mesh>
            ))}
          </group>
        );
      })}
      {/* junction corner patches — hide the notch where avenue meets trunk */}
      {[[-42, -8], [42, -8]].map(([jx, jz], i) => (
        <mesh key={`j${i}`} rotation-x={-Math.PI / 2} position={[jx, 0.085, jz]} receiveShadow>
          <planeGeometry args={[5, 5]} />
          <meshStandardMaterial map={st.clone()} color={ASPHALT_HWY} roughness={0.95} />
        </mesh>
      ))}
      {L.bridges.map((z, i) => {
        // Slab geometry is derived from BRIDGE (lib/layout) — the same numbers
        // the vehicle lanes ride, so wheels and asphalt always agree.
        const rampAng = Math.atan2(BRIDGE.deckTop - BRIDGE.approachY, BRIDGE.rampRun);
        const rampCx = BRIDGE.halfSpan + BRIDGE.rampRun / 2;                       // 7.9
        const rampCy = (BRIDGE.deckTop + BRIDGE.approachY) / 2 - 0.13;             // slab center
        return (
        <group key={i} position={[0, 0, z]}>
          {/* approach ramps: road-y → deck-y, tilted TOWARD the deck */}
          <mesh position={[-rampCx, rampCy, 0]} rotation-z={rampAng} castShadow>
            <boxGeometry args={[BRIDGE.rampRun + 0.1, 0.26, 6.4]} />
            <meshStandardMaterial map={hw} />
          </mesh>
          <mesh position={[rampCx, rampCy, 0]} rotation-z={-rampAng} castShadow>
            <boxGeometry args={[BRIDGE.rampRun + 0.1, 0.26, 6.4]} />
            <meshStandardMaterial map={hw} />
          </mesh>
          {/* main deck — TOP surface exactly at BRIDGE.deckTop where lanes ride */}
          <mesh position={[0, BRIDGE.deckTop - 0.25, 0]} castShadow receiveShadow>
            <boxGeometry args={[BRIDGE.halfSpan * 2 + 0.2, 0.5, 6.4]} />
            <meshStandardMaterial map={hw} />
          </mesh>
          {/* piers — from the riverbed up to the deck underside */}
          {[-3.2, 3.2].map((px, pi) => (
            <mesh key={pi} position={[px, -0.2, 0]}>
              <cylinderGeometry args={[0.42, 0.5, 1.1, 10]} />
              <meshStandardMaterial color="#334155" />
            </mesh>
          ))}
          {/* railings + nav lights */}
          {[-3.05, 3.05].map((rz, ri) => (
            <mesh key={ri} position={[0, BRIDGE.deckTop + 0.2, rz]}>
              <boxGeometry args={[BRIDGE.halfSpan * 2 + 0.6, 0.32, 0.12]} />
              <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={1.4} />
            </mesh>
          ))}
          <mesh position={[-5.8, BRIDGE.deckTop + 0.62, 0]}><sphereGeometry args={[0.16, 8, 8]} /><meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2} /></mesh>
          <mesh position={[5.8, BRIDGE.deckTop + 0.62, 0]}><sphereGeometry args={[0.16, 8, 8]} /><meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={2} /></mesh>
        </group>);
      })}
    </group>
  );
}

export function Underground({ L }: { L: CityLayout }) {
  const on = useCity((s) => s.underground); if (!on) return null;
  return <group>{L.pipes.map((s, i) => { const p = seg(s.a, s.b); return (
    <mesh key={i} position={[p.mid[0], -1.5, p.mid[1]]} rotation={[0, Math.PI / 2 - p.rot, 0]}>
      <cylinderGeometry args={[0.35, 0.35, p.len, 8]} />
      <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={1.4} transparent opacity={0.8} />
    </mesh> ); })}</group>;
}

function GltfProp({ url, position, rot = 0, scale = 1 }: { url: string; position: [number, number, number]; rot?: number; scale?: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={position} rotation-y={rot} scale={scale}>
      <primitive object={cloned} />
    </group>
  );
}
/** variant for nesting inside an already-scaled/positioned group */
function GltfPropInline({ url, scale = 1 }: { url: string; scale?: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} scale={scale} />;
}
function GltfTreeInline({ seed }: { seed: number }) {
  const { scene } = useGLTF(pick(TREES, seed * 9973));
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} />;
}
/** small deterministic offset helper so props don't line up like soldiers */
const DRESS = (districtIdx: number, slot: number) => ((districtIdx * 7 + slot * 13) % 9) - 4;

function GltfTree({ pos, seed }: { pos: [number, number]; seed: number }) {
  const ref = useRef<THREE.Group>(null!);
  const url = pick(TREES, seed * 9973);
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const s = 1.4 + (seed % 1) * 1.2;
  return (
    <group ref={ref} position={[pos[0], 0, pos[1]]} rotation-y={seed * 7} scale={s}>
      <primitive object={cloned} />
    </group>
  );
}

export function Decor({ L }: { L: CityLayout }) {
  const failing = useCity((s) => s.failing);
  const lamp = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(() => { if (lamp.current) lamp.current.emissiveIntensity = 0.2 + ENV.night * 1.0; });
  const props = useMemo(() => {
    // dress the district corners with street furniture. Positions are relative
    // to each district's own RING (which grows with content) and every spot is
    // rejected if it lands on any drivable surface — furniture beside roads,
    // never on them.
    const out: { url: string; p: [number, number]; rot: number }[] = [];
    const push = (url: string, x: number, z: number, rot: number) => {
      if (roadClearance(L, x, z) < 0.9) return; // would stand on asphalt
      out.push({ url, p: [x, z], rot });
    };
    L.districts.forEach((d, di) => {
      if (d.stack === "database") return;
      // sidewalk cluster on the WEST lawn, strictly outside ring + curb
      const wx = d.center[0] - d.ringR;
      push(PROP.bench, wx - 5.2, d.center[1] + DRESS(di, 0), Math.PI / 2);
      push(PROP.hydrant, wx - 4.2, d.center[1] - DRESS(di, 1), 0);
      push(PROP.trashBin, wx - 3.4, d.center[1] - DRESS(di, 2), 0);
      push(PROP.mailbox, wx - 2.6, d.center[1] + DRESS(di, 3), -Math.PI / 3);
      if (di % 2 === 0) push(PROP.phoneBooth, d.center[0], d.center[1] + d.ringD + 3.4, 0);
      else push(PROP.kiosk, d.center[0], d.center[1] - d.ringD - 3.4, Math.PI);
    });
    // plaza on the database platform
    out.push({ url: PROP.fountain, p: [0, 61], rot: 0 });
    out.push({ url: PROP.bench, p: [-7, 63.5], rot: Math.PI / 2 });
    out.push({ url: PROP.bench, p: [7, 63.5], rot: Math.PI / 2 });
    out.push({ url: PROP.planter, p: [-14, 58.5], rot: 0 });
    out.push({ url: PROP.planter, p: [14, 58.5], rot: 0 });
    out.push({ url: PROP.billboard, p: [-30, 30], rot: Math.PI / 4 });
    push(PROP.busStop, -46.8, -26, Math.PI / 2);
    push(PROP.trafficLight, 46.8, -26, -Math.PI / 2);
    push(PROP.bollard, -3, 55, 0);
    push(PROP.bollard, 3, 55, 0);
    return out;
  }, [L]);
  const scatter = useMemo(() => {
    // nature scatter around the map edges & between districts — never on roads
    const out: { kind: "tree" | "rock" | "bush"; x: number; z: number; s: number; seed: number }[] = [];
    for (let i = 0; i < 90; i++) {
      const ang = (i / 90) * Math.PI * 2 + 0.13;
      const r = 62 + ((i * 37) % 40);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r * 0.85;
      if (roadClearance(L, x, z) < 1.0) continue;
      out.push({ kind: i % 5 === 0 ? "rock" : i % 5 === 1 ? "bush" : "tree", x, z, s: 0.8 + ((i * 17) % 10) / 10, seed: i * 0.618 });
    }
    return out;
  }, [L]);
  return (
    <group>
      {L.trees.map((t, i) => <GltfTree key={i} pos={t} seed={i * 0.173 + 0.41} />)}
      {scatter.map((s, i) => (
        <group key={`s${i}`} position={[s.x, 0, s.z]} rotation-y={s.seed * 9} scale={s.s}>
          {s.kind === "tree" && <GltfTreeInline seed={s.seed} />}
          {s.kind === "rock" && <GltfPropInline url={pick(ROCKS, s.seed * 99)} scale={0.8} />}
          {s.kind === "bush" && <GltfPropInline url={pick(BUSHES_PLANTS, s.seed * 77)} />}
        </group>
      ))}
      {props.map((pr, i) => <GltfProp key={`p${i}`} url={pr.url} position={[pr.p[0], 0, pr.p[1]]} rot={pr.rot} />)}
      {failing && (
        <group>
          {/* construction site at the failing payment building */}
          <GltfProp url={BARRIER} position={[-3, 0, -3]} rot={0.4} />
          <GltfProp url={BARRIER} position={[3, 0, -4]} rot={-0.8} />
          <GltfProp url={CONE} position={[-1.5, 0, 3]} rot={0} />
          <GltfProp url={CONE} position={[2.2, 0, 2.4]} rot={1.2} />
          <GltfProp url={FENCE} position={[0, 0, -6]} rot={0} />
        </group>
      )}
      <Instances limit={100}><cylinderGeometry args={[0.07, 0.09, 3, 6]} /><meshStandardMaterial color="#8b94a3" metalness={0.6} roughness={0.4} />{L.lamps.map((t, i) => <Instance key={i} position={[t[0], 1.5, t[1]]} />)}</Instances>
      <Instances limit={100}><sphereGeometry args={[0.18, 10, 10]} /><meshStandardMaterial ref={lamp} color="#fef9c3" emissive="#ffcf7a" emissiveIntensity={1} />{L.lamps.map((t, i) => <Instance key={i} position={[t[0], 3.1, t[1]]} />)}</Instances>
    </group>
  );
}

export function Links({ L }: { L: CityLayout }) {
  const on = useCity((s) => s.links);
  const edges = useCity((s) => s.city.edges); // LIVE edges — updates when a repo loads
  if (!on) return null;
  const COLORS = { http: "#22d3ee", query: "#4ade80", import: "#94a3b8" };
  return (
    <group>
      {(edges ?? []).map((e, i) => {
        const a = L.byId.get(e.from), b = L.byId.get(e.to); if (!a || !b) return null;
        const A = new THREE.Vector3(a.pos[0], 2, a.pos[2]), B = new THREE.Vector3(b.pos[0], 2, b.pos[2]);
        const mid = A.clone().lerp(B, 0.5); mid.y = 6 + A.distanceTo(B) * 0.18;
        const pts = new THREE.QuadraticBezierCurve3(A, mid, B).getPoints(24);
        return <Line key={i} points={pts} color={COLORS[e.kind]} lineWidth={1.2} transparent opacity={0.55} />;
      })}
    </group>
  );
}

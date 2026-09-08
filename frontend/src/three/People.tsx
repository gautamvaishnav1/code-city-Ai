import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import type { CityLayout } from "../lib/layout";
import { BRIDGE } from "../lib/layout";
import { ENV } from "./env";
import { SOLDIER, CHARACTERS } from "./assets";

const OUTFITS = ["#ef4444", "#f59e0b", "#f472b6", "#22c55e", "#3b82f6", "#a78bfa", "#fb7185", "#fde047"];
const UMBRELLAS = ["#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6"];
/** commuter uniform colors — match the stack they walk toward */
const STACK_TINT: Record<string, string> = {
  frontend: "#38bdf8", backend: "#fb923c", database: "#34d399", external: "#22d3ee",
};

/** Animated pedestrian: Soldier.glb Walk clip, ping-pongs along a sidewalk path. */
function Walker({ a, b, seed, tint }: { a: [number, number]; b: [number, number]; seed: number; tint?: string }) {
  const ref = useRef<THREE.Group>(null!);
  const umb = useRef<THREE.Group>(null!);
  const { scene, animations } = useGLTF(SOLDIER);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  // bright outfit: tint every material on this clone
  const outfit = tint ?? OUTFITS[Math.floor(seed * 97) % OUTFITS.length];
  useMemo(() => {
    cloned.traverse((o: any) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        if (o.material.color) o.material.color.lerp(new THREE.Color(outfit), 0.5);
      }
    });
  }, [cloned, outfit]);
  const { actions, names } = useAnimations(animations, ref);
  const weather = useCitySafe();
  const speed = 0.55 + (seed % 1) * 0.45;
  const t = useRef(seed * 10);

  useMemo(() => {
    const clip = names.find((n) => /walk/i.test(n));
    if (clip && actions[clip]) { actions[clip].play(); (actions[clip] as any).timeScale = 1; }
  }, [actions, names]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // clamp tab-switch/GC spikes → no teleporting actors
    t.current += dt * speed;
    const wave = Math.sin(t.current * 0.5);
    const u = (wave + 1) / 2;
    const dir = Math.cos(t.current * 0.5) >= 0 ? 1 : -1;
    const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
    ref.current.position.set(x, 0.02, z);
    const dx = b[0] - a[0], dz = b[1] - a[1];
    // face travel direction: flip when the ping-pong reverses. The Soldier's
    // nose points at −Z (visor + toes measured on the −Z side), so add π —
    // atan2 alone aims +Z and made everyone moonwalk backwards.
    ref.current.rotation.y = Math.atan2(dx * dir, dz * dir) + Math.PI;
    if (umb.current) umb.current.rotation.z = ENV.wind * 0.35;
  });

  return (
    <group ref={ref} position={[a[0], 0.02, a[1]]} scale={1.25}>
      <primitive object={cloned} />
      {weather !== "clear" && weather !== "fog" && (
        <group ref={umb} position={[0, 1.75, 0]} scale={1}>
          <mesh><cylinderGeometry args={[0.02, 0.02, 0.6, 6]} /><meshStandardMaterial color="#334155" /></mesh>
          <mesh position={[0, 0.28, 0]}><coneGeometry args={[0.55, 0.35, 8]} /><meshStandardMaterial color={UMBRELLAS[Math.floor(seed * 90) % 4]} /></mesh>
        </group>
      )}
    </group>
  );
}

// tiny hook shim so the file has no import cycle risk
import { useCity } from "../store/useCity";
function useCitySafe() { return useCity((s: any) => s.weather); }

/** Static blocky character with idle animation from the Kenney pack. */
function Bystander({ pos, seed }: { pos: [number, number]; mid?: boolean; seed: number }) {
  const ref = useRef<THREE.Group>(null!);
  const url = CHARACTERS[Math.floor(seed * 9973) % CHARACTERS.length];
  const { scene, animations } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  // limb pivots at hips/shoulders so idle clips bend limbs instead of the whole body
  useMemo(() => {
    const outfit = OUTFITS[Math.floor(seed * 31) % OUTFITS.length];
    cloned.traverse((o: any) => {
      if (o.isMesh) {
        // clone geometry so per-instance material tinting never mutates the
        // cached GLB. Do NOT translate it — the Kenney rig already has its
        // feet at y=0, and shifting the mesh down sank every bystander 0.2
        // into the ground (the "sinking characters" bug).
        o.geometry = (o.geometry as THREE.BufferGeometry).clone();
        o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m: any) => {
          const c = m.clone(); if (c.color) c.color.lerp(new THREE.Color(outfit), 0.45);
          return c;
        });
      }
    });
  }, [cloned, seed]);
  const { actions, names } = useAnimations(animations, cloned);
  useMemo(() => {
    const clip = names.find((n) => /idle|wave/i.test(n)) ?? names[0];
    if (clip && actions[clip]) actions[clip].play();
  }, [actions, names]);
  return (
    <group ref={ref} position={[pos[0], 0.02, pos[1]]} rotation-y={seed * Math.PI * 2} scale={1.25}>
      <primitive object={cloned} />
    </group>
  );
}

export function People({ L }: { L: CityLayout }) {
  const paths = [
    ...L.people.map((p) => [p.a, p.b] as const),
    // 2 extra walkers per avenue — on the SIDWALKS beside the asphalt,
    // never down the middle of the road
    [[-46.6, -20], [-46.6, 30]] as const,
    [[-46.6, 10], [-46.6, 52]] as const,
    [[46.6, -14], [46.6, 34]] as const,
    [[46.6, 8], [46.6, 44]] as const,
    // bridge crossing at deck height
    [[-6, -8], [6, -8], BRIDGE.deckTop + 0.12] as any,
  ];
  const spots = useMemo(() => {
    const out: [number, number][] = [];
    L.districts.forEach((d) => { out.push([d.center[0] + 14.6, d.center[1] + 8], [d.center[0] - 14.6, d.center[1] - 9]); });
    return out;
  }, [L]);
  const avenueWalkers = useMemo(
    () => [
      { a: [-46.6, -26], b: [-46.6, 49] },
      { a: [46.6, -26], b: [46.6, 41] },
      { a: [-20, -12.2], b: [-64, -12.2] },  // trunk west of river (south sidewalk)
      { a: [20, -12.2], b: [64, -12.2] },    // trunk east of river
    ],
    [],
  );

  return (
    <group>
      {paths.map((p, i) =>
        p.length === 3 ? (
          <BridgeWalker key={`bw${i}`} a={p[0] as any} b={p[1] as any} y={(p as any)[2]} seed={i * 0.37 + 0.13} />
        ) : (
          <Walker key={i} a={p[0] as any} b={p[1] as any} seed={i * 0.37 + 0.13}
            tint={(L.districts[i % L.districts.length]?.stack && STACK_TINT[L.districts[i % L.districts.length].stack]) || undefined} />
        ),
      )}
      {/* avenue commuters — orange (backend) & sky (frontend) uniforms */}
      {avenueWalkers.map((w, i) => <Walker key={`av${i}`} a={w.a as any} b={w.b as any} seed={i * 0.53 + 0.07} tint={(i % 2 ? STACK_TINT.backend : STACK_TINT.frontend) as string} />)}
      {spots.map((s, i) => <Bystander key={`s${i}`} pos={s} seed={i * 0.61 + 0.29} />)}
    </group>
  );
}

/** pedestrian on the bridge deck — walks the span at deck height (BRIDGE is
    the single source of truth; this used to hardcode the old 1.75 deck and
    pedestrians strolled through mid-air / the river) */
function BridgeWalker({ a, b, y, seed }: { a: [number, number]; b: [number, number]; y: number; seed: number }) {
  const ref = useRef<THREE.Group>(null!);
  const { scene, animations } = useGLTF(SOLDIER);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const { actions, names } = useAnimations(animations, ref);
  const speed = 0.35 + (seed % 1) * 0.2;
  const t = useRef(seed * 7);
  useMemo(() => {
    const clip = names.find((n) => /walk/i.test(n));
    if (clip && actions[clip]) actions[clip].play();
  }, [actions, names]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // clamp tab-switch/GC spikes → no teleporting actors
    t.current += dt * speed;
    const u = (Math.sin(t.current * 0.5) + 1) / 2;
    ref.current.position.set(a[0] + (b[0] - a[0]) * u, y, a[1] + (b[1] - a[1]) * u);
    // Soldier's nose is at −Z → +π so the bridge walker faces forward, not back
    ref.current.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI;
  });
  return (
    <group ref={ref} position={[a[0], y, a[1]]} scale={1.25}>
      <primitive object={cloned} />
    </group>
  );
}

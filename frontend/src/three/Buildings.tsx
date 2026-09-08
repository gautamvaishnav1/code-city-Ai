import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges, Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { LaidBuilding, LaidDistrict } from "../lib/layout";
import { STACK_ACCENT } from "../lib/layout";
import type { Kind, Stack } from "../types";
import { useCity } from "../store/useCity";
import { ENV } from "./env";
import { facadeTexture, roofTexture, sidewalkTexture } from "./textures";
import { SKYSCRAPERS, CHIMNEYS, TANKS, pick } from "./assets";

/** kind → facade recipe */
const STYLE: Record<Kind, { base: string; style: "concrete" | "brick" | "glass" | "metal"; lit: number }> = {
  page: { base: "#3d4f6b", style: "glass", lit: 0.7 },
  component: { base: "#425573", style: "glass", lit: 0.6 },
  context: { base: "#4d5665", style: "concrete", lit: 0.5 },
  route: { base: "#6b4a3a", style: "brick", lit: 0.45 },
  controller: { base: "#59616f", style: "concrete", lit: 0.55 },
  service: { base: "#4a5361", style: "metal", lit: 0.6 },
  middleware: { base: "#5d5347", style: "brick", lit: 0.5 },
  model: { base: "#46505c", style: "metal", lit: 0.4 },
  api: { base: "#2c4a68", style: "glass", lit: 0.75 },
};
const FOOTPRINT: Record<Kind, number> = {
  page: 4.2, component: 4.2, context: 4.6, route: 3.6, controller: 5,
  service: 5, middleware: 3.6, model: 6.4, api: 3,
};

// ─── module-level shared materials (built once per page load) ───────────────
const SIDEWALK = sidewalkTexture();
const ROOF = new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.95 });
const PLINTH = new THREE.MeshStandardMaterial({ map: SIDEWALK, roughness: 1 });
const NIGHT_MATS: THREE.MeshStandardMaterial[] = [];
const TRIM_MATS: THREE.MeshStandardMaterial[] = [];
const plinthTintCache = new Map<Stack, THREE.MeshStandardMaterial>();
/** subtle per-stack ground tint so every district reads as its own neighbourhood */
function plinthTint(stack: Stack): THREE.MeshStandardMaterial {
  let m = plinthTintCache.get(stack);
  if (!m) {
    m = PLINTH.clone();
    m.color = new THREE.Color(STACK_ACCENT[stack]).lerp(new THREE.Color("#8f9aa8"), 0.72);
    plinthTintCache.set(stack, m);
  }
  return m;
}

const facadeCache = new Map<Kind, THREE.MeshStandardMaterial[]>();

function facadeMats(kind: Kind): THREE.MeshStandardMaterial[] {
  let m = facadeCache.get(kind);
  if (!m) {
    const r = STYLE[kind];
    const f = facadeTexture(r.base, r.style, r.lit);
    const side = new THREE.MeshStandardMaterial({
      map: f.map,
      emissiveMap: f.emissive,
      emissive: new THREE.Color(r.style === "glass" ? "#bfe3ff" : "#ffdfae"),
      emissiveIntensity: 0.5,
      roughness: 0.85,
      metalness: r.style === "metal" ? 0.35 : 0.05,
    });
    NIGHT_MATS.push(side);
    // boxGeometry face order: +x, -x, +y(top), -y(bottom), +z, -z
    m = [side, side, ROOF, side, side, side];
    facadeCache.set(kind, m);
  }
  return m;
}

/** drives every registered facade's window glow from the clock */
export function NightMaterials() {
  useFrame(() => {
    const e = 0.15 + ENV.night * 1.5;
    for (const m of NIGHT_MATS) m.emissiveIntensity = e;
    const t = 0.25 + ENV.night * 1.1;
    for (const m of TRIM_MATS) m.emissiveIntensity = t;
  });
  return null;
}

/** FNV-1a — deterministic silhouette per building id */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** distance-based DOM fade for Html labels — far away only district names
 *  survive; labels never pop in/out, they melt away. Zero re-renders. */
function useDistanceFade(getDist: (cam: THREE.Camera) => number, near: number, far: number) {
  const ref = useRef<HTMLDivElement>(null!);
  useFrame(({ camera }) => {
    const el = ref.current;
    if (!el) return;
    const d = getDist(camera);
    el.style.opacity = String(THREE.MathUtils.clamp((far - d) / (far - near), 0, 1));
  });
  return ref;
}

function GltfBuilding({ url, h, fp }: { url: string; h: number; fp: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  // normalize height: measure bbox, scale so building is `h` tall and fits `fp` wide
  const box = useMemo(() => new THREE.Box3().setFromObject(cloned), [cloned]);
  const rawH = Math.max(0.01, box.max.y - box.min.y);
  const rawW = Math.max(0.01, box.max.x - box.min.x, box.max.z - box.min.z);
  const s = h / rawH;
  return <primitive object={cloned} scale={[Math.min(s, (fp * 1.9) / rawW), s, Math.min(s, (fp * 1.9) / rawW)]} />;
}

export function District({ d }: { d: LaidDistrict }) {
  const isDb = d.stack === "database";
  // slab now hugs the content-fitted ring so big districts keep their ground
  const slab = useMemo((): [number, number] => (isDb ? [46, 14] : [d.ringR * 2 + 5, d.ringD * 2 + 5]), [isDb, d.ringR, d.ringD]);
  const labelY = isDb ? 3 : 12;
  const accent = STACK_ACCENT[d.stack];
  const trimMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: new THREE.Color(accent),
      emissiveIntensity: 1,
      roughness: 0.6,
    });
    TRIM_MATS.push(m);
    return m;
  }, [accent]);
  const worldLabelPos = useMemo(
    () => new THREE.Vector3(d.center[0], labelY, d.center[1] - slab[1] / 2 + 1),
    [d.center, labelY, slab],
  );
  const labelRef = useDistanceFade(
    (cam) => cam.position.distanceTo(worldLabelPos),
    110,
    150,
  );

  return (
    <group position={[d.center[0], 0, d.center[1]]}>
      <mesh position={[0, 0.25, 0]} receiveShadow material={plinthTint(d.stack)}>
        <boxGeometry args={[slab[0], 0.5, slab[1]]} />
      </mesh>
      {/* identity trim — a thin glow strip around the slab's top edge */}
      {!isDb && (
        <group position={[0, 0.52, 0]}>
          <mesh position={[0, 0, -slab[1] / 2 + 0.15]} material={trimMat}>
            <boxGeometry args={[slab[0], 0.12, 0.3]} />
          </mesh>
          <mesh position={[0, 0, slab[1] / 2 - 0.15]} material={trimMat}>
            <boxGeometry args={[slab[0], 0.12, 0.3]} />
          </mesh>
          <mesh position={[-slab[0] / 2 + 0.15, 0, 0]} material={trimMat}>
            <boxGeometry args={[0.3, 0.12, slab[1]]} />
          </mesh>
          <mesh position={[slab[0] / 2 - 0.15, 0, 0]} material={trimMat}>
            <boxGeometry args={[0.3, 0.12, slab[1]]} />
          </mesh>
        </group>
      )}
      {/* DOM label — drei <Text> spawns a WebGL context per SDF atlas and
          26 of them blew Chrome's context budget, killing the scene (black screen).
          Fades out beyond ~110 world units so distant views stay uncluttered. */}
      <Html center position={[0, labelY, -slab[1] / 2 + 1]} distanceFactor={90} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
        <div
          ref={labelRef}
          className="whitespace-nowrap rounded-md border bg-black/60 px-2 py-0.5 text-[11px] font-bold tracking-[0.15em]"
          style={{ borderColor: `${accent}40`, color: "#dbeafe" }}
        >
          {d.name.toUpperCase()}
        </div>
      </Html>
    </group>
  );
}

export function Building({ b }: { b: LaidBuilding }) {
  const selected = useCity((s) => s.selectedId === b.id);
  const select = useCity((s) => s.select); const setFocus = useCity((s) => s.setFocus);
  const [hover, setHover] = useState(false);
  const ring = useRef<THREE.MeshBasicMaterial>(null!);
  useFrame(({ clock }) => { if (ring.current) ring.current.opacity = 0.5 + Math.sin(clock.elapsedTime * 5) * 0.3; });

  const warehouse = b.kind === "model", tower = b.kind === "api";
  const h = warehouse ? b.h * 0.55 : tower ? b.h * 1.35 : b.h;
  const fp = FOOTPRINT[b.kind];
  const mats = facadeMats(b.kind);
  // silhouette archetype — same materials, different massing so the skyline
  // stops repeating identical boxes (hash of the id keeps it deterministic)
  const arch = tower || warehouse ? -1 : hashStr(b.id) % 4;
  const roofPropMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#6b7280", roughness: 0.8 }),
    [],
  );
  // labels melt away when the camera pulls back — decluttered far views
  const hoverLabelRef = useDistanceFade(
    (cam) => Math.hypot(cam.position.x - b.pos[0], cam.position.z - b.pos[2]),
    70,
    95,
  );
  const selLabelRef = useDistanceFade(
    (cam) => Math.hypot(cam.position.x - b.pos[0], cam.position.z - b.pos[2]),
    80,
    110,
  );

  return (
    <group position={b.pos}>
      <group
        onClick={(e) => { e.stopPropagation(); select(b.id); setFocus(b.pos[0], b.pos[2]); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = "auto"; }}
      >
        {tower ? (
          <GltfBuilding url={pick(SKYSCRAPERS, b.pos[0] * 31 + b.pos[2])} h={h} fp={fp} />
        ) : arch === 1 ? (
          <group>
            {/* setback tower: 70% base + 40% upper footprint */}
            <mesh position={[0, (h * 0.68) / 2, 0]} castShadow receiveShadow material={mats}>
              <boxGeometry args={[fp, h * 0.68, fp]} />
            </mesh>
            <mesh position={[0, h * 0.68 + (h * 0.42) / 2, 0]} castShadow receiveShadow material={mats}>
              <boxGeometry args={[fp * 0.55, h * 0.42, fp * 0.55]} />
            </mesh>
          </group>
        ) : arch === 2 ? (
          <group>
            {/* slab block with rooftop props */}
            <mesh position={[0, (h * 0.8) / 2, 0]} castShadow receiveShadow material={mats}>
              <boxGeometry args={[fp * 1.02, h * 0.8, fp * 0.78]} />
            </mesh>
            <mesh position={[fp * 0.22, h * 0.8 + 0.28, -fp * 0.12]} material={roofPropMat} castShadow>
              <boxGeometry args={[fp * 0.26, 0.56, fp * 0.26]} />
            </mesh>
            <mesh position={[-fp * 0.24, h * 0.8 + 0.34, fp * 0.1]} material={roofPropMat} castShadow>
              <cylinderGeometry args={[fp * 0.14, fp * 0.14, 0.68, 10]} />
            </mesh>
            <mesh position={[0, h * 0.8 + 0.75, fp * 0.22]} material={roofPropMat}>
              <cylinderGeometry args={[0.05, 0.05, 1.5, 6]} />
            </mesh>
          </group>
        ) : arch === 3 ? (
          <group>
            {/* L-shaped pair */}
            <mesh position={[0, h / 2, -fp * 0.22]} castShadow receiveShadow material={mats}>
              <boxGeometry args={[fp, h, fp * 0.52]} />
            </mesh>
            <mesh position={[fp * 0.24, (h * 0.85) / 2, fp * 0.24]} castShadow receiveShadow material={mats}>
              <boxGeometry args={[fp * 0.52, h * 0.85, fp * 0.48]} />
            </mesh>
          </group>
        ) : (
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow material={mats}>
            <boxGeometry args={[fp, h, fp]} />
          </mesh>
        )}
        {(hover || selected) && (
          <mesh position={[0, h / 2, 0]}>
            <boxGeometry args={[fp * 1.05, h * 1.02, fp * 1.05]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        )}
      </group>
      {/* invisible click proxy — reliable hit target regardless of visuals */}
      {!hover && !selected && (
        <mesh position={[0, h / 2, 0]} visible={false}>
          <boxGeometry args={[fp, h, fp]} />
          <meshBasicMaterial />
        </mesh>
      )}
      {(hover || selected) && (
        <Edges color={b.health === "ok" ? "#22d3ee" : "#f87171"}>
          <boxGeometry args={[fp * 1.02, h * 1.02, fp * 1.02]} />
        </Edges>
      )}
      {warehouse && <GltfBuilding url={pick(TANKS, b.pos[0])} h={h * 0.35} fp={fp * 0.5} />}
      {(b.kind === "service" || b.kind === "controller") && <GltfBuilding url={pick(CHIMNEYS, b.pos[2])} h={h * 0.8} fp={1.2} />}
      {tower && <mesh position={[0, h + 1.6, 0]}><cylinderGeometry args={[0.06, 0.06, 2.2, 6]} /><meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={2} /></mesh>}
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.62, 0]}>
          <ringGeometry args={[3.2, 3.9, 40]} /><meshBasicMaterial ref={ring} color="#22d3ee" transparent depthWrite={false} />
        </mesh>)}
      {hover && (
        <Html center distanceFactor={55} position={[0, h + 1.6, 0]} style={{ pointerEvents: "none" }}>
          <div ref={hoverLabelRef} className="px-2 py-1 rounded-lg glass text-xs whitespace-nowrap border border-cyan-400/30">
            {b.name} · {b.kind} · {b.loc} LOC
          </div>
        </Html>
      )}
      {selected && (
        <Html center position={[0, h + 3.2, 0]} distanceFactor={55} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
          <div ref={selLabelRef} className="whitespace-nowrap rounded-md border border-cyan-400/40 bg-black/70 px-2 py-0.5 text-xs font-bold text-white">{b.name}</div>
        </Html>
      )}
    </group>
  );
}

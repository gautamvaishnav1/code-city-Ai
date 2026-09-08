import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { SUBURBAN, TREES, BUSHES_PLANTS, ROCKS, pick } from "./assets";

/** deterministic PRNG so the greenery layout is stable across reloads */
const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function Gltf({ url, position, rot = 0, scale = 1 }: { url: string; position: [number, number, number]; rot?: number; scale?: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={position} rotation-y={rot} scale={scale}>
      <primitive object={cloned} />
    </group>
  );
}

/**
 * Greenery + "sub buildings": a small residential suburb on the west (left)
 * bank, riverbank trees, and bushes/grass/rocks scattered across the lawns —
 * makes the world feel lived-in instead of an empty gray plain.
 */
export function Greenery() {
  const rnd = useMemo(() => mulberry(20260823), []);

  // ── suburb: small houses on the south-west lawn, clear of the avenues ──
  const houses = useMemo(() => {
    const out: { url: string; p: [number, number, number]; rot: number; s: number }[] = [];
    const rows = [
      { z: 14, x0: -88, n: 4 },
      { z: 24, x0: -84, n: 4 },
      { z: 34, x0: -88, n: 4 },
      { z: 44, x0: -82, n: 3 },
    ];
    let i = 0;
    for (const row of rows) {
      for (let k = 0; k < row.n; k++) {
        const x = row.x0 + k * 9 + (rnd() - 0.5) * 2.5;
        const z = row.z + (rnd() - 0.5) * 3;
        out.push({
          url: pick(SUBURBAN, i * 7.13),
          p: [x, 0, z],
          rot: (rnd() - 0.5) * 0.5 + (k % 2 ? Math.PI : 0),
          s: 2.6 + rnd() * 1.4,
        });
        i++;
      }
    }
    return out;
  }, [rnd]);

  // ── riverbank trees: line both banks of the river ──
  const bankTrees = useMemo(() => {
    const out: { url: string; p: [number, number, number]; s: number; rot: number }[] = [];
    for (let z = -70; z <= 28; z += 9) {
      // keep clear of the bridge deck + toll plaza around z=-8
      if (Math.abs(z + 8) < 7) continue;
      // west bank
      out.push({ url: pick(TREES, z * 1.7), p: [-8.5 + (rnd() - 0.5) * 1.5, 0, z + (rnd() - 0.5) * 3], s: 1.1 + rnd() * 0.9, rot: rnd() * 6.28 });
      // east bank
      out.push({ url: pick(TREES, z * 2.3 + 5), p: [8.5 + (rnd() - 0.5) * 1.5, 0, z + (rnd() - 0.5) * 3], s: 1.1 + rnd() * 0.9, rot: rnd() * 6.28 });
    }
    return out;
  }, [rnd]);

  // ── bushes, grass tufts and rocks across the west lawn + near the suburb ──
  const scatter = useMemo(() => {
    const out: { kind: "bush" | "grass" | "rock"; p: [number, number, number]; s: number; rot: number }[] = [];
    for (let i = 0; i < 70; i++) {
      const x = -95 + rnd() * 88; // west half, up to the west avenue
      const z = -30 + rnd() * 82;
      // keep off the highway corridors (west avenue x≈-42, trunk z≈-8)
      if (Math.abs(x + 42) < 4.5) continue;
      if (Math.abs(z + 8) < 7 && x > -50) continue;
      // keep out of the district belt — nothing may spawn on district ring
      // roads or their sidewalks (props belong NEAR roads, never ON them)
      if (x > -72 && z < -4) continue;
      const r = rnd();
      out.push({
        kind: r < 0.5 ? "bush" : r < 0.82 ? "grass" : "rock",
        p: [x, 0, z],
        s: 0.7 + rnd() * 1.1,
        rot: rnd() * 6.28,
      });
    }
    return out;
  }, [rnd]);

  // ── green ground patches: soft darker-green discs to break up the lawn ──
  const patches = useMemo(() => {
    const out: { p: [number, number, number]; r: number }[] = [];
    for (let i = 0; i < 26; i++) {
      const x = -98 + rnd() * 92;
      const z = -32 + rnd() * 86;
      if (Math.abs(x + 42) < 5) continue;
      if (Math.abs(z + 8) < 6 && x > -50) continue; // trunk corridor
      if (x > -72 && z < -4) continue; // district belt
      out.push({ p: [x, 0.015, z], r: 3 + rnd() * 6 });
    }
    return out;
  }, [rnd]);

  return (
    <group>
      {/* darker-green lawn patches */}
      {patches.map((pt, i) => (
        <mesh key={`pt${i}`} rotation-x={-Math.PI / 2} position={pt.p}>
          <circleGeometry args={[pt.r, 20]} />
          <meshStandardMaterial color="#5fae4e" roughness={1} transparent opacity={0.55} />
        </mesh>
      ))}
      {/* suburb houses */}
      {houses.map((h, i) => (
        <Gltf key={`h${i}`} url={h.url} position={h.p} rot={h.rot} scale={h.s} />
      ))}
      {/* riverbank trees */}
      {bankTrees.map((t, i) => (
        <Gltf key={`bt${i}`} url={t.url} position={t.p} rot={t.rot} scale={t.s} />
      ))}
      {/* bushes / grass / rocks */}
      {scatter.map((s, i) => (
        <Gltf
          key={`sc${i}`}
          url={s.kind === "bush" ? pick(BUSHES_PLANTS, i * 3.7) : s.kind === "grass" ? pick(BUSHES_PLANTS.slice(4), i * 5.1) : pick(ROCKS, i * 2.9)}
          position={s.p}
          rot={s.rot}
          scale={s.s}
        />
      ))}
    </group>
  );
}

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useAuth } from "../lib/auth";

const INK = new THREE.Color("#141414");
const SIGNAL = new THREE.Color("#e30613");

/**
 * JWT TOLL PLAZA — the western approach to the bridge is a paid (authenticated)
 * road. Traffic crosses eastbound in a single channeled lane (all three flow
 * lanes merge onto the trunk at z = toll.z, so the plaza is centered on that
 * lane). Divider islands run ALONG traffic (long in X) so cars never clip
 * them, and the barrier arm lifts only for signed-in drivers.
 */
export function TollGate({ x, z, lanes, open }: { x: number; z: number; lanes: number[]; open: boolean }) {
  const token = useAuth((s) => s.token);
  // arms lift with traffic flow; the LAMP + SIGN carry the auth state
  const lifted = open;

  return (
    <group position={[x, 0, z]}>
      {/* plaza apron — sits just ABOVE the road slab so the plaza reads as one
          continuous surface instead of patchwork (the old apron was below the
          road and poked out around its edges, breaking the asphalt look) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.1, 0]} receiveShadow>
        <planeGeometry args={[13, 7]} />
        <meshStandardMaterial color="#22262e" roughness={0.95} />
      </mesh>
      {/* lane divider islands — LONG IN X (along traffic), channelling every
          car through the middle lane. The old islands were rotated 90° wrong
          (across the road) so every vehicle drove straight through them. */}
      {[-1.8, 1.8].map((lz, i) => (
        <mesh key={i} position={[0, 0.28, lz]} castShadow>
          <boxGeometry args={[7, 0.55, 0.5]} />
          <meshStandardMaterial color="#d8d2bd" roughness={0.8} />
        </mesh>
      ))}
      {/* nose cones on the island tips so they read as curbs, not walls */}
      {[-1.8, 1.8].map((lz, i) => (
        <group key={`c${i}`}>
          {[-3.5, 3.5].map((cx, j) => (
            <mesh key={j} position={[cx, 0.28, lz]} castShadow>
              <sphereGeometry args={[0.25, 8, 8]} />
              <meshStandardMaterial color="#d8d2bd" roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
      {/* canopy over the plaza */}
      <mesh position={[0, 3.6, -0.4]} castShadow>
        <boxGeometry args={[11, 0.35, 6]} />
        <meshStandardMaterial color={INK} roughness={0.6} />
      </mesh>
      <mesh position={[0, 3.85, -0.4]}>
        <boxGeometry args={[11.2, 0.12, 6.2]} />
        <meshStandardMaterial color={SIGNAL} emissive={SIGNAL} emissiveIntensity={0.55} />
      </mesh>
      {[-3.4, 3.4].map((cx, i) => (
        <mesh key={`p${i}`} position={[cx, 1.8, -0.4]}>
          <cylinderGeometry args={[0.16, 0.16, 3.6, 8]} />
          <meshStandardMaterial color="#5b6270" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}

      {/* one booth + barrier arm per lane (the layout passes a single lane) */}
      {lanes.map((lz, i) => (
        <TollLane key={i} z={lz} lifted={lifted} delay={i * 0.25} />
      ))}

      {/* the price sign */}
      <Html center position={[0, 5.1, -0.4]} distanceFactor={60}>
        <div className="pointer-events-none select-none whitespace-nowrap rounded-none border-[1.5px] border-black-ink bg-paper px-2 py-1 font-mono text-[10px] font-bold text-black-ink shadow-[3px_3px_0_rgba(0,0,0,.45)]">
          TOLL · <span className="text-signal">JWT</span> {token ? "· PAID ✓" : "· GUEST — SIGN IN"}
        </div>
      </Html>
    </group>
  );
}

function TollLane({ z, lifted, delay }: { z: number; lifted: boolean; delay: number }) {
  const arm = useRef<THREE.Group>(null!);
  const lampMat = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame(({ clock }) => {
    if (!arm.current) return;
    // staggered lift so multiple arms rise in sequence
    const target = lifted ? -Math.PI / 2 : 0;
    const t = THREE.MathUtils.clamp((clock.elapsedTime - (lifted ? delay : 0)) * 1.6, 0, 1);
    arm.current.rotation.z += (target - arm.current.rotation.z) * (lifted ? Math.min(1, t) : 0.12);
    if (lampMat.current) {
      const blink = !lifted && Math.sin(clock.elapsedTime * 6) > 0 ? 1 : 0.15;
      lampMat.current.emissiveIntensity = blink;
    }
  });
  return (
    <group position={[0, 0, z]}>
      {/* booth — parked on the north island line, clear of the lane */}
      <mesh position={[3.1, 1.05, 1.8]} castShadow>
        <boxGeometry args={[1.3, 2.1, 1.3]} />
        <meshStandardMaterial color="#d8d2bd" roughness={0.85} />
      </mesh>
      <mesh position={[3.1, 1.75, 1.13]}>
        <boxGeometry args={[0.9, 0.6, 0.04]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.35} />
      </mesh>
      {/* signal lamp */}
      <mesh position={[3.1, 2.35, 1.8]}>
        <sphereGeometry args={[0.14, 10, 10]} />
        <meshStandardMaterial ref={lampMat} color={lifted ? "#22c55e" : "#ef4444"} emissive={lifted ? "#22c55e" : "#ef4444"} emissiveIntensity={0.15} /> {/* green=paid flow · red=halted */}
      </mesh>
      {/* barrier arm — pivots at the west post and spans ACROSS the lane */}
      <group ref={arm} position={[-2.2, 1.15, 0]}>
        <mesh position={[2.2, 0, 0]} castShadow>
          <boxGeometry args={[4.6, 0.14, 0.14]} />
          <meshStandardMaterial color="#f97316" />
        </mesh>
        <mesh position={[3.9, 0.02, 0]}>
          <boxGeometry args={[0.55, 0.16, 0.16]} />
          <meshStandardMaterial color="#f8f5ea" />
        </mesh>
      </group>
    </group>
  );
}

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { useCity } from "../store/useCity";
import { ENV, PRESETS, TIME, WIND } from "./env";
import type { Weather } from "./env";
import { setRainLevel } from "./audio";

const NIGHT = new THREE.Color("#060a18"), DAY = new THREE.Color("#8ecbe8"), DUSK = new THREE.Color("#f0855a"), GRAY = new THREE.Color("#5a6472");
/** weather = the repo's actual health, from the LIVE city in the store */
const healthWeather = (s: any): Weather => {
  if (s.failing) return "storm";
  const city = s.city;
  const bad = city.districts
    .flatMap((d: any) => d.buildings)
    .filter((b: any) => b.health !== "ok");
  if (bad.some((b: any) => b.health === "error")) return "rain";
  if (s.apiLatencyMs != null && s.apiLatencyMs > 900) return "storm"; // real slow API
  if (bad.length > 0 || (s.apiLatencyMs != null && s.apiLatencyMs > 250)) return "drizzle";
  return "clear";
};

/** Gradient skydome — a huge back-side sphere whose horizon band tracks the
 *  time-of-day color. Distant districts now melt into haze instead of
 *  floating on flat black; the single biggest "this is a world" upgrade. */
function SkyDome({ skyRef }: { skyRef: React.MutableRefObject<{ top: THREE.Color; bottom: THREE.Color } | null> }) {
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color("#060a18") },
      bottomColor: { value: new THREE.Color("#101a30") },
    }),
    [],
  );
  useEffect(() => {
    skyRef.current = { top: uniforms.topColor.value, bottom: uniforms.bottomColor.value };
    return () => { skyRef.current = null; };
  }, [skyRef, uniforms]);
  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[380, 24, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={`varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`
          uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vP;
          void main(){
            float h = clamp(normalize(vP).y, -0.05, 1.0);
            gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, 0.62)), 1.0);
          }`}
      />
    </mesh>
  );
}

export function Atmosphere() {
  const scene = useThree((s) => s.scene);
  const sun = useRef<THREE.DirectionalLight>(null!), moon = useRef<THREE.DirectionalLight>(null!), amb = useRef<THREE.AmbientLight>(null!), stars = useRef<THREE.Group>(null!);
  const acc = useRef(0), liveAcc = useRef(0), rainAcc = useRef(1), tmp = useMemo(() => new THREE.Color(), []);
  const skyHandle = useRef<{ top: THREE.Color; bottom: THREE.Color } | null>(null);
  const cloudMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, fog: false }), []);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.15, depthWrite: false }), []);
  const clouds = useMemo(() => Array.from({ length: 9 }, () => ({ x: (Math.random() - .5) * 260, y: 53 + Math.random() * 5, z: (Math.random() - .5) * 200, s: 9 + Math.random() * 9, v: 1.5 + Math.random() * 2 })), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // clamp tab-switch/GC spikes → no teleporting actors
    const st = useCity.getState();
    TIME.value += dt; WIND.value = ENV.wind;
    if (st.autoCycle) { acc.current += dt; if (acc.current > 0.25) { st.patch({ time: (st.time + acc.current * 0.5) % 24 }); acc.current = 0; } }
    if (st.live) { liveAcc.current += dt; if (liveAcc.current > 1) { liveAcc.current = 0; const w = healthWeather(st); if (w !== st.weather) st.patch({ weather: w }); } }

    // ── smooth weather transitions ──
    const P = PRESETS[st.weather], k = 1 - Math.pow(0.25, dt);
    ENV.rain += (P.rain - ENV.rain) * k; ENV.snow += (P.snow - ENV.snow) * k; ENV.fog += (P.fog - ENV.fog) * k;
    ENV.wind += (P.wind - ENV.wind) * k; ENV.cloud += (P.cloud - ENV.cloud) * k;
    ENV.storm += ((st.weather === "storm" ? 1 : 0) - ENV.storm) * k;
    const wetT = Math.max(ENV.rain, ENV.snow * 0.25);
    ENV.wet += (wetT - ENV.wet) * (wetT > ENV.wet ? k : k * 0.25); // dries slower than it rains

    // ── sky / sun / fog ──
    const a = ((st.time - 6) / 12) * Math.PI, elev = Math.sin(a);
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.3);
    const dusk = Math.exp(-Math.pow((elev - 0.03) / 0.14, 2));
    ENV.night = 1 - day; // ← restored: the whole scene keys off this
    tmp.copy(NIGHT).lerp(DAY, day).lerp(DUSK, dusk * 0.5).lerp(GRAY, ENV.cloud * 0.65 * (0.3 + day * 0.7));
    (scene.background as THREE.Color).copy(tmp);
    const fog = scene.fog as THREE.FogExp2; fog.color.copy(tmp);
    // base density lifted 0.002 → 0.0026: distant districts melt into haze
    fog.density = 0.0026 + ENV.fog * 0.0075 + ENV.wet * 0.0008;
    // skydome tracks the sky: darker zenith, lighter horizon band
    if (skyHandle.current) {
      skyHandle.current.top.copy(tmp).multiplyScalar(0.55);
      skyHandle.current.bottom.copy(tmp).multiplyScalar(1.45);
    }
    (scene as any).environmentIntensity = 0.1 + day * 0.7;
    sun.current.position.set(Math.cos(a) * -90, Math.sin(a) * 90, 30);
    sun.current.intensity = day * 1.5 * (1 - ENV.cloud * 0.75);
    moon.current.intensity = (1 - day) * 0.3;
    amb.current.intensity = 0.3 + day * 0.45;
    stars.current.visible = day < 0.35 && ENV.cloud < 0.7;
    cloudMat.color.set(ENV.cloud > 0.6 ? "#6b7280" : "#ffffff");
    cloudMat.opacity = 0.16 + ENV.cloud * 0.25;
    shadowMat.opacity = ENV.cloud * 0.2 + ENV.wet * 0.08;
    // audio params throttled to ≤2 Hz
    rainAcc.current += dt;
    if (rainAcc.current > 0.5) { rainAcc.current = 0; setRainLevel(ENV.rain * 0.8 + ENV.storm * 0.2); }
  });

  return (
    <group>
      <SkyDome skyRef={skyHandle} />
      <ambientLight ref={amb} intensity={0.4} />
      <hemisphereLight args={["#8ecbe8", "#1a2418", 0.25]} />
      <directionalLight ref={sun} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110} />
      <directionalLight ref={moon} color="#7aa2ff" position={[-40, 60, -30]} />
      <group ref={stars}><Stars radius={200} depth={40} count={2500} factor={4} fade /></group>
      {clouds.map((c, i) => <Cloud key={i} {...c} mat={cloudMat} shadowMat={shadowMat} />)}
    </group>
  );
}

function Cloud({ x, y, z, s, v, mat, shadowMat }: any) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // clamp tab-switch/GC spikes → no teleporting actors
    ref.current.position.x += v * dt * (0.5 + ENV.wind * 2.5);
    if (ref.current.position.x > 170) ref.current.position.x = -170;
  });
  return (
    <group ref={ref} position={[x, y, z]}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[(i - 1.5) * s * 0.62, (i % 2) * s * 0.05, (i % 3) * s * 0.1]} scale={[s * 1.7, s * 0.32, s * 0.9]}>
          <sphereGeometry args={[1, 12, 12]} /><primitive object={mat} attach="material" />
        </mesh>))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.6 - y, 0]}>
        <planeGeometry args={[s * 2.6, s * 1.6]} /><primitive object={shadowMat} attach="material" />
      </mesh>
    </group>
  );
}

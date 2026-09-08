import { Suspense, useEffect } from "react";
import { SceneErrorBoundary, SceneSuspense } from "./Safe";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { useCityLayout } from "../lib/city";
import { useCity } from "../store/useCity";
import { Building, District, NightMaterials } from "./Buildings";
import { Ground, Roads, Underground, Decor, Links } from "./Infrastructure";
import { Greenery } from "./Greenery";
import { Traffic } from "./Traffic";
import { People } from "./People";
import { River } from "./Water";
import { Atmosphere } from "./Atmosphere";
import { Precipitation } from "./Precipitation";
import { Lightning } from "./Lightning";
import { Wet } from "./Wet";
import { CameraRig } from "./CameraRig";
import { ShowcaseWorld, ShowcaseOrbit } from "./Showcase";
import { FloatingNotifs } from "../ui/panels/FloatingNotifs";
import { Connections } from "./Connections";
import { HDRI_DAY, HDRI_NIGHT, preloadAll } from "./assets";

/** swaps HDRI by time of day — venice_sunset (day) ↔ dikhololo_night */
function SkyEnvironment() {
  const time = useCity((s) => s.time);
  const day = time > 6.2 && time < 18.6;
  const files = day ? [HDRI_DAY] : [HDRI_NIGHT];
  return <Environment key={files[0]} files={files} background={false} environmentIntensity={day ? 0.55 : 0.25} />;
}

/** kick off GLB preloading once the module loads */
function usePreload() {
  useEffect(() => { preloadAll(); }, []);
}

export function CityScene() {
  usePreload();
  const L = useCityLayout();
  const cityEdges = useCity((s) => s.city.edges);
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      onCreated={({ gl }) => {
        // without preventDefault, any context loss permanently blanks the scene
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
      }}
      camera={{ position: [0, 70, 90], fov: 45 }}
      onPointerMissed={() => useCity.getState().select(null)}
    >
      <color attach="background" args={["#070b18"]} />
      <fogExp2 attach="fog" args={["#070b18", 0.002]} />
      {/* city renders immediately; ONLY the HDR is suspended */}
      <Suspense fallback={null}><SkyEnvironment /></Suspense>
      {/* every piece that streams assets is boundary+suspense wrapped so a
          slow or broken GLB can never unmount the city (flash-then-vanish bug) */}
      <SceneSuspense><Ground /></SceneSuspense>
      <SceneSuspense><River /></SceneSuspense>
      <SceneSuspense><Roads L={L} /></SceneSuspense>
      <SceneSuspense><Underground L={L} /></SceneSuspense>
      <SceneSuspense>
        <SceneErrorBoundary>
          <Decor L={L} />
        </SceneErrorBoundary>
      </SceneSuspense>
      <SceneSuspense>
        <SceneErrorBoundary>
          <Greenery />
        </SceneErrorBoundary>
      </SceneSuspense>
      <SceneSuspense><Links L={L} /></SceneSuspense>
      {L.districts.map((d) => <District key={d.id} d={d} />)}
      <SceneErrorBoundary>
        <SceneSuspense>
          {L.buildings.map((b) => <Building key={b.id} b={b} />)}
        </SceneSuspense>
      </SceneErrorBoundary>
      <SceneSuspense><Connections layout={L} edges={cityEdges} /></SceneSuspense>
      <SceneErrorBoundary>
        <SceneSuspense><Traffic L={L} /></SceneSuspense>
      </SceneErrorBoundary>
      <FloatingNotifs />
      <SceneErrorBoundary>
        <SceneSuspense><People L={L} /></SceneSuspense>
      </SceneErrorBoundary>
      <SceneSuspense><Precipitation /></SceneSuspense>
      <SceneSuspense>
        <Lightning target={[L.byId.get("be-payctrl")?.pos[0] ?? 44, L.byId.get("be-payctrl")?.pos[2] ?? -23]} />
        <Wet L={L} />
      </SceneSuspense>
      <Atmosphere />
      <NightMaterials />
      <CameraRig />
      {/* ambient rotating props (turbines/fans/dishes/billboards/blimp) */}
      <SceneErrorBoundary>
        <ShowcaseWorld L={L} />
      </SceneErrorBoundary>
      <ShowcaseOrbit />
      {/* NOTE: EffectComposer/Bloom removed — its init race with the suspended
          HDR environment threw "null (reading 'alpha')" every frame and killed
          the render loop right after first paint (the flash-then-vanish bug).
          Emissive materials already carry the night look without bloom. */}
      <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.15} minDistance={8} maxDistance={180} />
    </Canvas>
  );
}

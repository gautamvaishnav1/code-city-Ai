/**
 * WorldScene.tsx
 * The root Three.js <Canvas> scene for the CodeCity 3D world.
 */
import { useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, BakeShadows } from '@react-three/drei';
import * as THREE from 'three';

import { ISLAND_SECTORS } from '../../data/mockRepoData';

import { OceanPlane } from './OceanPlane';
import { DistrictIsland } from './DistrictIsland';
import { ApiGatewayHub } from './ApiGatewayHub';
import { NeonRoads } from './NeonRoads';
import { TrafficParticles } from './TrafficParticles';
import { PipelineLayer } from './PipelineLayer';

// Helper component to sync Redux camera state with OrbitControls
function CameraController() {
  const { transform } = useAppSelector((state) => state.city);
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  useEffect(() => {
    if (!controlsRef.current) return;
    
    // Zoom handling
    const targetZoom = transform.zoom;
    // We adjust fov based on zoom for a pseudo-isometric feel
    const fov = 45 / Math.max(0.1, targetZoom);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 0.1);
      camera.updateProjectionMatrix();
    }

    // Top-down vs Isometric view
    if (transform.isTopDown) {
      controlsRef.current.setAzimuthalAngle(0);
      controlsRef.current.setPolarAngle(0); // Looking straight down
    } else {
      // Rotate map based on UI compass controls
      const radZ = THREE.MathUtils.degToRad(transform.rotateZ + 45); // Adjust offset to match reference
      controlsRef.current.setAzimuthalAngle(radZ);
      controlsRef.current.setPolarAngle(Math.PI / 3.5); // Isometric-ish 50 degrees
    }
  }, [transform.zoom, transform.isTopDown, transform.rotateZ, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.05}
      minDistance={10}
      maxDistance={40}
      maxPolarAngle={Math.PI / 2 - 0.05} // Don't go below ocean
    />
  );
}

export function WorldScene() {
  const dispatch = useAppDispatch();
  const { currentRepo, selectedNode, filters } = useAppSelector((state) => state.city);

  return (
    <Canvas
      shadows
      camera={{ position: [20, 20, 20], fov: 45 }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={['#87CEEB']} />
      
      {/* Lighting setup for daylight feel */}
      <ambientLight intensity={0.6} color="#ffffff" />
      <directionalLight
        position={[15, 25, 10]}
        intensity={1.2}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <pointLight position={[-10, 5, -10]} intensity={0.5} color="#ffffff" distance={30} />
      <pointLight position={[10, 5, 10]} intensity={0.5} color="#ffffff" distance={30} />

      {/* Daylight environment map */}
      <Environment preset="city" environmentIntensity={0.5} />

      {/* Sync camera with Redux */}
      <CameraController />

      {/* The Ocean Base */}
      <OceanPlane />

      {/* API Gateway Hub */}
      <ApiGatewayHub />

      {/* Neon Roads */}
      <NeonRoads />

      {/* Traffic Particles */}
      <TrafficParticles />

      {/* Underground Pipelines */}
      <PipelineLayer />

      {/* District Islands */}
      {Object.entries(ISLAND_SECTORS).map(([key, sector]) => {
        // Filter nodes for this district
        const nodes = currentRepo.nodes.filter(
          (n) => n.island === sector.id &&
                 (filters.selectedSector === 'all' || filters.selectedSector === sector.id)
        );

        const isHighlighted = filters.selectedSector === sector.id;

        return (
          <DistrictIsland
            key={key}
            sector={sector}
            nodes={nodes}
            selectedNode={selectedNode}
            onSelectNode={(node) => dispatch(setSelectedNode(node))}
            isHighlighted={isHighlighted}
          />
        );
      })}

      {/* Static shadow baking for performance since buildings mostly don't move */}
      <BakeShadows />
    </Canvas>
  );
}

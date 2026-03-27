"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/* ────────────────────────────────────────────────────────────────
 * CameraController — orbit controls + cinematic intro + follow mode.
 *
 * Upgrades:
 *   • Satellite follow mode — camera smoothly lerps to an offset
 *     behind/above the satellite and tracks it
 *   • Toggle off → returns to default Earth-centered view
 *   • Intro zoom preserved
 * ──────────────────────────────────────────────────────────────── */

interface CameraControllerProps {
  /** Closest the camera can zoom in. */
  minDistance?: number;
  /** Farthest the camera can zoom out. */
  maxDistance?: number;
  /** Target position after the intro animation. */
  targetPosition?: [number, number, number];
  /** Whether camera follow mode is active. */
  followSatellite?: boolean;
  /** Current satellite position to follow. */
  satellitePosition?: [number, number, number];
}

export default function CameraController({
  minDistance = 1.5,
  maxDistance = 12,
  targetPosition = [0, 0, 3],
  followSatellite = false,
  satellitePosition = [0, 0, 0],
}: CameraControllerProps) {
  const introComplete = useRef(false);
  const target = useRef(new THREE.Vector3(...targetPosition));
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();

  // Reusable vectors to avoid per-frame allocations
  const satVec = useRef(new THREE.Vector3());
  const camTarget = useRef(new THREE.Vector3());
  const defaultPos = useRef(new THREE.Vector3(...targetPosition));

  useFrame(() => {
    // ── Intro zoom ──────────────────────────────────────────
    if (!introComplete.current) {
      camera.position.lerp(target.current, 0.025);
      if (camera.position.distanceTo(target.current) < 0.05) {
        camera.position.copy(target.current);
        introComplete.current = true;
      }
      return; // skip follow logic during intro
    }

    // ── Follow mode ─────────────────────────────────────────
    if (followSatellite && introComplete.current) {
      satVec.current.set(
        satellitePosition[0],
        satellitePosition[1],
        satellitePosition[2],
      );

      // Camera offset: slightly behind and above the satellite
      // (relative to satellite's direction from Earth center)
      const dir = satVec.current.clone().normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(dir, up).normalize();

      camTarget.current
        .copy(satVec.current)
        .add(dir.multiplyScalar(0.6))     // pull back from satellite
        .add(up.multiplyScalar(0.3))       // slightly above
        .add(side.multiplyScalar(0.2));    // slightly to the side

      camera.position.lerp(camTarget.current, 0.04);

      // Point OrbitControls target at satellite
      if (controlsRef.current) {
        const ctrl = controlsRef.current as unknown as { target: THREE.Vector3 };
        ctrl.target.lerp(satVec.current, 0.06);
      }
    } else if (introComplete.current) {
      // ── Return to default view when follow is off ─────────
      if (controlsRef.current) {
        const ctrl = controlsRef.current as unknown as { target: THREE.Vector3 };
        ctrl.target.lerp(new THREE.Vector3(0, 0, 0), 0.03);
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.06}
      minDistance={minDistance}
      maxDistance={maxDistance}
      enablePan={true}
      enableRotate={true}
      enableZoom={true}
      minPolarAngle={0.1}
      maxPolarAngle={Math.PI * 0.95}
    />
  );
}

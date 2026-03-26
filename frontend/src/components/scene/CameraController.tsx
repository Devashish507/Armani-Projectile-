"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/* ────────────────────────────────────────────────────────────────
 * CameraController — orbit controls + cinematic intro zoom.
 *
 * On mount the camera starts far out (wherever SpaceScene placed
 * it) and smoothly lerps toward `targetPosition` over ~2 s.
 * Once the intro completes, standard orbit controls take over.
 *
 * Polar angle is capped at 95 % of π to prevent the camera
 * from flipping upside-down.
 * ──────────────────────────────────────────────────────────────── */

interface CameraControllerProps {
  /** Closest the camera can zoom in. */
  minDistance?: number;
  /** Farthest the camera can zoom out. */
  maxDistance?: number;
  /** Target position after the intro animation. */
  targetPosition?: [number, number, number];
}

export default function CameraController({
  minDistance = 1.5,
  maxDistance = 8,
  targetPosition = [0, 0, 3],
}: CameraControllerProps) {
  const introComplete = useRef(false);
  const target = useRef(new THREE.Vector3(...targetPosition));
  const { camera } = useThree();

  // ── Intro zoom: lerp from initial (far) → target (close) ──
  useFrame(() => {
    if (!introComplete.current) {
      camera.position.lerp(target.current, 0.025);
      // Consider intro done when within 0.05 units of target
      if (camera.position.distanceTo(target.current) < 0.05) {
        camera.position.copy(target.current);
        introComplete.current = true;
      }
    }
  });

  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.06}
      minDistance={minDistance}
      maxDistance={maxDistance}
      enablePan={true}
      enableRotate={true}
      enableZoom={true}
      /* Keep 95 % of π to avoid upside-down flips */
      minPolarAngle={0.1}
      maxPolarAngle={Math.PI * 0.95}
    />
  );
}

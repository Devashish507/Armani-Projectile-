"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { CameraMode } from "@/types/orbit";

/* ────────────────────────────────────────────────────────────────
 * CameraController — orbit controls + cinematic intro + 3 camera modes.
 *
 * Camera Modes (#14):
 *   • "orbit"  — Earth-centered orbit controls, default view
 *   • "follow" — Camera smoothly lerps behind/above the satellite
 *   • "free"   — Full 6DOF, unlocked pan/zoom/rotate, no constraints
 *
 * Smooth transitions between modes (lerp over ~1.5s).
 * ──────────────────────────────────────────────────────────────── */

interface CameraControllerProps {
  /** Closest the camera can zoom in. */
  minDistance?: number;
  /** Farthest the camera can zoom out. */
  maxDistance?: number;
  /** Target position after the intro animation. */
  targetPosition?: [number, number, number];
  /** Active camera mode. */
  cameraMode?: CameraMode;
  /** Current satellite position to follow. */
  satellitePosition?: [number, number, number];
}

export default function CameraController({
  minDistance = 1.5,
  maxDistance = 12,
  targetPosition = [0, 0, 3],
  cameraMode = "orbit",
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

  // Transition tracking
  const prevMode = useRef<CameraMode>(cameraMode);
  const transitionProgress = useRef(1); // 1 = transition complete

  useFrame((_state, delta) => {
    // ── Track mode transitions ───────────────────────────────
    if (cameraMode !== prevMode.current) {
      prevMode.current = cameraMode;
      transitionProgress.current = 0;
    }
    if (transitionProgress.current < 1) {
      transitionProgress.current = Math.min(1, transitionProgress.current + delta * 0.7);
    }

    // Smooth factor increases as transition completes
    const lerpFactor = 0.03 + transitionProgress.current * 0.03;

    // ── Intro zoom ──────────────────────────────────────────
    if (!introComplete.current) {
      camera.position.lerp(target.current, 0.025);
      if (camera.position.distanceTo(target.current) < 0.05) {
        camera.position.copy(target.current);
        introComplete.current = true;
      }
      return;
    }

    // ── Mode-specific camera behaviour ──────────────────────
    switch (cameraMode) {
      case "follow": {
        satVec.current.set(
          satellitePosition[0],
          satellitePosition[1],
          satellitePosition[2],
        );

        // Camera offset: behind and above the satellite
        const dir = satVec.current.clone().normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const side = new THREE.Vector3().crossVectors(dir, up).normalize();

        camTarget.current
          .copy(satVec.current)
          .add(dir.multiplyScalar(0.6))
          .add(up.multiplyScalar(0.3))
          .add(side.multiplyScalar(0.2));

        camera.position.lerp(camTarget.current, lerpFactor + 0.01);

        if (controlsRef.current) {
          const ctrl = controlsRef.current as unknown as { target: THREE.Vector3 };
          ctrl.target.lerp(satVec.current, lerpFactor + 0.03);
        }
        break;
      }

      case "free": {
        // Free mode: no constraints, just let orbit controls handle everything
        // Smoothly release any target lock
        if (controlsRef.current) {
          const ctrl = controlsRef.current as unknown as { target: THREE.Vector3 };
          // Don't force any position — let user control freely
          // Just damp any existing momentum
        }
        break;
      }

      case "orbit":
      default: {
        // Return to default Earth-centered view
        if (controlsRef.current) {
          const ctrl = controlsRef.current as unknown as { target: THREE.Vector3 };
          ctrl.target.lerp(new THREE.Vector3(0, 0, 0), lerpFactor);
        }
        break;
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.06}
      minDistance={cameraMode === "free" ? 0.5 : minDistance}
      maxDistance={cameraMode === "free" ? 50 : maxDistance}
      enablePan={cameraMode !== "follow"}
      enableRotate={true}
      enableZoom={true}
      minPolarAngle={cameraMode === "free" ? 0 : 0.1}
      maxPolarAngle={cameraMode === "free" ? Math.PI : Math.PI * 0.95}
    />
  );
}

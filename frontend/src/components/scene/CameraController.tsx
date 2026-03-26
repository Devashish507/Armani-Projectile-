"use client";

import { OrbitControls } from "@react-three/drei";

/* ────────────────────────────────────────────────────────────────
 * CameraController — wraps Drei's OrbitControls with
 * mission-control-friendly defaults.
 *
 * Features:
 *   • Smooth damping for cinematic camera motion
 *   • Zoom distance clamped so the user can't clip inside the
 *     Earth or zoom out so far the planet vanishes
 *   • Pan, rotate, and zoom all enabled
 *
 * This is a thin wrapper by design — if additional camera
 * behaviours are needed later (e.g. fly-to animations for
 * satellite tracking) they can be composed alongside this
 * component without altering it.
 * ──────────────────────────────────────────────────────────────── */

interface CameraControllerProps {
  /** Closest the camera can zoom in. */
  minDistance?: number;
  /** Farthest the camera can zoom out. */
  maxDistance?: number;
}

export default function CameraController({
  minDistance = 1.5,
  maxDistance = 8,
}: CameraControllerProps) {
  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.08}
      minDistance={minDistance}
      maxDistance={maxDistance}
      enablePan={true}
      enableRotate={true}
      enableZoom={true}
      /* Limit vertical rotation so user can't flip upside-down */
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI - 0.2}
    />
  );
}

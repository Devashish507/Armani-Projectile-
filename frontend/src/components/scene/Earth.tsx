"use client";

import { useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { TextureLoader } from "three";
import type { Mesh } from "three";

/* ────────────────────────────────────────────────────────────────
 * Earth — A textured, slowly rotating sphere.
 *
 * Props:
 *   radius        – sphere radius in world units (default 1)
 *   rotationSpeed – radians per frame at 60 FPS  (default 0.001)
 *
 * The diffuse map is loaded from /textures/earth_daymap.jpg which
 * should be a Blue-Marble-style equirectangular projection.
 *
 * Design notes:
 *   • 64×64 segments give a smooth silhouette without GPU pressure.
 *   • useFrame drives the rotation so it stays in sync with the
 *     render loop rather than relying on a timer.
 *   • The component is intentionally minimal — bump maps, specular,
 *     and cloud layers will be added in a later phase.
 * ──────────────────────────────────────────────────────────────── */

interface EarthProps {
  /** Sphere radius in world units. */
  radius?: number;
  /** Y-axis rotation speed (radians / frame at 60 FPS). */
  rotationSpeed?: number;
}

export default function Earth({
  radius = 1,
  rotationSpeed = 0.001,
}: EarthProps) {
  const meshRef = useRef<Mesh>(null);

  // Load the diffuse (colour) texture once and cache it.
  const dayMap = useLoader(TextureLoader, "/textures/earth_daymap.jpg");

  // Rotate around the Y-axis every frame for a gentle spin effect.
  useFrame((_state, delta) => {
    if (meshRef.current) {
      // delta-based rotation keeps speed independent of frame rate
      meshRef.current.rotation.y += rotationSpeed * delta * 60;
    }
  });

  return (
    <mesh ref={meshRef}>
      {/* 64 width/height segments — smooth enough for close-up views */}
      <sphereGeometry args={[radius, 64, 64]} />
      <meshStandardMaterial map={dayMap} />
    </mesh>
  );
}

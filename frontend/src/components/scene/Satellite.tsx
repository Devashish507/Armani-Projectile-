"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh, PointLight } from "three";

/* ────────────────────────────────────────────────────────────────
 * Satellite — a small glowing sphere representing a spacecraft.
 *
 * The mesh is purely positional — animation is driven externally
 * by updating the `position` prop (see useOrbitAnimation).
 * A subtle point light and slow spin give it visual presence.
 * ──────────────────────────────────────────────────────────────── */

interface SatelliteProps {
  /** Current world-space position [x, y, z]. */
  position: [number, number, number];
  /** Sphere radius in world units. @default 0.03 */
  size?: number;
  /** Base body colour. @default "#ffffff" */
  color?: string;
  /** Emissive glow colour. @default "#ffd54f" (warm yellow) */
  emissiveColor?: string;
  /** Whether the satellite is visible. @default true */
  visible?: boolean;
}

export default function Satellite({
  position,
  size = 0.03,
  color = "#ffffff",
  emissiveColor = "#ffd54f",
  visible = true,
}: SatelliteProps) {
  const meshRef = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);

  // ── Gentle spin for visual interest ───────────────────────
  useFrame((_state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 1.5;
      meshRef.current.rotation.x += delta * 0.8;
    }
  });

  return (
    <group position={position} visible={visible}>
      {/* ── Satellite body ─────────────────────────────────── */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={1.2}
          metalness={0.5}
          roughness={0.3}
        />
      </mesh>

      {/* ── Subtle point light so the satellite illuminates
            nearby geometry (e.g. orbit path / Earth surface) */}
      <pointLight
        ref={lightRef}
        color={emissiveColor}
        intensity={0.4}
        distance={1.5}
        decay={2}
      />
    </group>
  );
}

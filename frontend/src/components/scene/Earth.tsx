"use client";

import { useRef, useMemo } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { TextureLoader } from "three";
import type { Group } from "three";

/* ────────────────────────────────────────────────────────────────
 * Earth — Multi-textured globe with day/night cycle, specular
 * oceans, atmosphere glow, and 23.5° axial tilt.
 *
 * Maps loaded:
 *   • Diffuse (day)      → base colour
 *   • Emissive (night)   → city lights on the dark hemisphere
 *   • Roughness (spec)   → shiny oceans vs matte land
 *
 * The outer <group> applies the axial tilt so the mesh itself
 * only rotates around local Y.
 *
 * Atmosphere is a slightly larger transparent sphere that
 * produces the blue rim-glow effect.
 * ──────────────────────────────────────────────────────────────── */

/** Earth's axial tilt in radians (≈ 23.44°) */
const AXIAL_TILT = 0.4091;

interface EarthProps {
  /** Sphere radius in world units. */
  radius?: number;
  /** Y-axis rotation speed (radians / frame at 60 FPS). */
  rotationSpeed?: number;
  /** When true, Earth stops rotating. */
  paused?: boolean;
}

export default function Earth({
  radius = 1,
  rotationSpeed = 0.001,
  paused = false,
}: EarthProps) {
  const groupRef = useRef<Group>(null);
  const { gl } = useThree();

  // ── Load all three texture maps in a single batch call ────
  const [dayMap, nightMap, specMap] = useLoader(TextureLoader, [
    "/textures/earth_daymap.jpg",
    "/textures/earth_nightmap.jpg",
    "/textures/earth_specular.jpg",
  ]);

  // ── Maximise anisotropic filtering for crisp textures at
  //    oblique viewing angles (runs once per texture set) ─────
  useMemo(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    [dayMap, nightMap, specMap].forEach((tex) => {
      tex.anisotropy = maxAniso;
    });
  }, [gl, dayMap, nightMap, specMap]);

  // ── Delta-based rotation keeps speed frame-rate-independent ─
  useFrame((_state, delta) => {
    if (!paused && groupRef.current) {
      groupRef.current.rotation.y += rotationSpeed * delta * 60;
    }
  });

  return (
    /* Axial tilt applied to the outer group so the mesh's own
       rotation stays around local Y, matching real Earth spin. */
    <group rotation={[0, 0, AXIAL_TILT]}>
      <group ref={groupRef}>
        {/* ── Globe mesh ──────────────────────────────────── */}
        <mesh>
          <sphereGeometry args={[radius, 64, 64]} />
          <meshStandardMaterial
            map={dayMap}
            emissiveMap={nightMap}
            emissive="#ffffff"
            emissiveIntensity={0.6}
            roughnessMap={specMap}
            metalness={0.2}
          />
        </mesh>
      </group>

      {/* ── Atmosphere glow ─────────────────────────────── */}
      {/* Slightly oversized transparent sphere producing
          the signature NASA-style blue rim effect.        */}
      <mesh scale={1.02}>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshBasicMaterial
          color="#3aa0ff"
          transparent
          opacity={0.08}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

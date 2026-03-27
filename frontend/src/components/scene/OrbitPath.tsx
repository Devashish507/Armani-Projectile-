"use client";

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";

/* ────────────────────────────────────────────────────────────────
 * OrbitPath — renders a satellite trajectory using Drei's Line2.
 *
 * Visual upgrades:
 *   • Fat lines (Line2) — screen-space thickness that stays
 *     visible at any zoom level
 *   • Motion trail — vertex-color gradient that brightens near
 *     the satellite and fades in the "wake" region
 *   • Earth-shadow dimming — points behind Earth get darker
 *   • Dual-layer glow — bright core + transparent halo
 * ──────────────────────────────────────────────────────────────── */

interface OrbitPathProps {
  /** Trajectory points in world units — array of [x, y, z]. */
  positions: [number, number, number][];
  /** Current animation index (for motion trail). */
  currentIndex: number;
  /** Line colour (CSS / hex string). @default "#00e5ff" (cyan) */
  color?: string;
  /** Whether the path is visible. @default true */
  visible?: boolean;
}

/** Convert a hex colour string to [r, g, b] normalised floats. */
function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export default function OrbitPath({
  positions,
  currentIndex,
  color = "#00e5ff",
  visible = true,
}: OrbitPathProps) {
  const { camera } = useThree();

  // ── Memoised points for Line2 ──────────────────────────────
  const points = useMemo(
    () => positions.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    [positions],
  );

  const baseRgb = useMemo(() => hexToRgb(color), [color]);

  // ── Compute vertex colours with motion trail + Earth shadow ─
  const vertexColors = useMemo(() => {
    const n = positions.length;
    if (n === 0) return [];

    const camDir = new THREE.Vector3()
      .copy(camera.position)
      .normalize();

    const colors: [number, number, number][] = [];

    for (let i = 0; i < n; i++) {
      // Wrap-aware distance from satellite
      let dist = currentIndex - i;
      if (dist < 0) dist += n;

      // Trail: bright near satellite → fades behind
      const trailLength = n * 0.7;
      let brightness: number;
      if (dist <= trailLength) {
        brightness = 1.0 - (dist / trailLength) * 0.75;
      } else {
        brightness = 0.15;
      }

      // Earth-shadow: dim points on the far side from camera
      const pos = positions[i];
      const ptDir = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
      const dot = camDir.dot(ptDir);
      if (dot < -0.1) {
        brightness *= Math.max(0.2, 1.0 + dot);
      }

      colors.push([
        baseRgb[0] * brightness,
        baseRgb[1] * brightness,
        baseRgb[2] * brightness,
      ]);
    }

    return colors;
  }, [positions, currentIndex, baseRgb, camera.position]);

  if (positions.length < 2 || vertexColors.length === 0) return null;

  return (
    <group visible={visible}>
      {/* Glow halo — wider, transparent */}
      <Line
        points={points}
        vertexColors={vertexColors}
        lineWidth={5}
        transparent
        opacity={0.15}
        depthWrite={false}
      />

      {/* Core trajectory — bright, sharp */}
      <Line
        points={points}
        vertexColors={vertexColors}
        lineWidth={2}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </group>
  );
}

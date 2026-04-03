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
 *   • Alpha-gradient trail fading (#8) — older points fade to
 *     full transparency for a cinematic comet-tail effect
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

  // ── Compute vertex colours with alpha-gradient trail fading + Earth shadow ─
  const { coreColors, coreOpacities, glowColors, glowOpacities } = useMemo(() => {
    const n = positions.length;
    if (n === 0) {
      return {
        coreColors: [] as [number, number, number][],
        coreOpacities: [] as number[],
        glowColors: [] as [number, number, number][],
        glowOpacities: [] as number[],
      };
    }

    const camDir = new THREE.Vector3()
      .copy(camera.position)
      .normalize();

    const core: [number, number, number][] = [];
    const coreAlpha: number[] = [];
    const glow: [number, number, number][] = [];
    const glowAlpha: number[] = [];

    for (let i = 0; i < n; i++) {
      // Wrap-aware distance from satellite
      let dist = currentIndex - i;
      if (dist < 0) dist += n;

      // Trail: bright near satellite → fades behind
      const trailLength = n * 0.7;
      let brightness: number;
      let alpha: number;

      if (dist <= trailLength) {
        const ratio = dist / trailLength;
        brightness = 1.0 - ratio * 0.6;
        // Alpha fading (#8) — smooth ease-out curve
        alpha = 1.0 - Math.pow(ratio, 1.8) * 0.85;
      } else {
        brightness = 0.15;
        // Far tail fades to near-invisible
        const tailRatio = (dist - trailLength) / (n - trailLength);
        alpha = Math.max(0.03, 0.15 - tailRatio * 0.15);
      }

      // Earth-shadow: dim points on the far side from camera
      const pos = positions[i];
      const ptDir = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
      const dot = camDir.dot(ptDir);
      if (dot < -0.1) {
        const shadowFactor = Math.max(0.2, 1.0 + dot);
        brightness *= shadowFactor;
        alpha *= shadowFactor;
      }

      core.push([
        baseRgb[0] * brightness,
        baseRgb[1] * brightness,
        baseRgb[2] * brightness,
      ]);
      coreAlpha.push(Math.min(0.95, alpha));

      glow.push([
        baseRgb[0] * brightness * 0.7,
        baseRgb[1] * brightness * 0.7,
        baseRgb[2] * brightness * 0.7,
      ]);
      glowAlpha.push(Math.min(0.2, alpha * 0.25));
    }

    return {
      coreColors: core,
      coreOpacities: coreAlpha,
      glowColors: glow,
      glowOpacities: glowAlpha,
    };
  }, [positions, currentIndex, baseRgb, camera.position]);

  if (positions.length < 2 || coreColors.length === 0) return null;

  return (
    <group visible={visible}>
      {/* Glow halo — wider, with alpha gradient */}
      <Line
        points={points}
        vertexColors={glowColors}
        lineWidth={6}
        transparent
        opacity={0.15}
        depthWrite={false}
      />

      {/* Core trajectory — bright, with per-vertex alpha fading */}
      <Line
        points={points}
        vertexColors={coreColors}
        lineWidth={2.5}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </group>
  );
}

"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/* ────────────────────────────────────────────────────────────────
 * OrbitPath — renders a satellite trajectory as a glowing line.
 *
 * Uses imperative THREE.Line objects attached via <primitive> to
 * avoid R3F/TypeScript JSX issues with the <line> element.
 *
 * Two overlapping lines create the glow effect:
 *   1. Bright inner line  — the sharp trajectory
 *   2. Wider transparent outer line — the soft glow halo
 *
 * Geometry is memoised so it is only rebuilt when positions change.
 * ──────────────────────────────────────────────────────────────── */

interface OrbitPathProps {
  /** Trajectory points in world units — array of [x, y, z]. */
  positions: [number, number, number][];
  /** Line colour (CSS / hex string). @default "#00e5ff" (cyan) */
  color?: string;
  /** Opacity of the core line. @default 0.9 */
  opacity?: number;
  /** Whether the path is visible. @default true */
  visible?: boolean;
}

export default function OrbitPath({
  positions,
  color = "#00e5ff",
  opacity = 0.9,
  visible = true,
}: OrbitPathProps) {
  const coreRef = useRef<THREE.Line>(null);
  const glowRef = useRef<THREE.Line>(null);

  // ── Build geometry once and reuse until positions change ───
  const geometry = useMemo(() => {
    if (positions.length === 0) return new THREE.BufferGeometry();

    const flat = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i++) {
      flat[i * 3] = positions[i][0];
      flat[i * 3 + 1] = positions[i][1];
      flat[i * 3 + 2] = positions[i][2];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    return geo;
  }, [positions]);

  // ── Imperative Line objects (avoids JSX <line> type issues) ─
  const coreLine = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    return new THREE.Line(geometry, mat);
  }, [geometry, color, opacity]);

  const glowLine = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: opacity * 0.25,
      depthWrite: false,
    });
    return new THREE.Line(geometry, mat);
  }, [geometry, color, opacity]);

  // ── Keep refs synced (for potential future interaction) ─────
  useFrame(() => {
    if (coreRef.current) coreRef.current.visible = visible;
    if (glowRef.current) glowRef.current.visible = visible;
  });

  if (positions.length < 2) return null;

  return (
    <group>
      {/* Glow halo (rendered first so it sits behind) */}
      <primitive ref={glowRef} object={glowLine} />
      {/* Core trajectory line */}
      <primitive ref={coreRef} object={coreLine} />
    </group>
  );
}

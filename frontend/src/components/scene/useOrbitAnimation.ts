"use client";

import { useRef, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitalParameters } from "@/types/orbit";

/* ────────────────────────────────────────────────────────────────
 * useOrbitAnimation — drives satellite position along a trajectory.
 *
 * Upgrades:
 *   • CatmullRomCurve3 for smooth closed-loop interpolation
 *   • Computes live OrbitalParameters telemetry each frame
 *   • Speed / pause driven by external props
 *   • All mutable state in refs — zero React re-renders
 * ──────────────────────────────────────────────────────────────── */

interface UseOrbitAnimationOptions {
  /** Trajectory positions in world units — [x, y, z] per epoch. */
  positions: [number, number, number][];
  /** Epoch timestamps in seconds (same length as positions). */
  times: number[];
  /** Velocities in world units/s (optional, for telemetry). */
  velocities?: [number, number, number][];
  /** Playback speed multiplier. @default 1 */
  speed?: number;
  /** Loop the animation when it reaches the end. @default true */
  loop?: boolean;
  /** Pause the animation. @default false */
  paused?: boolean;
  /** Orbital inclination in degrees (for telemetry display). */
  inclinationDeg?: number;
  /** Callback fired each frame with updated telemetry. */
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
}

interface OrbitAnimationState {
  /** Interpolated position for the current frame — smooth via CatmullRom. */
  currentPosition: [number, number, number];
  /** Index of the nearest waypoint (for motion trail). */
  currentIndex: number;
  /** 0 → 1 progress through the full trajectory. */
  progress: number;
}

/**
 * Animate a satellite along a pre-computed orbit trajectory.
 *
 * Uses CatmullRomCurve3 with `closed=true` for seamless looping
 * and buttery-smooth interpolation between waypoints.
 */
export function useOrbitAnimation({
  positions,
  times,
  velocities,
  speed = 1,
  loop = true,
  paused = false,
  inclinationDeg = 51.6,
  onTelemetryUpdate,
}: UseOrbitAnimationOptions): OrbitAnimationState {
  const elapsedRef = useRef(0);
  const resultRef = useRef<OrbitAnimationState>({
    currentPosition: positions.length > 0 ? positions[0] : [0, 0, 0],
    currentIndex: 0,
    progress: 0,
  });

  // ── Build CatmullRom spline for smooth interpolation ──────
  const curveRef = useRef<THREE.CatmullRomCurve3 | null>(null);
  const prevPositionsLength = useRef(0);

  // Rebuild curve when positions change
  if (positions.length >= 2 && positions.length !== prevPositionsLength.current) {
    const points = positions.map(
      ([x, y, z]) => new THREE.Vector3(x, y, z),
    );
    curveRef.current = new THREE.CatmullRomCurve3(points, loop, "catmullrom", 0.5);
    prevPositionsLength.current = positions.length;
  }

  // Memoised telemetry callback ref to avoid stale closures
  const telemetryRef = useRef(onTelemetryUpdate);
  telemetryRef.current = onTelemetryUpdate;

  // Stable Vector3 for reuse (avoid per-frame allocations)
  const tempVec = useRef(new THREE.Vector3());

  useFrame((_state, delta) => {
    if (paused || positions.length < 2 || times.length < 2) return;
    if (!curveRef.current) return;

    const totalDuration = times[times.length - 1] - times[0];
    if (totalDuration <= 0) return;

    // Advance simulation clock
    elapsedRef.current += delta * speed;

    // Handle looping / clamping
    if (loop) {
      elapsedRef.current =
        ((elapsedRef.current % totalDuration) + totalDuration) % totalDuration;
    } else {
      elapsedRef.current = Math.min(elapsedRef.current, totalDuration);
    }

    const progress = elapsedRef.current / totalDuration;

    // ── CatmullRom smooth interpolation ─────────────────────
    curveRef.current.getPointAt(
      Math.min(progress, 0.9999),
      tempVec.current,
    );
    const pos: [number, number, number] = [
      tempVec.current.x,
      tempVec.current.y,
      tempVec.current.z,
    ];

    // Nearest waypoint index (for motion trail colouring)
    const nearestIndex = Math.round(progress * (positions.length - 1));

    // ── Write results to ref ────────────────────────────────
    resultRef.current.currentPosition = pos;
    resultRef.current.currentIndex = nearestIndex;
    resultRef.current.progress = progress;

    // ── Compute telemetry ───────────────────────────────────
    if (telemetryRef.current) {
      // Altitude: distance from origin minus Earth radius (1 world unit)
      const dist = Math.sqrt(pos[0] ** 2 + pos[1] ** 2 + pos[2] ** 2);
      const altitudeKm = (dist - 1) * 6371; // Earth radius = 6371 km

      // Velocity: from supplied velocities or approximate from curve tangent
      let velocityKmS = 0;
      if (velocities && velocities.length > nearestIndex) {
        const v = velocities[nearestIndex];
        velocityKmS =
          Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) * 6371;
      } else {
        // Approximate from curve tangent
        const tangent = curveRef.current.getTangentAt(
          Math.min(progress, 0.9999),
        );
        const orbitCircumference = dist * 2 * Math.PI;
        velocityKmS = (orbitCircumference * 6371) / (totalDuration / 1000);
        // Use tangent magnitude as scaling hint
        velocityKmS = tangent.length() * velocityKmS * 0.001;
      }

      telemetryRef.current({
        altitudeKm: Math.max(0, altitudeKm),
        velocityKmS: Math.abs(velocityKmS),
        inclinationDeg,
        periodMin: totalDuration / 60,
        progress,
      });
    }
  });

  return resultRef.current;
}

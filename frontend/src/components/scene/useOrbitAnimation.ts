"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

/* ────────────────────────────────────────────────────────────────
 * useOrbitAnimation — drives satellite position along a trajectory.
 *
 * Uses R3F's `useFrame` to advance an internal time accumulator
 * every frame.  Linearly interpolates between adjacent waypoints
 * for buttery-smooth motion regardless of waypoint density.
 *
 * All mutable state lives in refs so the hook NEVER triggers a
 * React re-render — position updates go straight to the mesh.
 * ──────────────────────────────────────────────────────────────── */

interface UseOrbitAnimationOptions {
  /** Trajectory positions in world units — [x, y, z] per epoch. */
  positions: [number, number, number][];
  /** Epoch timestamps in seconds (same length as positions). */
  times: number[];
  /** Playback speed multiplier. @default 1 */
  speed?: number;
  /** Loop the animation when it reaches the end. @default true */
  loop?: boolean;
  /** Pause the animation. @default false */
  paused?: boolean;
}

interface OrbitAnimationState {
  /** Interpolated position for the current frame. */
  currentPosition: [number, number, number];
  /** Index of the lower-bound waypoint. */
  currentIndex: number;
  /** 0 → 1 progress through the full trajectory. */
  progress: number;
}

/**
 * Animate a satellite along a pre-computed orbit trajectory.
 *
 * @example
 * ```tsx
 * const { currentPosition } = useOrbitAnimation({
 *   positions: scaledPositions,
 *   times: trajectory.times,
 *   speed: 50,
 * });
 * return <Satellite position={currentPosition} />;
 * ```
 */
export function useOrbitAnimation({
  positions,
  times,
  speed = 1,
  loop = true,
  paused = false,
}: UseOrbitAnimationOptions): OrbitAnimationState {
  // ── Mutable refs — avoid React re-renders ─────────────────
  const elapsedRef = useRef(0);
  const resultRef = useRef<OrbitAnimationState>({
    currentPosition: positions.length > 0 ? positions[0] : [0, 0, 0],
    currentIndex: 0,
    progress: 0,
  });

  useFrame((_state, delta) => {
    if (paused || positions.length < 2 || times.length < 2) return;

    const totalDuration = times[times.length - 1] - times[0];
    if (totalDuration <= 0) return;

    // Advance simulation clock
    elapsedRef.current += delta * speed;

    // Handle looping / clamping
    if (loop) {
      elapsedRef.current = elapsedRef.current % totalDuration;
    } else {
      elapsedRef.current = Math.min(elapsedRef.current, totalDuration);
    }

    const simTime = times[0] + elapsedRef.current;

    // ── Binary-search for the correct segment ───────────────
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] <= simTime) lo = mid;
      else hi = mid;
    }

    // ── Lerp between waypoints ──────────────────────────────
    const t0 = times[lo];
    const t1 = times[Math.min(lo + 1, times.length - 1)];
    const segLen = t1 - t0;
    const alpha = segLen > 0 ? (simTime - t0) / segLen : 0;

    const p0 = positions[lo];
    const p1 = positions[Math.min(lo + 1, positions.length - 1)];

    const lerpX = p0[0] + (p1[0] - p0[0]) * alpha;
    const lerpY = p0[1] + (p1[1] - p0[1]) * alpha;
    const lerpZ = p0[2] + (p1[2] - p0[2]) * alpha;

    // ── Write results straight to the ref ───────────────────
    resultRef.current.currentPosition = [lerpX, lerpY, lerpZ];
    resultRef.current.currentIndex = lo;
    resultRef.current.progress = elapsedRef.current / totalDuration;
  });

  return resultRef.current;
}

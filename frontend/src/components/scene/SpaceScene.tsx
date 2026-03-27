"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars, Preload } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import Earth from "./Earth";
import CameraController from "./CameraController";
import OrbitPath from "./OrbitPath";
import Satellite from "./Satellite";
import { useOrbitAnimation } from "./useOrbitAnimation";
import { fetchOrbitSimulation } from "@/lib/api";
import {
  SCALE_FACTOR,
  type OrbitSimulationResponse,
  type ScaledTrajectory,
} from "@/types/orbit";

/* ────────────────────────────────────────────────────────────────
 * Mock orbit data — a circular LEO orbit (~400 km altitude).
 *
 * Used as a fallback when the backend is not running, so the
 * visualisation always shows _something_ useful during development.
 * ──────────────────────────────────────────────────────────────── */

function generateMockOrbit(
  numPoints: number = 360,
  altitudeKm: number = 400,
  inclinationDeg: number = 51.6,   // ISS-like inclination
): ScaledTrajectory {
  const radiusWorld = 1 + altitudeKm / 6371;           // Earth radius = 1
  const inclination = (inclinationDeg * Math.PI) / 180;
  const period = 5400;                                  // ~90 min in seconds

  const times: number[] = [];
  const positions: [number, number, number][] = [];

  for (let i = 0; i <= numPoints; i++) {
    const t = (i / numPoints) * period;
    const angle = (i / numPoints) * Math.PI * 2;

    // Orbit in the XZ plane, then rotate by inclination about X
    const x = radiusWorld * Math.cos(angle);
    const y = radiusWorld * Math.sin(angle) * Math.sin(inclination);
    const z = radiusWorld * Math.sin(angle) * Math.cos(inclination);

    times.push(t);
    positions.push([x, y, z]);
  }

  return { times, positions };
}

/* ────────────────────────────────────────────────────────────────
 * scaleTrajectory — convert backend SI-unit response to world units.
 * ──────────────────────────────────────────────────────────────── */

function scaleTrajectory(data: OrbitSimulationResponse): ScaledTrajectory {
  return {
    times: data.time,
    positions: data.position.map(
      ([x, y, z]) =>
        [x / SCALE_FACTOR, y / SCALE_FACTOR, z / SCALE_FACTOR] as [number, number, number],
    ),
  };
}

/* ────────────────────────────────────────────────────────────────
 * OrbitLayer — fetches (or mocks) orbit data, then renders the
 * orbit path and animated satellite.
 *
 * This component lives INSIDE <Canvas> so it can use R3F hooks
 * (useFrame via the animation hook).  It is designed for easy
 * extension to multiple satellites — just render multiple
 * <OrbitLayer /> instances with different initial conditions.
 * ──────────────────────────────────────────────────────────────── */

interface OrbitLayerProps {
  /** Override trajectory instead of fetching from API. */
  trajectory?: ScaledTrajectory;
  /** Animation speed multiplier. @default 50 */
  animationSpeed?: number;
  /** Orbit line colour. @default "#00e5ff" */
  orbitColor?: string;
}

function OrbitLayer({
  trajectory: externalTrajectory,
  animationSpeed = 50,
  orbitColor = "#00e5ff",
}: OrbitLayerProps) {
  const [trajectory, setTrajectory] = useState<ScaledTrajectory | null>(
    externalTrajectory ?? null,
  );

  // ── Fetch orbit data from backend (falls back to mock) ────
  const loadOrbit = useCallback(async () => {
    if (externalTrajectory) return; // already provided externally

    try {
      const response = await fetchOrbitSimulation({
        initial_position: [7_000_000, 0, 0],       // ~630 km altitude
        initial_velocity: [0, 7546, 0],             // circular velocity
        time_span: 5400,                            // ~1 orbit period
        time_step: 10,
        max_points: 500,
        include_metadata: false,
      });
      setTrajectory(scaleTrajectory(response));
    } catch {
      // Backend unavailable — use mock data for development
      console.warn("[OrbitLayer] Backend unavailable, using mock orbit data.");
      setTrajectory(generateMockOrbit());
    }
  }, [externalTrajectory]);

  useEffect(() => {
    loadOrbit();
  }, [loadOrbit]);

  if (!trajectory || trajectory.positions.length < 2) return null;

  return (
    <AnimatedOrbit
      trajectory={trajectory}
      animationSpeed={animationSpeed}
      orbitColor={orbitColor}
    />
  );
}

/* ────────────────────────────────────────────────────────────────
 * AnimatedOrbit — separated so the animation hook has guaranteed
 * access to a valid trajectory (avoids conditional hook calls).
 * ──────────────────────────────────────────────────────────────── */

interface AnimatedOrbitProps {
  trajectory: ScaledTrajectory;
  animationSpeed: number;
  orbitColor: string;
}

function AnimatedOrbit({
  trajectory,
  animationSpeed,
  orbitColor,
}: AnimatedOrbitProps) {
  const { currentPosition } = useOrbitAnimation({
    positions: trajectory.positions,
    times: trajectory.times,
    speed: animationSpeed,
    loop: true,
  });

  return (
    <>
      <OrbitPath positions={trajectory.positions} color={orbitColor} />
      <Satellite position={currentPosition} />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────
 * SpaceScene — root 3D container for mission-control.
 *
 * Visual upgrades in this version:
 *   • ACES filmic tone mapping for cinematic contrast
 *   • Physically tuned lighting — very low ambient (0.05) plus
 *     a strong directional "sun" for a crisp day/night split
 *   • Camera starts at z=8 (far) for the intro zoom animation
 *   • Stars tuned with factor=4 for depth parallax
 *   • Satellite orbit path and animated satellite
 *
 * Extension points:
 *   • Add more <OrbitLayer /> for multi-satellite support
 *   • Connect to WebSocket for real-time trajectory updates
 * ──────────────────────────────────────────────────────────────── */

export default function SpaceScene() {
  return (
    <Canvas
      /* Camera starts far out — CameraController will lerp it in */
      camera={{
        position: [0, 0, 8],
        fov: 55,
        near: 0.1,
        far: 1000,
      }}
      /* Cap pixel ratio to 2× — retina quality without GPU strain */
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
      }}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    >
      {/* ── Lighting ────────────────────────────────────────── */}
      {/* Very low ambient — lets the dark side stay dark so
          emissive city-lights can shine through.              */}
      <ambientLight intensity={0.05} />
      {/* Strong directional "sun" for a clean day/night split */}
      <directionalLight position={[5, 2, 2]} intensity={2} />

      {/* ── Scene content ───────────────────────────────────── */}
      <Suspense fallback={null}>
        <Earth />

        {/* ── Satellite orbit ─────────────────────────────── */}
        <OrbitLayer />

        {/* Star field — tuned for depth parallax */}
        <Stars
          radius={100}
          depth={60}
          count={4000}
          factor={4}
          saturation={0}
          fade
          speed={0.5}
        />
      </Suspense>

      {/* ── Controls + intro animation ──────────────────────── */}
      <CameraController />

      {/* Eagerly preload all drei assets (textures, etc.) */}
      <Preload all />
    </Canvas>
  );
}

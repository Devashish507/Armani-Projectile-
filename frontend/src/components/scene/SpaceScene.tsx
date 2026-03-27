"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars, Preload } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import Earth from "./Earth";
import CameraController from "./CameraController";
import OrbitPath from "./OrbitPath";
import Satellite from "./Satellite";
import OrbitPlane from "./OrbitPlane";
import { useOrbitAnimation } from "./useOrbitAnimation";
import { fetchOrbitSimulation } from "@/lib/api";
import {
  SCALE_FACTOR,
  type OrbitSimulationResponse,
  type ScaledTrajectory,
  type OrbitPlaybackState,
  type OrbitalParameters,
} from "@/types/orbit";

/* ────────────────────────────────────────────────────────────────
 * Mock orbit data — ISS-like circular LEO orbit (~400 km alt).
 * ──────────────────────────────────────────────────────────────── */

function generateMockOrbit(
  numPoints: number = 500,
  altitudeKm: number = 400,
  inclinationDeg: number = 51.6,
): ScaledTrajectory {
  const radiusWorld = 1 + altitudeKm / 6371;
  const inclination = (inclinationDeg * Math.PI) / 180;
  const period = 5400; // ~90 min

  const times: number[] = [];
  const positions: [number, number, number][] = [];

  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * period;
    const angle = (i / numPoints) * Math.PI * 2;

    const x = radiusWorld * Math.cos(angle);
    const y = radiusWorld * Math.sin(angle) * Math.sin(inclination);
    const z = radiusWorld * Math.sin(angle) * Math.cos(inclination);

    times.push(t);
    positions.push([x, y, z]);
  }

  return { times, positions };
}

/* ────────────────────────────────────────────────────────────────
 * Convert backend SI-unit response to scene world units.
 * ──────────────────────────────────────────────────────────────── */

function scaleTrajectory(data: OrbitSimulationResponse): ScaledTrajectory {
  return {
    times: data.time,
    positions: data.position.map(
      ([x, y, z]) =>
        [x / SCALE_FACTOR, y / SCALE_FACTOR, z / SCALE_FACTOR] as [number, number, number],
    ),
    velocities: data.velocity.map(
      ([vx, vy, vz]) =>
        [vx / SCALE_FACTOR, vy / SCALE_FACTOR, vz / SCALE_FACTOR] as [number, number, number],
    ),
  };
}

/* ────────────────────────────────────────────────────────────────
 * OrbitLayer — fetches orbit data, then renders orbit path,
 * animated satellite, and orbital plane indicator.
 * ──────────────────────────────────────────────────────────────── */

interface OrbitLayerProps {
  /** Override trajectory instead of fetching from API. */
  trajectory?: ScaledTrajectory;
  /** Playback state from the HUD. */
  playback: OrbitPlaybackState;
  /** Callback to push telemetry to the HUD. */
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  /** Callback to push satellite position (for camera follow). */
  onPositionUpdate?: (pos: [number, number, number]) => void;
  /** Orbit line colour. @default "#00e5ff" */
  orbitColor?: string;
}

function OrbitLayer({
  trajectory: externalTrajectory,
  playback,
  onTelemetryUpdate,
  onPositionUpdate,
  orbitColor = "#00e5ff",
}: OrbitLayerProps) {
  const [trajectory, setTrajectory] = useState<ScaledTrajectory | null>(
    externalTrajectory ?? null,
  );

  const loadOrbit = useCallback(async () => {
    if (externalTrajectory) return;

    try {
      const response = await fetchOrbitSimulation({
        initial_position: [7_000_000, 0, 0],
        initial_velocity: [0, 7546, 0],
        time_span: 5400,
        time_step: 10,
        max_points: 500,
        include_metadata: false,
      });
      setTrajectory(scaleTrajectory(response));
    } catch {
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
      playback={playback}
      orbitColor={orbitColor}
      onTelemetryUpdate={onTelemetryUpdate}
      onPositionUpdate={onPositionUpdate}
    />
  );
}

/* ────────────────────────────────────────────────────────────────
 * AnimatedOrbit — separated so the animation hook has guaranteed
 * access to a valid trajectory (no conditional hooks).
 * ──────────────────────────────────────────────────────────────── */

interface AnimatedOrbitProps {
  trajectory: ScaledTrajectory;
  playback: OrbitPlaybackState;
  orbitColor: string;
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  onPositionUpdate?: (pos: [number, number, number]) => void;
}

function AnimatedOrbit({
  trajectory,
  playback,
  orbitColor,
  onTelemetryUpdate,
  onPositionUpdate,
}: AnimatedOrbitProps) {
  const posUpdateRef = useRef(onPositionUpdate);
  posUpdateRef.current = onPositionUpdate;

  const { currentPosition, currentIndex } = useOrbitAnimation({
    positions: trajectory.positions,
    times: trajectory.times,
    velocities: trajectory.velocities,
    speed: playback.speed,
    loop: true,
    paused: playback.paused,
    onTelemetryUpdate,
  });

  // Push satellite position up for camera follow
  // (done in the next frame to avoid re-render loops)
  if (posUpdateRef.current) {
    posUpdateRef.current(currentPosition);
  }

  // Compute orbit radius for the inclination ring
  const orbitRadius =
    trajectory.positions.length > 0
      ? Math.sqrt(
          trajectory.positions[0][0] ** 2 +
          trajectory.positions[0][1] ** 2 +
          trajectory.positions[0][2] ** 2,
        )
      : 1.063;

  return (
    <>
      <OrbitPath
        positions={trajectory.positions}
        currentIndex={currentIndex}
        color={orbitColor}
      />
      <Satellite position={currentPosition} />
      <OrbitPlane orbitRadius={orbitRadius} />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────
 * SpaceScene — root 3D container for mission-control.
 *
 * Accepts playback state and telemetry callback from the page-
 * level HUD overlay.
 * ──────────────────────────────────────────────────────────────── */

interface SpaceSceneProps {
  /** Playback controls from the HUD. */
  playback?: OrbitPlaybackState;
  /** Callback to push telemetry to the HUD. */
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  /** Callback to push satellite position (for camera follow). */
  onPositionUpdate?: (pos: [number, number, number]) => void;
}

export default function SpaceScene({
  playback = { paused: false, speed: 50, followCamera: false },
  onTelemetryUpdate,
  onPositionUpdate,
}: SpaceSceneProps) {
  // Store satellite position for camera follow
  const [satPos, setSatPos] = useState<[number, number, number]>([0, 0, 0]);

  const handlePositionUpdate = useCallback(
    (pos: [number, number, number]) => {
      setSatPos(pos);
      onPositionUpdate?.(pos);
    },
    [onPositionUpdate],
  );

  return (
    <Canvas
      camera={{
        position: [0, 0, 8],
        fov: 55,
        near: 0.1,
        far: 1000,
      }}
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
      <ambientLight intensity={0.05} />
      <directionalLight position={[5, 2, 2]} intensity={2} />

      {/* ── Scene content ───────────────────────────────────── */}
      <Suspense fallback={null}>
        <Earth />
        <OrbitLayer
          playback={playback}
          onTelemetryUpdate={onTelemetryUpdate}
          onPositionUpdate={handlePositionUpdate}
        />
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

      {/* ── Controls ────────────────────────────────────────── */}
      <CameraController
        followSatellite={playback.followCamera}
        satellitePosition={satPos}
      />
      <Preload all />
    </Canvas>
  );
}

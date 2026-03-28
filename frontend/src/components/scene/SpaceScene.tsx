"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Stars, Preload } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import * as THREE from "three";
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

import { useOrbitWebSocket } from "@/hooks/useOrbitWebSocket";

// ── Shared configuration ──────────────────────────────────────────

const ORBIT_PARAMS = {
  initial_position: [7_000_000, 0, 0] as [number, number, number],
  initial_velocity: [0, 7546, 0] as [number, number, number],
  time_span: 5400,
  time_step: 10,
};

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws/orbit";

/* ────────────────────────────────────────────────────────────────
 * OrbitLayer — orchestrates data fetching via WebSocket or REST.
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
  // ── WebSocket streaming ──────────────────────────────────────────
  const ws = useOrbitWebSocket({
    url: WS_URL,
    params: ORBIT_PARAMS,
    // Only connect if we aren't using an external trajectory
    enabled: !externalTrajectory,
  });

  // Flow control: WebSockets try first. If we hit an error gracefully fall back.
  const useFallback =
    externalTrajectory !== undefined || ws.connectionState === "error";

  // ── REST Fallback (existing behaviour) ───────────────────────────
  const [restTrajectory, setRestTrajectory] = useState<ScaledTrajectory | null>(
    externalTrajectory ?? null,
  );

  const loadOrbit = useCallback(async () => {
    if (externalTrajectory) return;

    try {
      const response = await fetchOrbitSimulation({
        ...ORBIT_PARAMS,
        max_points: 500,
        include_metadata: false,
      });
      setRestTrajectory(scaleTrajectory(response));
    } catch {
      console.warn("[OrbitLayer] Backend unavailable, using mock orbit data.");
      setRestTrajectory(generateMockOrbit());
    }
  }, [externalTrajectory]);

  useEffect(() => {
    if (useFallback) {
      loadOrbit();
    }
  }, [useFallback, loadOrbit]);

  // ── Render correct layer ─────────────────────────────────────────
  if (useFallback) {
    if (!restTrajectory || restTrajectory.positions.length < 2) return null;
    return (
      <AnimatedOrbit
        trajectory={restTrajectory}
        playback={playback}
        orbitColor={orbitColor}
        onTelemetryUpdate={onTelemetryUpdate}
        onPositionUpdate={onPositionUpdate}
      />
    );
  }

  // If streaming but no data has arrived yet, don't bomb the scene
  if (
    ws.connectionState === "idle" ||
    ws.connectionState === "connecting" ||
    ws.trajectoryRef.current.length === 0
  ) {
    return null;
  }

  return (
    <StreamedOrbit
      ws={ws}
      orbitColor={orbitColor}
      onTelemetryUpdate={onTelemetryUpdate}
      onPositionUpdate={onPositionUpdate}
    />
  );
}

/* ────────────────────────────────────────────────────────────────
 * StreamedOrbit — reads from WebSocket refs directly (no re-renders).
 * ──────────────────────────────────────────────────────────────── */

import { useFrame } from "@react-three/fiber";

interface StreamedOrbitProps {
  ws: ReturnType<typeof useOrbitWebSocket>;
  orbitColor: string;
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  onPositionUpdate?: (pos: [number, number, number]) => void;
}

function StreamedOrbit({
  ws,
  orbitColor,
  onTelemetryUpdate,
  onPositionUpdate,
}: StreamedOrbitProps) {
  const telemetryRef = useRef(onTelemetryUpdate);
  const posUpdateRef = useRef(onPositionUpdate);

  useEffect(() => {
    telemetryRef.current = onTelemetryUpdate;
    posUpdateRef.current = onPositionUpdate;
  }, [onTelemetryUpdate, onPositionUpdate]);

  // We wrap the satellite in a group we control directly via ref.
  // This completely eliminates React re-renders during playback!
  const wrapperRef = useRef<THREE.Group>(null);

  // Time-delayed playback buffer (e.g. 150ms delay)
  const BUFFER_DELAY_MS = 150;

  useFrame(() => {
    const buffer = ws.bufferRef.current;
    if (buffer.length === 0) return;

    // We want to render the state as it was BUFFER_DELAY_MS ago
    const renderTime = performance.now() - BUFFER_DELAY_MS;

    let frame0 = buffer[0];
    let frame1 = buffer[buffer.length - 1];

    if (renderTime <= frame0.localTime) {
      // Not enough buffer yet, sit at the first frame
      frame1 = frame0;
    } else if (renderTime >= frame1.localTime) {
      // Drained buffer (lag spike), sit at the last frame
      frame0 = frame1;
    } else {
      // Find the two frames spanning renderTime
      for (let i = buffer.length - 1; i > 0; i--) {
        if (buffer[i - 1].localTime <= renderTime && renderTime <= buffer[i].localTime) {
          frame0 = buffer[i - 1];
          frame1 = buffer[i];
          break;
        }
      }
    }

    // Interpolation factor t: [0, 1]
    let t = 0;
    if (frame1.localTime > frame0.localTime) {
      t = (renderTime - frame0.localTime) / (frame1.localTime - frame0.localTime);
    }

    // Linear interpolation for position
    const x = frame0.position[0] + (frame1.position[0] - frame0.position[0]) * t;
    const y = frame0.position[1] + (frame1.position[1] - frame0.position[1]) * t;
    const z = frame0.position[2] + (frame1.position[2] - frame0.position[2]) * t;

    // Apply native mutation to bypass React rendering costs
    if (wrapperRef.current) {
      wrapperRef.current.position.set(x, y, z);
    }

    if (posUpdateRef.current) {
      posUpdateRef.current([x, y, z]);
    }

    if (telemetryRef.current) {
      const dist = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
      const altitudeKm = (dist - 1) * 6371;

      // Interpolate velocity
      const vx = frame0.velocity[0] + (frame1.velocity[0] - frame0.velocity[0]) * t;
      const vy = frame0.velocity[1] + (frame1.velocity[1] - frame0.velocity[1]) * t;
      const vz = frame0.velocity[2] + (frame1.velocity[2] - frame0.velocity[2]) * t;
      const velocityKmS = Math.sqrt(vx ** 2 + vy ** 2 + vz ** 2) * 6371;

      // Interpolate progress/step
      const currentStep = frame0.step + (frame1.step - frame0.step) * t;
      const progress =
        ws.totalStepsRef.current > 0
          ? currentStep / ws.totalStepsRef.current
          : 0;

      telemetryRef.current({
        altitudeKm: Math.max(0, altitudeKm),
        velocityKmS: Math.abs(velocityKmS),
        inclinationDeg: 51.6, // Hardware/params derived
        periodMin: ORBIT_PARAMS.time_span / 60,
        progress,
      });
    }
  });

  const positions = ws.trajectoryRef.current;
  const orbitRadius =
    positions.length > 0
      ? Math.sqrt(
          positions[0][0] ** 2 + positions[0][1] ** 2 + positions[0][2] ** 2,
        )
      : 1.063;

  return (
    <>
      <OrbitPath
        positions={positions}
        currentIndex={positions.length - 1} // draw the whole growing line
        color={orbitColor}
      />
      <group ref={wrapperRef}>
        <Satellite position={[0, 0, 0]} />
      </group>
      <OrbitPlane orbitRadius={orbitRadius} />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────
 * AnimatedOrbit — existing REST/Mock fallback animation.
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
  useEffect(() => {
    posUpdateRef.current = onPositionUpdate;
  }, [onPositionUpdate]);

  const { currentPosition, currentIndex } = useOrbitAnimation({
    positions: trajectory.positions,
    times: trajectory.times,
    velocities: trajectory.velocities,
    speed: playback.speed,
    loop: true,
    paused: playback.paused,
    onTelemetryUpdate,
  });

  useEffect(() => {
    if (posUpdateRef.current) {
      posUpdateRef.current(currentPosition);
    }
  }, [currentPosition]);

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

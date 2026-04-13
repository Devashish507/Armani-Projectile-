"use client";

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  type WsConnectionState,
  type CameraMode,
  type ConnectionDiagnostics,
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
  const sat = data.satellites[0];
  if (!sat) return { times: [], positions: [], velocities: [] };
  
  return {
    times: sat.time,
    positions: sat.position.map(
      (([x, y, z]: number[]) => 
        [x / SCALE_FACTOR, y / SCALE_FACTOR, z / SCALE_FACTOR] as [number, number, number]) as any
    ),
    velocities: sat.velocity.map(
      (([vx, vy, vz]: number[]) =>
        [vx / SCALE_FACTOR, vy / SCALE_FACTOR, vz / SCALE_FACTOR] as [number, number, number]) as any
    ),
  };
}

import { useOrbitWebSocket } from "@/hooks/useOrbitWebSocket";

// ── Configuration ─────────────────────────────────────────────────

import type { SatelliteConfig } from "@/types/orbit";

export interface OrbitParams {
  satellites: SatelliteConfig[];
  time_span: number;
  time_step: number;
}

/** Default ISS-like LEO orbit used when no params are supplied. */
const DEFAULT_ORBIT_PARAMS: OrbitParams = {
  satellites: [
    {
      id: "sat-1",
      initial_position: [7_000_000, 0, 0],
      initial_velocity: [0, 7546, 0],
    }
  ],
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
  /** Dynamic orbit parameters from the sidebar. */
  orbitParams: OrbitParams;
  /** Whether the simulation is active. */
  simulationActive: boolean;
  /** Callback to push telemetry to the HUD. */
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  /** Callback to push satellite position (for camera follow). */
  onPositionUpdate?: (pos: [number, number, number]) => void;
  /** Callback to push connection status to the HUD */
  onConnectionChange?: (state: WsConnectionState) => void;
  /** Callback to wire diagnostics ref */
  onDiagnosticsReady?: (ref: React.RefObject<ConnectionDiagnostics>) => void;
  /** Array of satellite IDs to hide. */
  hiddenSatellites?: string[];
  /** Orbit line colour. @default "#00e5ff" */
  orbitColor?: string;
}

function OrbitLayer({
  trajectory: externalTrajectory,
  playback,
  orbitParams,
  simulationActive,
  onTelemetryUpdate,
  onPositionUpdate,
  onConnectionChange,
  onDiagnosticsReady,
  hiddenSatellites = [],
  orbitColor = "#00e5ff",
}: OrbitLayerProps) {
  // ── WebSocket streaming ──────────────────────────────────────────
  const ws = useOrbitWebSocket({
    url: WS_URL,
    params: orbitParams,
    // Only connect if simulation is active and no external trajectory
    enabled: simulationActive && !externalTrajectory,
  });

  // Wire diagnostics ref up to dashboard
  useEffect(() => {
    if (onDiagnosticsReady && ws.diagnosticsRef) {
      onDiagnosticsReady(ws.diagnosticsRef);
    }
  }, [onDiagnosticsReady, ws.diagnosticsRef]);

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
      if (onConnectionChange) onConnectionChange("connecting");
      const response = await fetchOrbitSimulation({
        ...orbitParams,
        max_points: 500,
        include_metadata: false,
      });
      setRestTrajectory(scaleTrajectory(response));
      if (onConnectionChange) onConnectionChange("complete");
    } catch {
      console.warn("[OrbitLayer] Backend unavailable, using mock orbit data.");
      setRestTrajectory(generateMockOrbit());
      if (onConnectionChange) onConnectionChange("error");
    }
  }, [externalTrajectory, onConnectionChange, orbitParams]);

  useEffect(() => {
    if (useFallback) {
      loadOrbit();
    }
  }, [useFallback, loadOrbit]);

  // Bubble up WebSocket state
  useEffect(() => {
    if (onConnectionChange && !useFallback) {
      onConnectionChange(ws.connectionState);
    }
  }, [ws.connectionState, useFallback, onConnectionChange]);

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
    ws.satellitesRef.current.size === 0
  ) {
    return null;
  }

  return (
    <StreamedOrbit
      ws={ws}
      orbitParams={orbitParams}
      orbitColor={orbitColor}
      onTelemetryUpdate={onTelemetryUpdate}
      onPositionUpdate={onPositionUpdate}
      hiddenSatellites={hiddenSatellites}
    />
  );
}

/* ────────────────────────────────────────────────────────────────
 * StreamedOrbit — reads from WebSocket refs directly (no re-renders).
 * ──────────────────────────────────────────────────────────────── */

import { useFrame } from "@react-three/fiber";

interface StreamedOrbitProps {
  ws: ReturnType<typeof useOrbitWebSocket>;
  orbitParams: OrbitParams;
  orbitColor: string;
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  onPositionUpdate?: (pos: [number, number, number]) => void;
  hiddenSatellites?: string[];
}

function StreamedOrbit({
  ws,
  orbitParams,
  orbitColor,
  onTelemetryUpdate,
  onPositionUpdate,
  hiddenSatellites = [],
}: StreamedOrbitProps) {
  
  // Extract unique planes for rendering
  const planes = useMemo(() => {
    const uniquePlanes = new Map();
    orbitParams.satellites.forEach(sat => {
      if (sat.metadata) {
        if (!uniquePlanes.has(sat.metadata.planeIndex)) {
          uniquePlanes.set(sat.metadata.planeIndex, {
            ...sat.metadata,
            color: `hsl(${(sat.metadata.planeIndex * 137) % 360}, 100%, 50%)`
          });
        }
      }
    });
    return Array.from(uniquePlanes.values());
  }, [orbitParams.satellites]);

  return (
    <>
      {/* Dynamic Plane Visualizations */}
      {planes.map((p: any) => (
        <OrbitPlane 
          key={`plane-${p.planeIndex}`}
          orbitRadius={p.radius}
          inclinationDeg={(p.inclination * 180) / Math.PI}
          raan={p.raan}
          color={p.color}
          opacity={0.3}
          visible={true}
        />
      ))}
      
      {/* Fallback Single Plane if no metadata exists */}
      {planes.length === 0 && <OrbitPlane orbitRadius={1.063} />}

      {/* Satellites */}
      {orbitParams.satellites
        .filter((sat) => !hiddenSatellites.includes(sat.id))
        .map((sat, index) => {
          const isFirst = index === 0;
          const pColor = sat.metadata 
            ? `hsl(${(sat.metadata.planeIndex * 137) % 360}, 100%, 50%)`
            : (isFirst ? orbitColor : `hsl(${(index * 137) % 360}, 100%, 50%)`);
            
          return (
            <StreamedSatellite 
              key={sat.id} 
              satId={sat.id}
              label={sat.id}
              planeColor={pColor}
              ws={ws} 
              orbitParams={orbitParams} 
              orbitColor={pColor} 
              onTelemetryUpdate={isFirst ? onTelemetryUpdate : undefined}
              onPositionUpdate={isFirst ? onPositionUpdate : undefined}
            />
          );
      })}
    </>
  );
}

function StreamedSatellite({
  satId,
  label,
  planeColor,
  ws,
  orbitParams,
  orbitColor,
  onTelemetryUpdate,
  onPositionUpdate,
}: {
  satId: string;
  label?: string;
  planeColor?: string;
  ws: ReturnType<typeof useOrbitWebSocket>;
  orbitParams: OrbitParams;
  orbitColor: string;
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  onPositionUpdate?: (pos: [number, number, number]) => void;
}) {
  const telemetryRef = useRef(onTelemetryUpdate);
  const posUpdateRef = useRef(onPositionUpdate);

  useEffect(() => {
    telemetryRef.current = onTelemetryUpdate;
    posUpdateRef.current = onPositionUpdate;
  }, [onTelemetryUpdate, onPositionUpdate]);

  const wrapperRef = useRef<THREE.Group>(null);
  const pathRef = useRef<any>(null);
  const currentSimTimeRef = useRef(-1);
  const [positions, setPositions] = useState<[number, number, number][]>([]);

  // Periodically update the path so we don't re-render 60fps, maybe 5fps
  useEffect(() => {
    const interval = setInterval(() => {
      const state = ws.satellitesRef.current.get(satId);
      if (state && state.trajectory.length !== positions.length) {
        setPositions([...state.trajectory]);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [ws, satId, positions.length]);

  useFrame((_state, delta) => {
    const satState = ws.satellitesRef.current.get(satId);
    if (!satState) return;
    const buffer = satState.buffer;
    if (buffer.length === 0) return;

    const latencyDelayMs = Math.max(150, ws.avgLatencyRef.current * 1.5);
    const SIM_SPEED = orbitParams.time_step / (50 / 1000); 
    const latencyDelaySim = (latencyDelayMs / 1000) * SIM_SPEED;

    const latestServerTime = buffer[buffer.length - 1].serverTime;
    const targetSimTime = latestServerTime - latencyDelaySim;

    if (currentSimTimeRef.current === -1) {
      currentSimTimeRef.current = targetSimTime;
    }

    const timeSpring = (targetSimTime - currentSimTimeRef.current) * 2.0;
    currentSimTimeRef.current += (delta * SIM_SPEED) + (timeSpring * delta);

    const rTime = currentSimTimeRef.current;

    let frame0 = buffer[0];
    let frame1 = buffer[buffer.length - 1];

    if (rTime <= frame0.serverTime) {
      frame1 = frame0;
    } else if (rTime >= frame1.serverTime) {
      frame0 = frame1;
    } else {
      for (let i = buffer.length - 1; i > 0; i--) {
        if (buffer[i - 1].serverTime <= rTime && rTime <= buffer[i].serverTime) {
          frame0 = buffer[i - 1];
          frame1 = buffer[i];
          break;
        }
      }
    }

    let t = 0;
    const dt = frame1.serverTime - frame0.serverTime;
    if (dt > 0) {
      t = (rTime - frame0.serverTime) / dt;
    }

    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const x = h00 * frame0.position[0] + h10 * frame0.velocity[0] * dt
            + h01 * frame1.position[0] + h11 * frame1.velocity[0] * dt;
    const y = h00 * frame0.position[1] + h10 * frame0.velocity[1] * dt
            + h01 * frame1.position[1] + h11 * frame1.velocity[1] * dt;
    const z = h00 * frame0.position[2] + h10 * frame0.velocity[2] * dt
            + h01 * frame1.position[2] + h11 * frame1.velocity[2] * dt;

    if (wrapperRef.current) {
      wrapperRef.current.position.set(x, y, z);
    }

    if (posUpdateRef.current) {
      posUpdateRef.current([x, y, z]);
    }

    if (telemetryRef.current) {
      const dist = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
      const altitudeKm = (dist - 1) * 6371;

      const vx = frame0.velocity[0] + (frame1.velocity[0] - frame0.velocity[0]) * t;
      const vy = frame0.velocity[1] + (frame1.velocity[1] - frame0.velocity[1]) * t;
      const vz = frame0.velocity[2] + (frame1.velocity[2] - frame0.velocity[2]) * t;
      const velocityKmS = Math.sqrt(vx ** 2 + vy ** 2 + vz ** 2) * 6371;

      const currentStep = frame0.step + (frame1.step - frame0.step) * t;
      const progress =
        ws.totalStepsRef.current > 0
          ? currentStep / ws.totalStepsRef.current
          : 0;

      telemetryRef.current({
        altitudeKm: Math.max(0, altitudeKm),
        velocityKmS: Math.abs(velocityKmS),
        inclinationDeg: 51.6,
        periodMin: orbitParams.time_span / 60,
        progress,
      });
    }
  });

  return (
    <>
      {positions.length > 0 && (
        <OrbitPath
          positions={positions}
          currentIndex={positions.length - 1}
          color={orbitColor}
        />
      )}
      <group ref={wrapperRef}>
        <Satellite position={[0, 0, 0]} color={orbitColor} />
      </group>
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
  /** Active camera mode. */
  cameraMode?: CameraMode;
  /** Dynamic orbit parameters. */
  orbitParams?: OrbitParams;
  /** Whether the simulation is currently active. */
  simulationActive?: boolean;
  /** Callback to push telemetry to the HUD. */
  onTelemetryUpdate?: (params: OrbitalParameters) => void;
  /** Callback to push connection state to the HUD. */
  onConnectionChange?: (state: WsConnectionState) => void;
  /** Callback to push satellite position (for camera follow). */
  onPositionUpdate?: (pos: [number, number, number]) => void;
  /** Callback to wire diagnostics ref from WS hook to the dashboard. */
  onDiagnosticsReady?: (ref: React.RefObject<ConnectionDiagnostics>) => void;
  /** Array of satellite IDs that should be hidden from view. */
  hiddenSatellites?: string[];
}

export default function SpaceScene({
  playback = { paused: false, speed: 50, followCamera: false },
  cameraMode = "orbit",
  orbitParams = DEFAULT_ORBIT_PARAMS,
  simulationActive = true,
  onTelemetryUpdate,
  onConnectionChange,
  onPositionUpdate,
  onDiagnosticsReady,
  hiddenSatellites = [],
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
          orbitParams={orbitParams}
          simulationActive={simulationActive}
          onTelemetryUpdate={onTelemetryUpdate}
          onConnectionChange={onConnectionChange}
          onPositionUpdate={handlePositionUpdate}
          onDiagnosticsReady={onDiagnosticsReady}
          hiddenSatellites={hiddenSatellites}
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
        cameraMode={cameraMode}
        satellitePosition={satPos}
      />
      <Preload all />
    </Canvas>
  );
}

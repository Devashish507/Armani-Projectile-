"use client";

/**
 * MissionContext — centralised state management for the dashboard.
 *
 * Architecture decision: lightweight React Context over external stores
 * (Zustand, Jotai) because the state graph is small and all consumers
 * live within a single page. If the app grows to multi-page, this can
 * be trivially migrated to Zustand.
 *
 * State is split into two conceptual groups:
 *   1. User-authored  — params, playback controls
 *   2. System-derived — telemetry, WS status (written by scene/hooks)
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type {
  OrbitalParameters,
  OrbitPlaybackState,
  WsConnectionState,
} from "@/types/orbit";

// ── Param types ────────────────────────────────────────────────────

export interface MissionParams {
  initial_position: [number, number, number];
  initial_velocity: [number, number, number];
  time_span: number;
  time_step: number;
}

/** ISS-like LEO defaults — pre-filled in the sidebar form. */
export const DEFAULT_PARAMS: MissionParams = {
  initial_position: [7_000_000, 0, 0],
  initial_velocity: [0, 7546, 0],
  time_span: 5400,
  time_step: 10,
};

// ── Context shape ──────────────────────────────────────────────────

interface MissionContextValue {
  // ── User-authored state ──────────────────────────────────────────
  params: MissionParams;
  setParams: (p: MissionParams) => void;

  playback: OrbitPlaybackState;
  togglePause: () => void;
  setSpeed: (s: number) => void;
  toggleFollow: () => void;

  // ── Simulation lifecycle ─────────────────────────────────────────
  simulationActive: boolean;
  simulationKey: number; // increment to force remount/reconnect
  startSimulation: () => void;
  pauseSimulation: () => void;
  resetSimulation: () => void;

  // ── System-derived state (written by scene) ──────────────────────
  telemetry: OrbitalParameters;
  setTelemetry: (t: OrbitalParameters) => void;

  wsStatus: WsConnectionState;
  setWsStatus: (s: WsConnectionState) => void;
}

const MissionContext = createContext<MissionContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────

export function MissionProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useState<MissionParams>(DEFAULT_PARAMS);

  const [playback, setPlayback] = useState<OrbitPlaybackState>({
    paused: false,
    speed: 50,
    followCamera: false,
  });

  const [simulationActive, setSimulationActive] = useState(true);
  const [simulationKey, setSimulationKey] = useState(0);

  const [telemetry, setTelemetryRaw] = useState<OrbitalParameters>({
    altitudeKm: 0,
    velocityKmS: 0,
    inclinationDeg: 51.6,
    periodMin: 90,
    progress: 0,
  });

  const [wsStatus, setWsStatus] = useState<WsConnectionState>("idle");

  // Throttle telemetry updates to ~10 Hz to avoid cascading re-renders
  const lastUpdate = useRef(0);
  const setTelemetry = useCallback((t: OrbitalParameters) => {
    const now = performance.now();
    if (now - lastUpdate.current > 100) {
      lastUpdate.current = now;
      setTelemetryRaw(t);
    }
  }, []);

  // ── Actions ──────────────────────────────────────────────────────

  const togglePause = useCallback(
    () => setPlayback((p) => ({ ...p, paused: !p.paused })),
    [],
  );
  const setSpeed = useCallback(
    (speed: number) => setPlayback((p) => ({ ...p, speed })),
    [],
  );
  const toggleFollow = useCallback(
    () => setPlayback((p) => ({ ...p, followCamera: !p.followCamera })),
    [],
  );

  const startSimulation = useCallback(() => {
    setSimulationActive(true);
    setSimulationKey((k) => k + 1);
    setPlayback((p) => ({ ...p, paused: false }));
  }, []);

  const pauseSimulation = useCallback(() => {
    setPlayback((p) => ({ ...p, paused: true }));
  }, []);

  const resetSimulation = useCallback(() => {
    setSimulationActive(false);
    setPlayback((p) => ({ ...p, paused: false }));
    setTelemetryRaw({
      altitudeKm: 0,
      velocityKmS: 0,
      inclinationDeg: 51.6,
      periodMin: 90,
      progress: 0,
    });
    setWsStatus("idle");
  }, []);

  return (
    <MissionContext.Provider
      value={{
        params,
        setParams,
        playback,
        togglePause,
        setSpeed,
        toggleFollow,
        simulationActive,
        simulationKey,
        startSimulation,
        pauseSimulation,
        resetSimulation,
        telemetry,
        setTelemetry,
        wsStatus,
        setWsStatus,
      }}
    >
      {children}
    </MissionContext.Provider>
  );
}

// ── Consumer hook ──────────────────────────────────────────────────

export function useMission(): MissionContextValue {
  const ctx = useContext(MissionContext);
  if (!ctx) {
    throw new Error("useMission must be used within <MissionProvider>");
  }
  return ctx;
}

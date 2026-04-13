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
 *   1. User-authored  — params, playback controls, camera mode
 *   2. System-derived — telemetry, WS status, diagnostics (written by scene/hooks)
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
  CameraMode,
  ConnectionDiagnostics,
  SatelliteConfig,
} from "@/types/orbit";
import { PROTOCOL_VERSION } from "@/types/orbit";

// ── Param types ────────────────────────────────────────────────────

export interface MissionParams {
  satellites: SatelliteConfig[];
  time_span: number;
  time_step: number;
}

/** ISS-like LEO defaults — pre-filled in the sidebar form. */
export const DEFAULT_PARAMS: MissionParams = {
  satellites: [
    {
      id: "sat-1",
      initial_position: [7_000_000, 0, 0],
      initial_velocity: [0, 7546, 0],
    },
    {
      id: "sat-2",
      initial_position: [-7_000_000, 0, 0],
      initial_velocity: [0, -7546, 0],
    }
  ],
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

  // ── Camera mode (#14) ────────────────────────────────────────────
  cameraMode: CameraMode;
  setCameraMode: (m: CameraMode) => void;

  // ── Visibility ───────────────────────────────────────────────────
  hiddenSatellites: string[];
  toggleSatelliteVisibility: (id: string) => void;
  togglePlaneVisibility: (ids: string[]) => void;

  // ── Simulation lifecycle ─────────────────────────────────────────
  simulationActive: boolean;
  simulationKey: number;
  startSimulation: () => void;
  pauseSimulation: () => void;
  resetSimulation: () => void;

  // ── System-derived state (written by scene) ──────────────────────
  telemetry: OrbitalParameters;
  setTelemetry: (t: OrbitalParameters) => void;

  wsStatus: WsConnectionState;
  setWsStatus: (s: WsConnectionState) => void;

  // ── Connection diagnostics (#11, #12) ────────────────────────────
  diagnostics: ConnectionDiagnostics;
  setDiagnosticsRef: (ref: React.RefObject<ConnectionDiagnostics>) => void;
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

  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [hiddenSatellites, setHiddenSatellites] = useState<string[]>([]);

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

  // Diagnostics — stored as a ref pointer for zero-copy reads from the WS hook
  const defaultDiagnostics: ConnectionDiagnostics = {
    latencyMs: 50,
    packetsPerSec: 0,
    bufferDepth: 0,
    droppedFrames: 0,
    protocolVersion: PROTOCOL_VERSION,
    latencyHistory: [],
  };
  const diagnosticsRefInternal = useRef<ConnectionDiagnostics>(defaultDiagnostics);
  const [diagnostics, setDiagnosticsState] = useState<ConnectionDiagnostics>(defaultDiagnostics);

  // Poll the diagnostics ref at ~4 Hz to update React state
  const diagPollRef = useRef<number | null>(null);
  const setDiagnosticsRef = useCallback(
    (ref: React.RefObject<ConnectionDiagnostics>) => {
      diagnosticsRefInternal.current = ref.current;
      if (diagPollRef.current) clearInterval(diagPollRef.current);
      diagPollRef.current = window.setInterval(() => {
        if (ref.current) {
          setDiagnosticsState({ ...ref.current });
        }
      }, 250) as unknown as number;
    },
    [],
  );

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
    () => {
      setPlayback((p) => ({ ...p, followCamera: !p.followCamera }));
      setCameraMode((m) => (m === "follow" ? "orbit" : "follow"));
    },
    [],
  );

  const startSimulation = useCallback(() => {
    setSimulationActive(true);
    setSimulationKey((k) => k + 1);
    setPlayback((p) => ({ ...p, paused: false }));
  }, []);

  const toggleSatelliteVisibility = useCallback((id: string) => {
    setHiddenSatellites((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }, []);

  const togglePlaneVisibility = useCallback((ids: string[]) => {
    setHiddenSatellites((prev) => {
      // Determine if ALL given ids are currently hidden
      const allHidden = ids.every(id => prev.includes(id));
      if (allHidden) {
        // Unhide them all: remove ids from prev
        return prev.filter(id => !ids.includes(id));
      } else {
        // Hide them all: union prev and ids
        const newSet = new Set([...prev, ...ids]);
        return Array.from(newSet);
      }
    });
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
        cameraMode,
        setCameraMode,
        simulationActive,
        simulationKey,
        startSimulation,
        pauseSimulation,
        resetSimulation,
        telemetry,
        setTelemetry,
        wsStatus,
        setWsStatus,
        diagnostics,
        setDiagnosticsRef,
        hiddenSatellites,
        toggleSatelliteVisibility,
        togglePlaneVisibility,
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

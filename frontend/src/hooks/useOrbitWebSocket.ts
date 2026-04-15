"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { toast } from "sonner";
import type {
  WsConnectionState,
  OrbitSimulationRequest,
  ConnectionDiagnostics,
} from "@/types/orbit";
import {
  SCALE_FACTOR,
  PROTOCOL_VERSION,
} from "@/types/orbit";

// ── Configuration ──────────────────────────────────────────────────

interface UseOrbitWebSocketOptions {
  url: string;
  params: OrbitSimulationRequest;
  enabled?: boolean;
}

export interface BufferedFrame {
  position: [number, number, number];
  velocity: [number, number, number];
  localTime: number;
  serverTime: number;
  step: number;
  seq: number;
}

export interface SatelliteState {
  latestPosition: [number, number, number];
  latestVelocity: [number, number, number];
  trajectory: [number, number, number][];
  buffer: BufferedFrame[];
}

interface UseOrbitWebSocketReturn {
  /** Map of satellite ID to its mutable tracking state. */
  satellitesRef: React.RefObject<Map<string, SatelliteState>>;
  /** EWMA calculated network latency (jitter) in milliseconds. */
  avgLatencyRef: React.RefObject<number>;
  /** Current connection state (for fallback logic). */
  connectionState: WsConnectionState;
  /** Connection diagnostics for the diagnostics panel. */
  diagnosticsRef: React.RefObject<ConnectionDiagnostics>;
  /** Manually reconnect. */
  reconnect: () => void;
  /** Manually disconnect. */
  disconnect: () => void;
  /** Request a specific streaming rate from the server. */
  setStreamRate: (hz: number) => void;
  /** Current simulation step index. */
  stepRef: React.RefObject<number>;
  /** Total steps in the simulation. */
  totalStepsRef: React.RefObject<number>;
  /** Last known server time (for resume on reconnect). */
  lastServerTimeRef: React.RefObject<number>;
}

const WATCHDOG_TIMEOUT_MS = 10_000;
const LATENCY_HISTORY_SIZE = 60;

export function useOrbitWebSocket({
  url,
  params,
  enabled = true,
}: UseOrbitWebSocketOptions): UseOrbitWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);

  const [connectionState, setConnectionState] =
    useState<WsConnectionState>("idle");

  // State tracker for all satellites
  const satellitesRef = useRef<Map<string, SatelliteState>>(new Map());

  const stepRef = useRef<number>(0);
  const totalStepsRef = useRef<number>(0);

  const lastSeqRef = useRef<number>(0);
  const lastMsgLocalTimeRef = useRef(0);
  const avgLatencyRef = useRef(50);
  const lastServerTimeRef = useRef<number>(0);

  const diagnosticsRef = useRef<ConnectionDiagnostics>({
    latencyMs: 50,
    packetsPerSec: 0,
    bufferDepth: 0,
    droppedFrames: 0,
    protocolVersion: PROTOCOL_VERSION,
    latencyHistory: [],
  });
  
  const packetCountRef = useRef(0);
  const packetCountStartRef = useRef(0);

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const resetWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
    }
    watchdogRef.current = window.setTimeout(() => {
      console.warn("[useOrbitWebSocket] Watchdog timeout...");
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      reconnectAttemptsRef.current = 0;
      connect();
    }, WATCHDOG_TIMEOUT_MS) as unknown as number;
  }, []);

  const updateDiagnostics = useCallback(() => {
    const now = performance.now();
    const elapsed = (now - packetCountStartRef.current) / 1000;
    if (elapsed >= 1) {
      let maxBufferDepth = 0;
      satellitesRef.current.forEach(state => {
        maxBufferDepth = Math.max(maxBufferDepth, state.buffer.length);
      });
      
      diagnosticsRef.current = {
        ...diagnosticsRef.current,
        packetsPerSec: Math.round(packetCountRef.current / elapsed),
        bufferDepth: maxBufferDepth,
        latencyMs: avgLatencyRef.current,
      };
      packetCountRef.current = 0;
      packetCountStartRef.current = now;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    satellitesRef.current.clear();
    stepRef.current = 0;
    totalStepsRef.current = 0;
    lastMsgLocalTimeRef.current = 0;
    lastSeqRef.current = 0;
    packetCountRef.current = 0;
    packetCountStartRef.current = performance.now();

    diagnosticsRef.current = {
      ...diagnosticsRef.current,
      packetsPerSec: 0,
      bufferDepth: 0,
      latencyHistory: [],
    };

    setConnectionState("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");
      reconnectAttemptsRef.current = 0;

      const payload: Record<string, unknown> = {
        satellites: paramsRef.current.satellites,
        time_span: paramsRef.current.time_span,
        time_step: paramsRef.current.time_step,
      };

      if (lastServerTimeRef.current > 0) {
        payload.resume_from_time = lastServerTimeRef.current;
      }

      ws.send(JSON.stringify(payload));
      resetWatchdog();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "error") {
          console.error("[useOrbitWebSocket] Server error:", msg.detail);
          toast.error("Simulation Error", { description: msg.detail });
          setConnectionState("error");
          return;
        }

        if (msg.version !== diagnosticsRef.current.protocolVersion) {
          diagnosticsRef.current.protocolVersion = msg.version;
        }

        if (msg.type === "heartbeat") {
          resetWatchdog();
          return;
        }

        if (msg.type === "simulation_complete") {
          setConnectionState("complete");
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          toast.success("Simulation Complete", { description: "All trajectories delivered." });
          return;
        }

        if (msg.type === "position_update") {
          const { id, seq, time, position, velocity, step, total_steps } = msg;

          if (seq <= lastSeqRef.current) {
             // For multiple satellites per seq, they might have the same seq number. 
             // Just update lastSeqRef, don't discard if they match exactly since 
             // multiple sats might arrive with the same seq.
             if (seq < lastSeqRef.current) {
               diagnosticsRef.current.droppedFrames++;
               return;
             }
          }
          lastSeqRef.current = seq;

          const scaledPos: [number, number, number] = [
            position[0] / SCALE_FACTOR,
            position[1] / SCALE_FACTOR,
            position[2] / SCALE_FACTOR,
          ];
          const scaledVel: [number, number, number] = [
            velocity[0] / SCALE_FACTOR,
            velocity[1] / SCALE_FACTOR,
            velocity[2] / SCALE_FACTOR,
          ];

          lastServerTimeRef.current = time;

          const now = performance.now();
          if (lastMsgLocalTimeRef.current > 0) {
            const dt = now - lastMsgLocalTimeRef.current;
            avgLatencyRef.current = avgLatencyRef.current * 0.9 + dt * 0.1;
          }
          lastMsgLocalTimeRef.current = now;

          const history = diagnosticsRef.current.latencyHistory;
          history.push(avgLatencyRef.current);
          if (history.length > LATENCY_HISTORY_SIZE) {
            history.splice(0, history.length - LATENCY_HISTORY_SIZE);
          }

          packetCountRef.current++;
          updateDiagnostics();

          stepRef.current = step;
          totalStepsRef.current = total_steps;

          if (!satellitesRef.current.has(id)) {
            satellitesRef.current.set(id, {
              latestPosition: [0,0,0],
              latestVelocity: [0,0,0],
              trajectory: [],
              buffer: []
            });
          }
          const satState = satellitesRef.current.get(id)!;
          
          satState.latestPosition = scaledPos;
          satState.latestVelocity = scaledVel;
          
          satState.buffer.push({
            position: scaledPos,
            velocity: scaledVel,
            localTime: now,
            serverTime: time,
            step,
            seq,
          });

          if (satState.buffer.length > 100) {
            satState.buffer.splice(0, satState.buffer.length - 80);
          }

          satState.trajectory.push(scaledPos);
          if (satState.trajectory.length > 600) {
            satState.trajectory.splice(0, satState.trajectory.length - 540);
          }

          if (step === 0) setConnectionState("streaming");
          resetWatchdog();
        }
      } catch (err) {
        console.error("[useOrbitWebSocket] Failed parsing frame:", err);
      }
    };

    ws.onerror = () => {
      toast.error("WebSocket Error", { description: "Connection telemetry interrupted." });
      setConnectionState("error");
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (watchdogRef.current) clearTimeout(watchdogRef.current);

      setConnectionState((prev) =>
        prev === "complete" || prev === "error" ? prev : "closed"
      );

      if (reconnectAttemptsRef.current < 5) {
        if (reconnectAttemptsRef.current === 0) {
          toast.warning("Connection Lost", { description: "Attempting to reconnect..." });
        }
        const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
        reconnectTimeoutRef.current = window.setTimeout(connect, delay) as unknown as number;
        reconnectAttemptsRef.current++;
      } else {
        if (reconnectAttemptsRef.current === 5) {
          toast.error("Reconnection Failed", { description: "Max attempts reached." });
          reconnectAttemptsRef.current++; // Prevent further toasts
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    reconnectAttemptsRef.current = 999;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("closed");
  }, []);

  const setStreamRate = useCallback((hz: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ set_rate: hz }));
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    satellitesRef,
    avgLatencyRef,
    connectionState,
    diagnosticsRef,
    reconnect: connect,
    disconnect,
    setStreamRate,
    stepRef,
    totalStepsRef,
    lastServerTimeRef,
  };
}

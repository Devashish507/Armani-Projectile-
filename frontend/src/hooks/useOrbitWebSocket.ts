"use client";

/**
 * useOrbitWebSocket — elite real-time orbit streaming via WebSocket.
 *
 * Protocol v1 features:
 *   • Sequence number validation — discard out-of-order frames
 *   • Heartbeat watchdog — detect dead connections in 10s
 *   • Mixed-precision parsing — Float64 for time, Float32 for spatial
 *   • Connection diagnostics — packets/sec, buffer depth, dropped count
 *   • Adaptive rate control — client can request Hz adjustment
 *   • State recovery — resume from last known time on reconnect
 *
 * Design priorities:
 *   • Latest position stored in a ref → NO React re-renders per frame
 *   • Trajectory buffer accumulates points for the orbit trail
 *   • Automatic cleanup on unmount (no memory leaks)
 *   • Exposes connection state for fallback logic
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type {
  WsConnectionState,
  OrbitSimulationRequest,
  ConnectionDiagnostics,
} from "@/types/orbit";
import {
  SCALE_FACTOR,
  PROTOCOL_VERSION,
  FRAME_SIZE_POSITION,
  FRAME_SIZE_CONTROL,
} from "@/types/orbit";

// ── Configuration ──────────────────────────────────────────────────

interface UseOrbitWebSocketOptions {
  /** WebSocket URL (e.g. ws://localhost:8000/ws/orbit). */
  url: string;
  /** Orbit parameters to send on connect. */
  params: Pick<
    OrbitSimulationRequest,
    "initial_position" | "initial_velocity" | "time_span" | "time_step"
  >;
  /** Whether the hook should connect. @default true */
  enabled?: boolean;
}

// ── Return type ────────────────────────────────────────────────────

export interface BufferedFrame {
  position: [number, number, number];
  velocity: [number, number, number];
  localTime: number;
  serverTime: number;
  step: number;
  seq: number;
}

interface UseOrbitWebSocketReturn {
  /** Ref to the latest scaled position [world units]. Read in useFrame. */
  latestPositionRef: React.RefObject<[number, number, number]>;
  /** Ref to the latest scaled velocity [world units/s]. */
  latestVelocityRef: React.RefObject<[number, number, number]>;
  /** Accumulated trajectory positions (scaled) for the orbit trail. */
  trajectoryRef: React.RefObject<[number, number, number][]>;
  /** Buffer of recent frames with local timestamps for smooth interpolation. */
  bufferRef: React.RefObject<BufferedFrame[]>;
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

// ── Constants ──────────────────────────────────────────────────────

/** If no frame received in this many ms, trigger reconnect. */
const WATCHDOG_TIMEOUT_MS = 10_000;
/** Max latency history samples for sparkline. */
const LATENCY_HISTORY_SIZE = 60;

// ── Hook ───────────────────────────────────────────────────────────

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

  // ── Mutable refs for position data (no re-renders) ───────────
  const latestPositionRef = useRef<[number, number, number]>([0, 0, 0]);
  const latestVelocityRef = useRef<[number, number, number]>([0, 0, 0]);
  const trajectoryRef = useRef<[number, number, number][]>([]);
  const bufferRef = useRef<BufferedFrame[]>([]);
  const stepRef = useRef<number>(0);
  const totalStepsRef = useRef<number>(0);

  // ── Sequence tracking (#1) ───────────────────────────────────
  const lastSeqRef = useRef<number>(0);

  // ── Adaptive Latency Tracking (EWMA) ─────────────────────────
  const lastMsgLocalTimeRef = useRef(0);
  const avgLatencyRef = useRef(50);

  // ── Last known server time for resume (#3) ───────────────────
  const lastServerTimeRef = useRef<number>(0);

  // ── Diagnostics (#11, #12) ───────────────────────────────────
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

  // Keep params in a ref so the effect doesn't re-run on every render
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  // ── Watchdog reset helper ────────────────────────────────────
  const resetWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
    }
    watchdogRef.current = window.setTimeout(() => {
      console.warn("[useOrbitWebSocket] Watchdog timeout — no frames in 10s, reconnecting...");
      // Force reconnect
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      reconnectAttemptsRef.current = 0; // Reset backoff for watchdog
      connect();
    }, WATCHDOG_TIMEOUT_MS) as unknown as number;
  }, []);

  // ── Diagnostics updater (called every ~1s) ───────────────────
  const updateDiagnostics = useCallback(() => {
    const now = performance.now();
    const elapsed = (now - packetCountStartRef.current) / 1000;
    if (elapsed >= 1) {
      diagnosticsRef.current = {
        ...diagnosticsRef.current,
        packetsPerSec: Math.round(packetCountRef.current / elapsed),
        bufferDepth: bufferRef.current.length,
        latencyMs: avgLatencyRef.current,
      };
      packetCountRef.current = 0;
      packetCountStartRef.current = now;
    }
  }, []);

  const connect = useCallback(() => {
    // Close any existing connection cleanly
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Reset trajectory and buffer (but NOT lastServerTime for resume)
    trajectoryRef.current = [];
    bufferRef.current = [];
    stepRef.current = 0;
    totalStepsRef.current = 0;
    lastMsgLocalTimeRef.current = 0;
    lastSeqRef.current = 0;
    packetCountRef.current = 0;
    packetCountStartRef.current = performance.now();

    // Reset diagnostics except dropped count (cumulative)
    diagnosticsRef.current = {
      ...diagnosticsRef.current,
      packetsPerSec: 0,
      bufferDepth: 0,
      latencyHistory: [],
    };

    setConnectionState("connecting");

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");
      reconnectAttemptsRef.current = 0;

      const payload: Record<string, unknown> = {
        initial_position: paramsRef.current.initial_position,
        initial_velocity: paramsRef.current.initial_velocity,
        time_span: paramsRef.current.time_span,
        time_step: paramsRef.current.time_step,
      };

      // Resume from last known time if reconnecting (#3)
      if (lastServerTimeRef.current > 0) {
        payload.resume_from_time = lastServerTimeRef.current;
        console.log(
          `[useOrbitWebSocket] Resuming from t=${lastServerTimeRef.current.toFixed(1)}s`,
        );
      }

      ws.send(JSON.stringify(payload));
      resetWatchdog();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        // Handle JSON (error messages)
        if (typeof event.data === "string") {
          const msg = JSON.parse(event.data);
          if (msg.type === "error") {
            console.error("[useOrbitWebSocket] Server error:", msg.detail);
            setConnectionState("error");
          }
          return;
        }

        // Handle Binary — use DataView for mixed precision (#5)
        const buffer = event.data as ArrayBuffer;
        const view = new DataView(buffer);

        // All frames start with: version(f32), type(f32)
        const version = view.getFloat32(0, true);  // little-endian
        const type = view.getFloat32(4, true);

        // Store protocol version for diagnostics (#4)
        if (version !== diagnosticsRef.current.protocolVersion) {
          diagnosticsRef.current.protocolVersion = version;
          if (version !== PROTOCOL_VERSION) {
            console.warn(
              `[useOrbitWebSocket] Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${version}`,
            );
          }
        }

        // ── Heartbeat (type = 2.0) ─────────────────────────────
        if (type === 2.0) {
          resetWatchdog();
          return;
        }

        // ── Simulation complete (type = 1.0) ───────────────────
        if (type === 1.0 && buffer.byteLength >= FRAME_SIZE_CONTROL) {
          setConnectionState("complete");
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          return;
        }

        // ── Position update (type = 0.0, 52 bytes) ─────────────
        if (type === 0.0 && buffer.byteLength >= FRAME_SIZE_POSITION) {
          const seq = view.getFloat32(8, true);

          // Sequence validation (#1) — discard out-of-order frames
          if (seq <= lastSeqRef.current) {
            diagnosticsRef.current.droppedFrames++;
            return;
          }
          lastSeqRef.current = seq;

          // Float64 time (#5) — high precision at byte offset 12
          const serverTime = view.getFloat64(12, true);

          // Float32 spatial data starting at byte offset 20
          const scaledPos: [number, number, number] = [
            view.getFloat32(20, true) / SCALE_FACTOR,
            view.getFloat32(24, true) / SCALE_FACTOR,
            view.getFloat32(28, true) / SCALE_FACTOR,
          ];
          const scaledVel: [number, number, number] = [
            view.getFloat32(32, true) / SCALE_FACTOR,
            view.getFloat32(36, true) / SCALE_FACTOR,
            view.getFloat32(40, true) / SCALE_FACTOR,
          ];
          const step = view.getFloat32(44, true);
          const totalSteps = view.getFloat32(48, true);

          // Record server time for resume capability (#3)
          lastServerTimeRef.current = serverTime;

          // EWMA latency tracking
          const now = performance.now();
          if (lastMsgLocalTimeRef.current > 0) {
            const dt = now - lastMsgLocalTimeRef.current;
            avgLatencyRef.current = avgLatencyRef.current * 0.9 + dt * 0.1;
          }
          lastMsgLocalTimeRef.current = now;

          // Latency history for sparkline (#11)
          const history = diagnosticsRef.current.latencyHistory;
          history.push(avgLatencyRef.current);
          if (history.length > LATENCY_HISTORY_SIZE) {
            history.splice(0, history.length - LATENCY_HISTORY_SIZE);
          }

          // Packet counting for diagnostics (#12)
          packetCountRef.current++;
          updateDiagnostics();

          // Update latest refs
          latestPositionRef.current = scaledPos;
          latestVelocityRef.current = scaledVel;
          stepRef.current = step;
          totalStepsRef.current = totalSteps;

          // Push into smart buffer
          bufferRef.current.push({
            position: scaledPos,
            velocity: scaledVel,
            localTime: now,
            serverTime: serverTime,
            step: step,
            seq: seq,
          });

          // Memory backpressure: keep max 100 frames
          if (bufferRef.current.length > 100) {
            bufferRef.current.splice(0, bufferRef.current.length - 80);
          }

          // Accumulate for orbit path (decay / prune)
          trajectoryRef.current.push(scaledPos);
          if (trajectoryRef.current.length > 600) {
            trajectoryRef.current.splice(0, trajectoryRef.current.length - 540);
          }

          // Update buffer depth diagnostic
          diagnosticsRef.current.bufferDepth = bufferRef.current.length;

          if (step === 0) setConnectionState("streaming");
          resetWatchdog();
        }
      } catch (err) {
        console.error("[useOrbitWebSocket] Failed parsing frame:", err);
      }
    };

    ws.onerror = () => {
      setConnectionState("error");
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (watchdogRef.current) clearTimeout(watchdogRef.current);

      setConnectionState((prev) =>
        prev === "complete" || prev === "error" ? prev : "closed"
      );

      // Exponential Backoff Reconnection (max 5 retries)
      if (reconnectAttemptsRef.current < 5) {
        const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
        console.log(`[useOrbitWebSocket] Reconnecting in ${delay}ms...`);
        reconnectTimeoutRef.current = window.setTimeout(connect, delay) as unknown as number;
        reconnectAttemptsRef.current++;
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

  /** Send adaptive rate control message to server (#6). */
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
    latestPositionRef,
    latestVelocityRef,
    trajectoryRef,
    bufferRef,
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

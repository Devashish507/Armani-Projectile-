"use client";

/**
 * useOrbitWebSocket — real-time orbit streaming via WebSocket.
 *
 * Connects to the backend `/ws/orbit` endpoint, sends initial orbit
 * parameters, and continuously receives position/velocity frames.
 *
 * Design priorities:
 *   • Latest position stored in a ref → NO React re-renders per frame
 *   • Trajectory buffer accumulates points for the orbit trail
 *   • Automatic cleanup on unmount (no memory leaks)
 *   • Exposes connection state for fallback logic
 */

import { useRef, useEffect, useCallback, useState } from "react";
import type {
  WsOrbitMessage,
  WsConnectionState,
  OrbitSimulationRequest,
} from "@/types/orbit";
import { SCALE_FACTOR } from "@/types/orbit";

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
  /** Manually reconnect. */
  reconnect: () => void;
  /** Manually disconnect. */
  disconnect: () => void;
  /** Current simulation step index. */
  stepRef: React.RefObject<number>;
  /** Total steps in the simulation. */
  totalStepsRef: React.RefObject<number>;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useOrbitWebSocket({
  url,
  params,
  enabled = true,
}: UseOrbitWebSocketOptions): UseOrbitWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const [connectionState, setConnectionState] =
    useState<WsConnectionState>("idle");

  // ── Mutable refs for position data (no re-renders) ───────────
  const latestPositionRef = useRef<[number, number, number]>([0, 0, 0]);
  const latestVelocityRef = useRef<[number, number, number]>([0, 0, 0]);
  const trajectoryRef = useRef<[number, number, number][]>([]);
  const bufferRef = useRef<BufferedFrame[]>([]);
  const stepRef = useRef<number>(0);
  const totalStepsRef = useRef<number>(0);

  // ── Adaptive Latency Tracking (EWMA) ─────────────────────────
  const lastMsgLocalTimeRef = useRef(0);
  const avgLatencyRef = useRef(50); // Guess initial 50ms interval

  // Keep params in a ref so the effect doesn't re-run on every render
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const connect = useCallback(() => {
    // Close any existing connection cleanly without triggering reconnect logic
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Reset trajectory and buffer
    trajectoryRef.current = [];
    bufferRef.current = [];
    stepRef.current = 0;
    totalStepsRef.current = 0;
    lastMsgLocalTimeRef.current = 0;

    setConnectionState("connecting");

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer"; // Important for binary frames
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");
      reconnectAttemptsRef.current = 0; // Reset backoff on success

      const payload = {
        initial_position: paramsRef.current.initial_position,
        initial_velocity: paramsRef.current.initial_velocity,
        time_span: paramsRef.current.time_span,
        time_step: paramsRef.current.time_step,
      };
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        // Handle JSON (used purely for Error messages now)
        if (typeof event.data === "string") {
          const msg = JSON.parse(event.data);
          if (msg.type === "error") {
            console.error("[useOrbitWebSocket] Server error:", msg.detail);
            setConnectionState("error");
          }
          return;
        }

        // Handle Binary (Float32Array)
        const floats = new Float32Array(event.data as ArrayBuffer);
        const type = floats[0];

        if (type === 1.0) {
          // Simulation complete
          setConnectionState("complete");
          return;
        }

        if (type === 0.0) {
          // Position update
          const serverTime = floats[1];
          const scaledPos: [number, number, number] = [
            floats[2] / SCALE_FACTOR,
            floats[3] / SCALE_FACTOR,
            floats[4] / SCALE_FACTOR,
          ];
          const scaledVel: [number, number, number] = [
            floats[5] / SCALE_FACTOR,
            floats[6] / SCALE_FACTOR,
            floats[7] / SCALE_FACTOR,
          ];
          const step = floats[8];
          const totalSteps = floats[9];

          // Adaptive latency math: difference between message arrival times
          const now = performance.now();
          if (lastMsgLocalTimeRef.current > 0) {
            const dt = now - lastMsgLocalTimeRef.current;
            // Exponential Smoothing (Alpha 0.1)
            avgLatencyRef.current = avgLatencyRef.current * 0.9 + dt * 0.1;
          }
          lastMsgLocalTimeRef.current = now;

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
          });

          // Memory backpressure protection: Keep max 100 frames
          if (bufferRef.current.length > 100) {
            bufferRef.current.splice(0, bufferRef.current.length - 80); // Prune oldest 20
          }

          // Accumulate globally for orbit path drawing (decay / prune)
          trajectoryRef.current.push(scaledPos);
          if (trajectoryRef.current.length > 600) {
            trajectoryRef.current.splice(0, trajectoryRef.current.length - 540); 
          }

          if (step === 0) setConnectionState("streaming");
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
      setConnectionState((prev) =>
        prev === "complete" || prev === "error" ? prev : "closed"
      );

      // Automatic Exponential Backoff Reconnection (max 5 retries)
      if (reconnectAttemptsRef.current < 5) {
        const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
        console.log(`[useOrbitWebSocket] Reconnecting in ${delay}ms...`);
        reconnectTimeoutRef.current = window.setTimeout(connect, delay) as unknown as number;
        reconnectAttemptsRef.current++;
      }
    };
  }, [url]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 999; // Prevent auto-reconnect
    
    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent close event acting
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("closed");
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
    reconnect: connect,
    disconnect,
    stepRef,
    totalStepsRef,
  };
}

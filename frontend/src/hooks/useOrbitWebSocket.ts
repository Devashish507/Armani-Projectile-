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
  const [connectionState, setConnectionState] =
    useState<WsConnectionState>("idle");

  // ── Mutable refs for position data (no re-renders) ───────────
  const latestPositionRef = useRef<[number, number, number]>([0, 0, 0]);
  const latestVelocityRef = useRef<[number, number, number]>([0, 0, 0]);
  const trajectoryRef = useRef<[number, number, number][]>([]);
  const bufferRef = useRef<BufferedFrame[]>([]);
  const stepRef = useRef<number>(0);
  const totalStepsRef = useRef<number>(0);

  // Keep params in a ref so the effect doesn't re-run on every render
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const connect = useCallback(() => {
    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Reset trajectory and buffer
    trajectoryRef.current = [];
    bufferRef.current = [];
    stepRef.current = 0;
    totalStepsRef.current = 0;

    setConnectionState("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");

      // Send orbit parameters as first message
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
        const msg = JSON.parse(event.data as string) as WsOrbitMessage;

        switch (msg.type) {
          case "position_update": {
            // Scale from SI metres → world units (Earth radius = 1)
            const scaledPos: [number, number, number] = [
              msg.position[0] / SCALE_FACTOR,
              msg.position[1] / SCALE_FACTOR,
              msg.position[2] / SCALE_FACTOR,
            ];
            const scaledVel: [number, number, number] = [
              msg.velocity[0] / SCALE_FACTOR,
              msg.velocity[1] / SCALE_FACTOR,
              msg.velocity[2] / SCALE_FACTOR,
            ];

            // Update refs (no re-render)
            latestPositionRef.current = scaledPos;
            latestVelocityRef.current = scaledVel;
            stepRef.current = msg.step;
            totalStepsRef.current = msg.total_steps;

            // Accumulate for interpolation buffer
            bufferRef.current.push({
              position: scaledPos,
              velocity: scaledVel,
              localTime: performance.now(),
              step: msg.step,
            });

            // Prune buffer to keep only the last ~20 frames (1 second at 20Hz)
            // It needs at least 2 frames for interpolation
            if (bufferRef.current.length > 30) {
              bufferRef.current.splice(0, bufferRef.current.length - 20);
            }

            // Accumulate for orbit trail
            trajectoryRef.current.push(scaledPos);

            // Set streaming state on first frame
            if (msg.step === 0) {
              setConnectionState("streaming");
            }
            break;
          }

          case "simulation_complete":
            setConnectionState("complete");
            break;

          case "error":
            console.error("[useOrbitWebSocket] Server error:", msg.detail);
            setConnectionState("error");
            break;
        }
      } catch (err) {
        console.error("[useOrbitWebSocket] Failed to parse message:", err);
      }
    };

    ws.onerror = () => {
      console.error("[useOrbitWebSocket] Connection error");
      setConnectionState("error");
    };

    ws.onclose = () => {
      // Only set to closed if we weren't already in a terminal state
      setConnectionState((prev) =>
        prev === "complete" || prev === "error" ? prev : "closed",
      );
      wsRef.current = null;
    };
  }, [url]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("closed");
  }, []);

  // ── Auto-connect on mount / enabled change ───────────────────
  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, connect]);

  return {
    latestPositionRef,
    latestVelocityRef,
    trajectoryRef,
    bufferRef,
    connectionState,
    reconnect: connect,
    disconnect,
    stepRef,
    totalStepsRef,
  };
}

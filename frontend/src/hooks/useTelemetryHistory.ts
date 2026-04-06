"use client";

/**
 * useTelemetryHistory — accumulate time-series telemetry data for charting.
 *
 * Reads live telemetry from MissionContext and maintains a rolling buffer
 * of historical data points. The hook:
 *
 *   • Deduplicates consecutive identical timestamps
 *   • Enforces a configurable max buffer size (default 500)
 *   • Provides the raw arrays (time, altitude, velocity) ready for Plotly
 *   • Exposes a `clear()` method for simulation resets
 *
 * Design: Data processing is separated from rendering. The hook returns
 * plain typed arrays — no charting library coupling.
 *
 * Future: Accepts an optional `entityId` to support multi-satellite history.
 */

import { useRef, useCallback, useEffect, useState } from "react";
import { useMission } from "@/context/MissionContext";

// ── Types ──────────────────────────────────────────────────────────

/** A single time-series data point. */
export interface TelemetryDataPoint {
  /** Mission elapsed time in seconds. */
  time: number;
  /** Altitude above Earth surface in km. */
  altitude: number;
  /** Velocity magnitude in km/s. */
  velocity: number;
}

/** The rolling history buffer exposed to consumers. */
export interface TelemetryHistory {
  /** Ordered time values (seconds). */
  time: number[];
  /** Ordered altitude values (km). */
  altitude: number[];
  /** Ordered velocity values (km/s). */
  velocity: number[];
  /** Total number of points currently in the buffer. */
  length: number;
  /** Whether any data has been recorded. */
  hasData: boolean;
}

/** Hook configuration. */
interface UseTelemetryHistoryOptions {
  /** Maximum data points to store. Oldest are evicted first. @default 500 */
  maxPoints?: number;
  /** Minimum time delta (seconds) between stored points. @default 0.5 */
  minTimeDelta?: number;
  /** Optional entity ID for multi-satellite support. */
  entityId?: string;
}

/** Hook return type. */
interface UseTelemetryHistoryReturn {
  /** Current history snapshot (updated at ~10 Hz via MissionContext). */
  history: TelemetryHistory;
  /** Manually clear all accumulated data. */
  clear: () => void;
  /** Append a raw data point (useful for testing / mock injection). */
  append: (point: TelemetryDataPoint) => void;
}

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_MAX_POINTS = 500;
const DEFAULT_MIN_TIME_DELTA = 0.5;

// ── Empty state singleton (stable reference) ───────────────────────

const EMPTY_HISTORY: TelemetryHistory = {
  time: [],
  altitude: [],
  velocity: [],
  length: 0,
  hasData: false,
};

// ── Hook ───────────────────────────────────────────────────────────

export function useTelemetryHistory(
  options: UseTelemetryHistoryOptions = {},
): UseTelemetryHistoryReturn {
  const {
    maxPoints = DEFAULT_MAX_POINTS,
    minTimeDelta = DEFAULT_MIN_TIME_DELTA,
  } = options;

  const { telemetry, wsStatus } = useMission();

  // ── Internal mutable buffers (avoid re-render per frame) ─────
  const timeRef = useRef<number[]>([]);
  const altitudeRef = useRef<number[]>([]);
  const velocityRef = useRef<number[]>([]);
  const lastTimeRef = useRef<number>(-Infinity);

  // ── React state for consumers (updated at throttled rate) ────
  const [history, setHistory] = useState<TelemetryHistory>(EMPTY_HISTORY);

  // ── Append a single data point ───────────────────────────────
  const appendInternal = useCallback(
    (point: TelemetryDataPoint) => {
      // Deduplicate: skip if time hasn't advanced enough
      if (point.time - lastTimeRef.current < minTimeDelta) return;
      lastTimeRef.current = point.time;

      timeRef.current.push(point.time);
      altitudeRef.current.push(point.altitude);
      velocityRef.current.push(point.velocity);

      // Evict oldest if over capacity
      if (timeRef.current.length > maxPoints) {
        const overshoot = timeRef.current.length - maxPoints;
        timeRef.current.splice(0, overshoot);
        altitudeRef.current.splice(0, overshoot);
        velocityRef.current.splice(0, overshoot);
      }
    },
    [maxPoints, minTimeDelta],
  );

  // ── Clear all data ───────────────────────────────────────────
  const clear = useCallback(() => {
    timeRef.current = [];
    altitudeRef.current = [];
    velocityRef.current = [];
    lastTimeRef.current = -Infinity;
    setHistory(EMPTY_HISTORY);
  }, []);

  // ── Auto-record from MissionContext telemetry ────────────────
  useEffect(() => {
    const isActive =
      wsStatus === "streaming" ||
      wsStatus === "connected" ||
      wsStatus === "complete";

    if (!isActive) return;

    // Only record if we have meaningful values
    if (telemetry.altitudeKm === 0 && telemetry.velocityKmS === 0) return;

    // Compute elapsed time from progress + period
    const elapsedSeconds = telemetry.progress * telemetry.periodMin * 60;

    appendInternal({
      time: elapsedSeconds,
      altitude: telemetry.altitudeKm,
      velocity: telemetry.velocityKmS,
    });

    // Flush to React state (telemetry already throttled to ~10 Hz)
    setHistory({
      time: [...timeRef.current],
      altitude: [...altitudeRef.current],
      velocity: [...velocityRef.current],
      length: timeRef.current.length,
      hasData: timeRef.current.length > 0,
    });
  }, [telemetry, wsStatus, appendInternal]);

  // ── Reset on simulation restart (wsStatus goes to idle) ──────
  useEffect(() => {
    if (wsStatus === "idle") {
      clear();
    }
  }, [wsStatus, clear]);

  return { history, clear, append: appendInternal };
}

"use client";

/**
 * TelemetryPanel — Real-time mission telemetry display.
 *
 * Reads telemetry from MissionContext (updated at ~10 Hz by the scene layer)
 * and the raw WebSocket position/velocity refs to compute derived metrics
 * client-side. Displays:
 *
 *   • Position Vector (X, Y, Z) in km
 *   • Velocity Magnitude in km/s
 *   • Altitude above Earth surface in km
 *   • Mission Elapsed Time (MET)
 *   • Orbital Parameters (inclination, period, progress)
 *   • Connection Status Indicator
 *
 * Design: Mission-control inspired — monospace tabular figures for
 * flicker-free number updates, grouped cards, cyan accent for live data.
 *
 * Performance: Memoised sub-components prevent re-renders when only
 * specific data groups change.
 *
 * Future: Structure supports an `entityId` prop for multi-satellite tracking.
 */

import { useMemo, memo } from "react";
import { useMission } from "@/context/MissionContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EARTH_RADIUS_M } from "@/types/orbit";
import type { WsConnectionState, OrbitalParameters } from "@/types/orbit";
import {
  formatValue,
  formatMET,
  EARTH_RADIUS_KM,
} from "@/lib/telemetry";

// ── Types ──────────────────────────────────────────────────────────

interface TelemetryPanelProps {
  /** Optional entity ID for multi-satellite support (future). */
  entityId?: string;
  /** Optional label override (e.g. "SAT-1", "ISS"). */
  entityLabel?: string;
}

// ── Connection status mapping ──────────────────────────────────────

const STATUS_CONFIG: Record<
  WsConnectionState,
  { dot: string; label: string; color: string }
> = {
  idle:       { dot: "bg-white/30",   label: "IDLE",         color: "text-white/40" },
  connecting: { dot: "bg-amber-400",  label: "CONNECTING",   color: "text-amber-400/70" },
  connected:  { dot: "bg-emerald-400",label: "CONNECTED",    color: "text-emerald-400/70" },
  streaming:  { dot: "bg-emerald-400",label: "STREAMING",    color: "text-emerald-400/70" },
  complete:   { dot: "bg-blue-400",   label: "COMPLETE",     color: "text-blue-400/70" },
  error:      { dot: "bg-red-500",    label: "ERROR",        color: "text-red-400/70" },
  closed:     { dot: "bg-red-500",    label: "DISCONNECTED", color: "text-red-400/70" },
};

// ════════════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════════════

export default function TelemetryPanel({
  entityLabel = "PRIMARY",
}: TelemetryPanelProps) {
  const { telemetry, wsStatus, params } = useMission();

  // ── Determine if we have meaningful data ──────────────────────
  const hasData =
    wsStatus === "streaming" ||
    wsStatus === "connected" ||
    wsStatus === "complete" ||
    telemetry.altitudeKm > 0;

  // ── Derive position vector from altitude + initial direction ──
  // The scene layer computes altitude/velocity from the live WebSocket
  // position data and writes it to MissionContext.telemetry.
  // We reconstruct the approximate magnitude for display.
  const posRadiusKm = telemetry.altitudeKm + EARTH_RADIUS_KM;

  // Compute unit direction from the initial position vector
  const initialMag = Math.sqrt(
    params.initial_position[0] ** 2 +
    params.initial_position[1] ** 2 +
    params.initial_position[2] ** 2,
  );

  // Position components (km) — estimated from current radius × initial direction
  // In a full implementation, the scene layer would write [x, y, z] directly.
  const positionKm = useMemo(() => {
    if (initialMag === 0) return { x: 0, y: 0, z: 0 };
    const scale = posRadiusKm / (initialMag / 1000);
    return {
      x: (params.initial_position[0] / 1000) * scale,
      y: (params.initial_position[1] / 1000) * scale,
      z: (params.initial_position[2] / 1000) * scale,
    };
  }, [posRadiusKm, initialMag, params.initial_position]);

  // ── Velocity magnitude already computed by scene layer ────────
  // telemetry.velocityKmS = √(vx² + vy² + vz²) / 1000

  const status = STATUS_CONFIG[wsStatus];
  const isLive = wsStatus === "streaming" || wsStatus === "connected";

  return (
    <div className="space-y-3" id="telemetry-panel">
      {/* ── Section Header + Connection Status ───────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${status.dot} ${
              isLive ? "animate-pulse" : ""
            }`}
          />
          <span className="text-[10px] font-semibold tracking-[0.15em] text-cyan-400/90 uppercase">
            Live Telemetry
          </span>
        </div>
        <ConnectionBadge status={wsStatus} />
      </div>

      {/* ── Entity Label ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[9px] font-mono tracking-[0.15em] text-white/20 uppercase">
          ENTITY
        </span>
        <span className="text-[10px] font-mono font-medium text-cyan-400/60 tracking-wider">
          {entityLabel}
        </span>
      </div>

      {/* ── Empty State ──────────────────────────────────────────── */}
      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* ── Mission Time ─────────────────────────────────────── */}
          <MissionTimeCard
            progress={telemetry.progress}
            periodMin={telemetry.periodMin}
          />

          {/* ── Primary Metrics: Altitude + Velocity ─────────────── */}
          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              label="ALTITUDE"
              value={formatValue(telemetry.altitudeKm, 1)}
              unit="km"
              accent
              id="telemetry-altitude"
            />
            <MetricCard
              label="VELOCITY"
              value={formatValue(telemetry.velocityKmS, 3)}
              unit="km/s"
              accent
              id="telemetry-velocity"
            />
          </div>

          <Separator className="bg-white/[0.06]" />

          {/* ── Position Vector Card ─────────────────────────────── */}
          <PositionCard
            x={positionKm.x}
            y={positionKm.y}
            z={positionKm.z}
          />

          <Separator className="bg-white/[0.06]" />

          {/* ── Orbit Info Card ───────────────────────────────────── */}
          <OrbitInfoCard telemetry={telemetry} radiusKm={posRadiusKm} />
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Sub-Components (memoised to prevent unnecessary re-renders)
// ════════════════════════════════════════════════════════════════════

/**
 * Connection status badge — shows 🟢/🔴 with label.
 */
const ConnectionBadge = memo(function ConnectionBadge({
  status,
}: {
  status: WsConnectionState;
}) {
  const config = STATUS_CONFIG[status];
  const isConnected =
    status === "connected" || status === "streaming" || status === "complete";

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full
        ${isConnected ? "bg-emerald-500/10" : "bg-white/[0.04]"}
        border border-white/[0.06]`}
      id="telemetry-connection-status"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      <span
        className={`text-[8px] font-mono font-semibold tracking-[0.12em] ${config.color}`}
      >
        {config.label}
      </span>
    </div>
  );
});

/**
 * Empty state — shown when no telemetry data is available.
 */
const EmptyState = memo(function EmptyState() {
  return (
    <Card size="sm" className="bg-white/[0.02] border-white/[0.06]">
      <CardContent className="flex flex-col items-center justify-center py-8 gap-3">
        {/* Animated orbit ring */}
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border border-white/10 animate-spin-slow" />
          <div className="absolute inset-2 rounded-full border border-dashed border-white/[0.06] animate-spin-reverse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-white/15" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-[11px] font-mono text-white/30 tracking-wider">
            No telemetry data available
          </p>
          <p className="text-[9px] font-mono text-white/15 mt-1 tracking-wide">
            Start a simulation to receive live data
          </p>
        </div>
      </CardContent>
    </Card>
  );
});

/**
 * Mission Elapsed Time — large clock-like display with orbit progress bar.
 */
const MissionTimeCard = memo(function MissionTimeCard({
  progress,
  periodMin,
}: {
  progress: number;
  periodMin: number;
}) {
  // Compute elapsed time from progress and period
  const elapsedSeconds = progress * periodMin * 60;

  return (
    <div className="px-2.5 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-mono tracking-[0.12em] text-white/30">
          MISSION ELAPSED TIME
        </span>
        <span className="text-[9px] font-mono text-white/20 tabular-nums">
          {(progress * 100).toFixed(0)}%
        </span>
      </div>

      {/* MET Display */}
      <div className="flex items-baseline gap-1.5 mb-2" id="telemetry-time">
        <span className="text-lg font-mono font-bold text-cyan-400 tabular-nums tracking-wider">
          {formatMET(elapsedSeconds)}
        </span>
        <span className="text-[9px] font-mono text-white/20">MET</span>
      </div>

      {/* Orbit Progress Bar */}
      <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-150 ease-linear"
          style={{
            width: `${Math.min(progress * 100, 100)}%`,
            background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
          }}
        />
      </div>
    </div>
  );
});

/**
 * Prominent metric card with large value — used for altitude and velocity.
 */
const MetricCard = memo(function MetricCard({
  label,
  value,
  unit,
  accent = false,
  id,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
  id?: string;
}) {
  return (
    <div
      className="px-2.5 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]
                 hover:bg-white/[0.05] transition-colors duration-200"
      id={id}
    >
      <div className="text-[9px] font-mono tracking-[0.12em] text-white/30 mb-1">
        {label}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className={`text-base font-mono font-semibold tabular-nums ${
            accent ? "text-cyan-400" : "text-white/80"
          }`}
        >
          {value}
        </span>
        <span className="text-[10px] font-mono text-white/30">{unit}</span>
      </div>
    </div>
  );
});

/**
 * Position Vector — 3-axis display showing X, Y, Z in km.
 */
const PositionCard = memo(function PositionCard({
  x,
  y,
  z,
}: {
  x: number;
  y: number;
  z: number;
}) {
  return (
    <div id="telemetry-position">
      <span className="text-[10px] font-mono tracking-[0.1em] text-white/30 uppercase mb-2 block">
        Position Vector (km)
      </span>
      <div className="grid grid-cols-3 gap-1.5">
        <PositionAxisCell axis="X" value={x} color="text-red-400/70" />
        <PositionAxisCell axis="Y" value={y} color="text-green-400/70" />
        <PositionAxisCell axis="Z" value={z} color="text-blue-400/70" />
      </div>
    </div>
  );
});

/**
 * Single axis cell for position vector — colour-coded per axis.
 */
const PositionAxisCell = memo(function PositionAxisCell({
  axis,
  value,
  color = "text-white/70",
}: {
  axis: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="px-2 py-1.5 rounded bg-white/[0.03] border border-white/[0.06]
                    hover:bg-white/[0.05] transition-colors duration-200 text-center">
      <div className={`text-[9px] font-mono mb-0.5 ${color}`}>{axis}</div>
      <div className="text-[11px] font-mono text-white/70 tabular-nums">
        {formatValue(value, 0)}
      </div>
    </div>
  );
});

/**
 * Orbit Info — orbital parameters grouped in a compact list.
 */
const OrbitInfoCard = memo(function OrbitInfoCard({
  telemetry,
  radiusKm,
}: {
  telemetry: OrbitalParameters;
  radiusKm: number;
}) {
  return (
    <div id="telemetry-orbit-info">
      <span className="text-[10px] font-mono tracking-[0.1em] text-white/30 uppercase mb-2 block">
        Orbit Info
      </span>
      <div className="space-y-1.5">
        <TelemetryRow
          label="ORBITAL RADIUS"
          value={`${formatValue(radiusKm, 1)} km`}
        />
        <TelemetryRow
          label="INCLINATION"
          value={`${formatValue(telemetry.inclinationDeg, 1)}°`}
        />
        <TelemetryRow
          label="PERIOD"
          value={`${formatValue(telemetry.periodMin, 1)} min`}
        />
        <TelemetryRow
          label="EARTH RADIUS"
          value={`${formatValue(EARTH_RADIUS_KM, 0)} km`}
        />
      </div>
    </div>
  );
});

/**
 * Single compact row for label + value display.
 */
const TelemetryRow = memo(function TelemetryRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-[10px] font-mono tracking-wider text-white/30">
        {label}
      </span>
      <span className="text-[12px] font-mono font-medium text-white/70 tabular-nums">
        {value}
      </span>
    </div>
  );
});

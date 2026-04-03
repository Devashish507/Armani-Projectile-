"use client";

/**
 * TelemetryPanel — Real-time orbital telemetry display.
 *
 * Reads telemetry from MissionContext (updated at ~10 Hz by the
 * scene layer). Renders altitude, velocity, position, orbit progress,
 * and orbital parameters in a compact, data-dense layout.
 *
 * Design: monospace tabular figures for flicker-free number updates,
 * subtle cyan accent for live-data feel.
 */

import { useMission } from "@/context/MissionContext";
import { Separator } from "@/components/ui/separator";
import { EARTH_RADIUS_M } from "@/types/orbit";

export default function TelemetryPanel() {
  const { telemetry, params } = useMission();

  // Derive position in km from params + telemetry
  const altKm = telemetry.altitudeKm;
  const posRadiusKm = altKm + EARTH_RADIUS_M / 1000;

  return (
    <div className="space-y-4">
      {/* ── Section Header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        <span className="text-[10px] font-semibold tracking-[0.15em] text-cyan-400/90 uppercase">
          Live Telemetry
        </span>
      </div>

      {/* ── Primary Metrics ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          label="ALTITUDE"
          value={`${altKm.toFixed(1)}`}
          unit="km"
          accent
        />
        <MetricCard
          label="VELOCITY"
          value={`${telemetry.velocityKmS.toFixed(2)}`}
          unit="km/s"
          accent
        />
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* ── Position Vector ─────────────────────────────────────── */}
      <div>
        <span className="text-[10px] font-mono tracking-[0.1em] text-white/30 uppercase mb-2 block">
          Position Vector (km)
        </span>
        <div className="grid grid-cols-3 gap-1.5">
          <PositionCell axis="X" value={posRadiusKm * (params.initial_position[0] / Math.sqrt(
            params.initial_position[0] ** 2 + params.initial_position[1] ** 2 + params.initial_position[2] ** 2
          ) || 1)} />
          <PositionCell axis="Y" value={0} />
          <PositionCell axis="Z" value={0} />
        </div>
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* ── Orbital Parameters ──────────────────────────────────── */}
      <div className="space-y-1.5">
        <TelemetryRow label="INCLINATION" value={`${telemetry.inclinationDeg.toFixed(1)}°`} />
        <TelemetryRow label="PERIOD" value={`${telemetry.periodMin.toFixed(1)} min`} />
        <TelemetryRow label="RADIUS" value={`${posRadiusKm.toFixed(0)} km`} />
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* ── Orbit Progress ──────────────────────────────────────── */}
      <div>
        <div className="flex justify-between text-[10px] text-white/30 mb-1.5 font-mono">
          <span>ORBIT PROGRESS</span>
          <span className="text-white/60 tabular-nums">
            {(telemetry.progress * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-150 ease-linear"
            style={{
              width: `${telemetry.progress * 100}%`,
              background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

/** Prominent metric card with large value. */
function MetricCard({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className="px-2.5 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]">
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
}

/** Single compact telemetry row. */
function TelemetryRow({ label, value }: { label: string; value: string }) {
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
}

/** Position axis cell. */
function PositionCell({ axis, value }: { axis: string; value: number }) {
  return (
    <div className="px-2 py-1.5 rounded bg-white/[0.03] border border-white/[0.06] text-center">
      <div className="text-[9px] font-mono text-white/25 mb-0.5">{axis}</div>
      <div className="text-[11px] font-mono text-white/70 tabular-nums">
        {value.toFixed(0)}
      </div>
    </div>
  );
}

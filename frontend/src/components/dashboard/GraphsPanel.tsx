"use client";

/**
 * GraphsPanel — Scientific analytical charts for mission telemetry.
 *
 * Renders two interactive Plotly line charts:
 *   A. Altitude vs Time (km / s)
 *   B. Velocity vs Time (km/s / s)
 *
 * Features:
 *   • Dark aerospace theme matching the dashboard palette
 *   • Interactive zoom, pan, and hover tooltips
 *   • Efficient real-time updates using Plotly.react (no full re-mount)
 *   • Rolling 500-point data window to prevent memory issues
 *   • Empty-state placeholder when no data is available
 *   • Future-proof: accepts optional entityId for multi-satellite
 *
 * Architecture:
 *   Data processing  → useTelemetryHistory hook
 *   Chart rendering   → PlotlyChart (reusable wrapper)
 *   Layout assembly   → GraphsPanel (this file)
 */

import { memo, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import type { PlotData, Layout, Config } from "plotly.js-dist-min";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useTelemetryHistory,
  type TelemetryHistory,
} from "@/hooks/useTelemetryHistory";
import { useMission } from "@/context/MissionContext";

// ── Dynamic import for Plotly (no SSR — large library) ─────────
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ── Types ──────────────────────────────────────────────────────────

interface GraphsPanelProps {
  /** Optional entity ID for multi-satellite support. */
  entityId?: string;
  /** Optional label override. */
  entityLabel?: string;
}

/** Chart configuration for a single graph instance. */
interface ChartConfig {
  id: string;
  title: string;
  yLabel: string;
  yUnit: string;
  color: string;
  fillColor: string;
  getData: (history: TelemetryHistory) => number[];
}

// ── Chart configurations ───────────────────────────────────────────

const CHART_CONFIGS: ChartConfig[] = [
  {
    id: "altitude-vs-time",
    title: "Altitude vs Time",
    yLabel: "Altitude",
    yUnit: "km",
    color: "#22d3ee",           // cyan-400
    fillColor: "rgba(34,211,238,0.08)",
    getData: (h) => h.altitude,
  },
  {
    id: "velocity-vs-time",
    title: "Velocity vs Time",
    yLabel: "Velocity",
    yUnit: "km/s",
    color: "#a78bfa",           // violet-400
    fillColor: "rgba(167,139,250,0.08)",
    getData: (h) => h.velocity,
  },
];

// ── Shared Plotly layout & config ──────────────────────────────────

const DARK_BG = "rgba(0,0,0,0)";
const GRID_COLOR = "rgba(255,255,255,0.06)";
const TICK_COLOR = "rgba(255,255,255,0.35)";
const HOVER_BG = "rgba(10,10,20,0.92)";

/** Build a Plotly layout for a given chart config. */
function buildLayout(chart: ChartConfig, dataLength: number): Partial<Layout> {
  return {
    paper_bgcolor: DARK_BG,
    plot_bgcolor: DARK_BG,
    font: {
      family: "'Geist Mono', 'SF Mono', 'Fira Code', monospace",
      size: 10,
      color: TICK_COLOR,
    },
    margin: { l: 52, r: 16, t: 8, b: 38 },
    xaxis: {
      title: {
        text: "Time (s)",
        font: { size: 10, color: "rgba(255,255,255,0.3)" },
        standoff: 8,
      },
      gridcolor: GRID_COLOR,
      zerolinecolor: GRID_COLOR,
      linecolor: "rgba(255,255,255,0.08)",
      tickfont: { size: 9, color: TICK_COLOR },
      showgrid: true,
      dtick: dataLength > 200 ? undefined : undefined, // auto
    },
    yaxis: {
      title: {
        text: `${chart.yLabel} (${chart.yUnit})`,
        font: { size: 10, color: "rgba(255,255,255,0.3)" },
        standoff: 8,
      },
      gridcolor: GRID_COLOR,
      zerolinecolor: GRID_COLOR,
      linecolor: "rgba(255,255,255,0.08)",
      tickfont: { size: 9, color: TICK_COLOR },
      showgrid: true,
    },
    hoverlabel: {
      bgcolor: HOVER_BG,
      bordercolor: chart.color,
      font: {
        family: "'Geist Mono', monospace",
        size: 11,
        color: "#e2e8f0",
      },
    },
    hovermode: "x unified",
    dragmode: "zoom",
    showlegend: false,
    autosize: true,
  };
}

/** Shared Plotly config for all charts. */
const PLOTLY_CONFIG: Partial<Config> = {
  displayModeBar: true,
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: [
    "select2d",
    "lasso2d",
    "autoScale2d",
    "toggleSpikelines",
  ],
};

// ════════════════════════════════════════════════════════════════════
// Reusable Chart Component
// ════════════════════════════════════════════════════════════════════

const TelemetryChart = memo(function TelemetryChart({
  config,
  history,
}: {
  config: ChartConfig;
  history: TelemetryHistory;
}) {
  const yData = config.getData(history);

  const traces: Partial<PlotData>[] = useMemo(
    () => [
      {
        x: history.time,
        y: yData,
        type: "scattergl" as const,
        mode: "lines" as const,
        name: config.yLabel,
        line: {
          color: config.color,
          width: 1.8,
          shape: "spline" as const,
          smoothing: 0.8,
        },
        fill: "tozeroy" as const,
        fillcolor: config.fillColor,
        hovertemplate: `<b>${config.yLabel}</b>: %{y:.3f} ${config.yUnit}<br>Time: %{x:.1f}s<extra></extra>`,
      },
    ],
    [history.time, yData, config],
  );

  const layout = useMemo(
    () => buildLayout(config, history.length),
    [config, history.length],
  );

  return (
    <Card
      size="sm"
      className="bg-white/[0.02] border-white/[0.06] overflow-hidden"
      id={`graph-${config.id}`}
    >
      <CardHeader className="pb-0 pt-3 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: config.color }}
            />
            <CardTitle className="text-[11px] font-mono tracking-[0.1em] text-white/50 uppercase">
              {config.title}
            </CardTitle>
          </div>
          <span className="text-[9px] font-mono text-white/20 tabular-nums">
            {history.length} pts
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        <div className="w-full" style={{ height: 200 }}>
          <Plot
            data={traces}
            layout={layout}
            config={PLOTLY_CONFIG}
            useResizeHandler
            style={{ width: "100%", height: "100%" }}
            // Use revision to control Plotly updates efficiently
            revision={history.length}
          />
        </div>
      </CardContent>
    </Card>
  );
});

// ════════════════════════════════════════════════════════════════════
// Empty State
// ════════════════════════════════════════════════════════════════════

const GraphEmptyState = memo(function GraphEmptyState() {
  return (
    <Card
      size="sm"
      className="bg-white/[0.02] border-white/[0.06]"
      id="graphs-empty-state"
    >
      <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
        {/* Animated chart icon */}
        <div className="relative w-14 h-14">
          {/* Chart frame */}
          <svg
            viewBox="0 0 56 56"
            fill="none"
            className="w-14 h-14 text-white/10"
          >
            <rect
              x="8"
              y="8"
              width="40"
              height="38"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="14"
              y1="38"
              x2="44"
              y2="38"
              stroke="currentColor"
              strokeWidth="1"
            />
            <line
              x1="14"
              y1="16"
              x2="14"
              y2="38"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
          {/* Animated line */}
          <svg
            viewBox="0 0 56 56"
            fill="none"
            className="absolute inset-0 w-14 h-14"
          >
            <polyline
              points="18,34 24,28 30,31 36,22 42,26"
              stroke="rgba(34,211,238,0.3)"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-pulse"
            />
          </svg>
        </div>

        <div className="text-center">
          <p className="text-[11px] font-mono text-white/30 tracking-wider">
            No telemetry history
          </p>
          <p className="text-[9px] font-mono text-white/15 mt-1 tracking-wide">
            Graphs will populate when simulation data arrives
          </p>
        </div>
      </CardContent>
    </Card>
  );
});

// ════════════════════════════════════════════════════════════════════
// Main GraphsPanel
// ════════════════════════════════════════════════════════════════════

export default function GraphsPanel({
  entityLabel = "PRIMARY",
}: GraphsPanelProps) {
  const { wsStatus } = useMission();
  const { history, clear } = useTelemetryHistory({ maxPoints: 500 });

  const isLive =
    wsStatus === "streaming" ||
    wsStatus === "connected";

  const handleClear = useCallback(() => {
    clear();
  }, [clear]);

  return (
    <div className="space-y-3" id="graphs-panel">
      {/* ── Section Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="text-cyan-400"
          >
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 5-9" />
          </svg>
          <span className="text-[10px] font-semibold tracking-[0.15em] text-cyan-400/90 uppercase">
            Analytical Graphs
          </span>
          {isLive && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
            </span>
          )}
        </div>

        {history.hasData && (
          <button
            onClick={handleClear}
            className="text-[8px] font-mono tracking-[0.1em] text-white/20 hover:text-white/40
                       transition-colors duration-200 uppercase px-1.5 py-0.5
                       rounded border border-white/[0.06] hover:border-white/[0.12]"
            id="graphs-clear-btn"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Entity Label ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[9px] font-mono tracking-[0.15em] text-white/20 uppercase">
          SOURCE
        </span>
        <span className="text-[10px] font-mono font-medium text-cyan-400/60 tracking-wider">
          {entityLabel}
        </span>
        {history.hasData && (
          <span className="text-[9px] font-mono text-white/15 ml-auto tabular-nums">
            {history.length} samples
          </span>
        )}
      </div>

      {/* ── Charts or Empty State ─────────────────────────────────── */}
      {!history.hasData ? (
        <GraphEmptyState />
      ) : (
        <div className="space-y-3">
          {CHART_CONFIGS.map((config) => (
            <TelemetryChart
              key={config.id}
              config={config}
              history={history}
            />
          ))}
        </div>
      )}
    </div>
  );
}

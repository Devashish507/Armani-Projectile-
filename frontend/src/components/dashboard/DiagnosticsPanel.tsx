"use client";

/**
 * DiagnosticsPanel — Real-time connection health & latency visualization.
 *
 * Features (#11 latency graph, #12 connection diagnostics):
 *   • Mini SVG sparkline showing EWMA latency over time
 *   • Packets/sec counter
 *   • Buffer depth indicator
 *   • Dropped frame counter
 *   • Protocol version badge
 *
 * Zero dependencies — pure SVG for the sparkline.
 */

import { useEffect, useState, useRef } from "react";
import { useMission } from "@/context/MissionContext";
import type { ConnectionDiagnostics } from "@/types/orbit";

const SPARKLINE_WIDTH = 220;
const SPARKLINE_HEIGHT = 40;

export default function DiagnosticsPanel() {
  const { diagnostics } = useMission();
  const [data, setData] = useState<ConnectionDiagnostics>(diagnostics);

  // Poll diagnostics ref at ~4 Hz for smooth sparkline updates
  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setData({ ...diagnostics });
    }, 250);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [diagnostics]);

  const history = data.latencyHistory;
  const sparklinePath = buildSparklinePath(history);

  return (
    <div className="space-y-3">
      {/* ── Section Header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
        <span className="text-[10px] font-semibold tracking-[0.15em] text-white/50 uppercase">
          Diagnostics
        </span>
        <span className="ml-auto text-[9px] font-mono text-white/20 tracking-wider">
          v{data.protocolVersion}
        </span>
      </div>

      {/* ── Latency Sparkline (#11) ─────────────────────────────── */}
      <div className="px-2 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-[9px] font-mono tracking-[0.1em] text-white/30">
            LATENCY (ms)
          </span>
          <span className="text-[11px] font-mono font-semibold text-emerald-400 tabular-nums">
            {data.latencyMs.toFixed(0)}
          </span>
        </div>
        <svg
          width={SPARKLINE_WIDTH}
          height={SPARKLINE_HEIGHT}
          viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
          className="w-full"
          preserveAspectRatio="none"
        >
          {/* Grid lines */}
          <line x1="0" y1={SPARKLINE_HEIGHT / 2} x2={SPARKLINE_WIDTH} y2={SPARKLINE_HEIGHT / 2}
                stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <line x1="0" y1={SPARKLINE_HEIGHT * 0.25} x2={SPARKLINE_WIDTH} y2={SPARKLINE_HEIGHT * 0.25}
                stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
          <line x1="0" y1={SPARKLINE_HEIGHT * 0.75} x2={SPARKLINE_WIDTH} y2={SPARKLINE_HEIGHT * 0.75}
                stroke="rgba(255,255,255,0.02)" strokeWidth="1" />

          {/* Glow area fill */}
          {sparklinePath.fill && (
            <path
              d={sparklinePath.fill}
              fill="url(#latencyGradient)"
              opacity="0.3"
            />
          )}

          {/* Sparkline stroke */}
          {sparklinePath.line && (
            <path
              d={sparklinePath.line}
              fill="none"
              stroke="#34d399"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          <defs>
            <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* ── Metrics Grid (#12) ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-1.5">
        <DiagMetric label="PKTS/SEC" value={`${data.packetsPerSec}`} />
        <DiagMetric label="BUFFER" value={`${data.bufferDepth}`} />
        <DiagMetric
          label="DROPPED"
          value={`${data.droppedFrames}`}
          warn={data.droppedFrames > 0}
        />
        <DiagMetric label="EWMA" value={`${data.latencyMs.toFixed(1)}ms`} />
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function DiagMetric({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="px-2 py-1.5 rounded bg-white/[0.03] border border-white/[0.06]">
      <div className="text-[8px] font-mono text-white/25 tracking-wider">{label}</div>
      <div
        className={`text-[11px] font-mono font-semibold tabular-nums ${
          warn ? "text-amber-400" : "text-white/60"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// ── Sparkline path builder ─────────────────────────────────────────

function buildSparklinePath(
  history: number[],
): { line: string | null; fill: string | null } {
  if (history.length < 2) return { line: null, fill: null };

  const maxVal = Math.max(...history, 100); // at least 100ms range
  const minVal = Math.min(...history, 0);
  const range = maxVal - minVal || 1;

  const xStep = SPARKLINE_WIDTH / (history.length - 1);
  const padding = 2;

  const points = history.map((val, i) => {
    const x = i * xStep;
    const y = padding + (1 - (val - minVal) / range) * (SPARKLINE_HEIGHT - padding * 2);
    return { x, y };
  });

  const lineParts = points.map((p, i) =>
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`,
  );
  const line = lineParts.join(" ");

  // Fill path: close at the bottom
  const fill =
    line +
    ` L ${points[points.length - 1].x} ${SPARKLINE_HEIGHT}` +
    ` L ${points[0].x} ${SPARKLINE_HEIGHT} Z`;

  return { line, fill };
}

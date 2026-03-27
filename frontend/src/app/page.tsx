"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { fetchHealth } from "@/lib/api";
import type { OrbitPlaybackState, OrbitalParameters } from "@/types/orbit";

/* ────────────────────────────────────────────────────────────────
 * Dynamic import — Three.js / WebGL must only run on the client.
 * ──────────────────────────────────────────────────────────────── */
const SpaceScene = dynamic(
  () => import("@/components/scene/SpaceScene"),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-black text-white/40 text-xs font-mono tracking-widest">
        INITIALIZING...
      </div>
    ),
  }
);

type ConnectionStatus = "checking" | "online" | "offline";
const SPEED_OPTIONS = [1, 10, 50, 100] as const;

/* ════════════════════════════════════════════════════════════════
 * HomePage — immersive mission-control dashboard.
 *
 * Design language: full-viewport 3D scene with minimal floating
 * UI elements at the edges — inspired by professional flight
 * trackers and satellite monitoring tools.
 * ════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [playback, setPlayback] = useState<OrbitPlaybackState>({
    paused: false,
    speed: 50,
    followCamera: false,
  });
  const [telemetry, setTelemetry] = useState<OrbitalParameters>({
    altitudeKm: 0,
    velocityKmS: 0,
    inclinationDeg: 51.6,
    periodMin: 90,
    progress: 0,
  });
  const [showTelemetry, setShowTelemetry] = useState(true);

  // Throttle telemetry updates to ~10 Hz
  const lastUpdate = useRef(0);
  const handleTelemetry = useCallback((params: OrbitalParameters) => {
    const now = performance.now();
    if (now - lastUpdate.current > 100) {
      lastUpdate.current = now;
      setTelemetry(params);
    }
  }, []);

  // Health check polling
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const data = await fetchHealth();
        if (!cancelled) setStatus(data.status === "ok" ? "online" : "offline");
      } catch {
        if (!cancelled) setStatus("offline");
      }
    }
    check();
    const interval = setInterval(check, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const togglePause = () => setPlayback((p) => ({ ...p, paused: !p.paused }));
  const setSpeed = (speed: number) => setPlayback((p) => ({ ...p, speed }));
  const toggleFollow = () => setPlayback((p) => ({ ...p, followCamera: !p.followCamera }));

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black">
      {/* ── Full-viewport 3D Scene ─────────────────────────── */}
      <SpaceScene playback={playback} onTelemetryUpdate={handleTelemetry} />

      {/* ═════════════════════════════════════════════════════
       *  TOP-LEFT — Branding
       * ═════════════════════════════════════════════════════ */}
      <div className="absolute top-4 left-5 z-20 pointer-events-none select-none">
        <h1 className="text-[15px] font-semibold tracking-[0.2em] text-white/80">
          ARMANI
        </h1>
        <p className="text-[10px] font-mono tracking-widest text-white/30 mt-0.5">
          MISSION CONTROL
        </p>
      </div>

      {/* ═════════════════════════════════════════════════════
       *  TOP-RIGHT — Compact Toolbar
       * ═════════════════════════════════════════════════════ */}
      <div className="absolute top-4 right-4 z-20 pointer-events-auto flex items-center gap-1.5">
        {/* Telemetry toggle */}
        <ToolbarButton
          id="telemetry-toggle"
          active={showTelemetry}
          onClick={() => setShowTelemetry(!showTelemetry)}
          title="Toggle telemetry"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 5-9" />
          </svg>
        </ToolbarButton>

        {/* Camera follow */}
        <ToolbarButton
          id="camera-follow"
          active={playback.followCamera}
          onClick={toggleFollow}
          title="Track satellite"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </ToolbarButton>

        {/* Divider */}
        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Satellite count badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/5 border border-white/8">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-cyan-400">
            <circle cx="12" cy="12" r="2" />
            <path d="M7 17l-2 2M17 7l2-2M7 7l-2-2M17 17l2 2" />
            <circle cx="12" cy="12" r="7" strokeDasharray="3 3" />
          </svg>
          <span className="text-[11px] font-mono text-white/60">1</span>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════
       *  BOTTOM-LEFT — Data Source + Status Pills
       * ═════════════════════════════════════════════════════ */}
      <div className="absolute bottom-4 left-5 z-20 pointer-events-auto flex items-center gap-2">
        {/* Connection status pill */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 border border-white/8 backdrop-blur-sm">
          <StatusDot status={status} />
          <span className="text-[11px] font-mono text-white/50">
            {status === "online" ? "API" : status === "checking" ? "..." : "OFFLINE"}
          </span>
        </div>

        {/* Simulation source */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 border border-white/8 backdrop-blur-sm">
          <span className="text-[11px] font-mono text-white/50">
            {status === "online" ? "LIVE" : "MOCK"}
          </span>
        </div>

        {/* Satellite type */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 border border-white/8 backdrop-blur-sm">
          <span className="text-[11px] font-mono text-cyan-400/70">LEO</span>
          <span className="text-[11px] font-mono text-white/40">ISS-like</span>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════
       *  BOTTOM-RIGHT — Orbital Telemetry Panel
       * ═════════════════════════════════════════════════════ */}
      {showTelemetry && (
        <div className="absolute bottom-4 right-4 z-20 pointer-events-auto">
          <div className="px-4 py-3 rounded-lg bg-black/60 border border-white/8 backdrop-blur-sm min-w-[200px]">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[10px] font-semibold tracking-[0.15em] text-cyan-400/90">
                TELEMETRY
              </span>
            </div>

            {/* Metrics */}
            <div className="space-y-1.5">
              <TelemetryRow label="ALT" value={`${telemetry.altitudeKm.toFixed(0)} km`} />
              <TelemetryRow label="VEL" value={`${telemetry.velocityKmS.toFixed(2)} km/s`} />
              <TelemetryRow label="INC" value={`${telemetry.inclinationDeg.toFixed(1)}°`} />
              <TelemetryRow label="PER" value={`${telemetry.periodMin.toFixed(1)} min`} />
            </div>

            {/* Orbit progress bar */}
            <div className="mt-3 pt-2 border-t border-white/6">
              <div className="flex justify-between text-[10px] text-white/30 mb-1 font-mono">
                <span>ORBIT</span>
                <span>{(telemetry.progress * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1 bg-white/6 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-100"
                  style={{
                    width: `${telemetry.progress * 100}%`,
                    background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════
       *  BOTTOM-CENTER — Time Controls
       * ═════════════════════════════════════════════════════ */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/60 border border-white/8 backdrop-blur-sm">
          {/* Play / Pause */}
          <button
            id="playback-toggle"
            onClick={togglePause}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors text-white/70 hover:text-white"
            title={playback.paused ? "Play" : "Pause"}
          >
            {playback.paused ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="2" width="3.5" height="12" rx="0.8" />
                <rect x="9.5" y="2" width="3.5" height="12" rx="0.8" />
              </svg>
            )}
          </button>

          {/* Divider */}
          <div className="w-px h-4 bg-white/8" />

          {/* Speed selectors */}
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              id={`speed-${s}x`}
              onClick={() => setSpeed(s)}
              className={`
                px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-all
                ${playback.speed === s
                  ? "text-cyan-400 bg-cyan-500/15"
                  : "text-white/30 hover:text-white/60"
                }
              `}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

/** Single telemetry row — compact label + value */
function TelemetryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-[10px] font-mono tracking-wider text-white/30">
        {label}
      </span>
      <span className="text-[12px] font-mono font-medium text-white/80 tabular-nums">
        {value}
      </span>
    </div>
  );
}

/** Compact toolbar icon button */
function ToolbarButton({
  id, active, onClick, title, children,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      title={title}
      className={`
        w-8 h-8 flex items-center justify-center rounded-md border transition-all
        ${active
          ? "bg-white/10 border-cyan-500/30 text-cyan-400"
          : "bg-white/5 border-white/8 text-white/40 hover:text-white/70 hover:bg-white/8"
        }
      `}
    >
      {children}
    </button>
  );
}

/** Animated status dot */
function StatusDot({ status }: { status: ConnectionStatus }) {
  const color =
    status === "online"
      ? "bg-emerald-500"
      : status === "offline"
        ? "bg-red-400"
        : "bg-amber-400";
  return (
    <span className="relative flex h-2 w-2">
      {status === "online" && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

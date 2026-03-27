"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { fetchHealth } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OrbitPlaybackState, OrbitalParameters } from "@/types/orbit";

/* ────────────────────────────────────────────────────────────────
 * Dynamic import — Three.js / WebGL must only run on the client.
 * ──────────────────────────────────────────────────────────────── */
const SpaceScene = dynamic(
  () => import("@/components/scene/SpaceScene"),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-black text-white/60 text-sm">
        Loading space…
      </div>
    ),
  }
);

type ConnectionStatus = "checking" | "online" | "offline";

const SPEED_OPTIONS = [1, 10, 50, 100] as const;

/* ════════════════════════════════════════════════════════════════
 * HomePage — mission-control landing screen.
 * ════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");

  // ── Playback state ────────────────────────────────────────
  const [playback, setPlayback] = useState<OrbitPlaybackState>({
    paused: false,
    speed: 50,
    followCamera: false,
  });

  // ── Live telemetry ────────────────────────────────────────
  const [telemetry, setTelemetry] = useState<OrbitalParameters>({
    altitudeKm: 0,
    velocityKmS: 0,
    inclinationDeg: 51.6,
    periodMin: 90,
    progress: 0,
  });

  // Throttle telemetry updates to ~10 Hz to avoid flooding React
  const lastTelemetryUpdate = useRef(0);
  const handleTelemetry = useCallback((params: OrbitalParameters) => {
    const now = performance.now();
    if (now - lastTelemetryUpdate.current > 100) {
      lastTelemetryUpdate.current = now;
      setTelemetry(params);
    }
  }, []);

  // ── Health check polling ──────────────────────────────────
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
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // ── Playback handlers ─────────────────────────────────────
  const togglePause = () =>
    setPlayback((p) => ({ ...p, paused: !p.paused }));

  const setSpeed = (speed: number) =>
    setPlayback((p) => ({ ...p, speed }));

  const toggleFollow = () =>
    setPlayback((p) => ({ ...p, followCamera: !p.followCamera }));

  return (
    <main className="relative w-screen h-screen overflow-hidden">
      {/* ── 3D Background ──────────────────────────────────── */}
      <SpaceScene
        playback={playback}
        onTelemetryUpdate={handleTelemetry}
      />

      {/* ── Vignette ───────────────────────────────────────── */}
      <div
        className="absolute inset-0 z-[5] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* ── Top-left Overlay UI ────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col items-center justify-center gap-10 p-6">
        {/* Hero */}
        <div className="text-center space-y-4 max-w-2xl pointer-events-auto">
          <div className="relative mx-auto w-20 h-20 mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-spin-slow" />
            <div className="absolute inset-2 rounded-full border-2 border-primary/50 animate-spin-reverse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl select-none">🚀</span>
            </div>
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl bg-gradient-to-r from-primary via-blue-400 to-cyan-400 bg-clip-text text-transparent">
            Aerospace Mission Control
          </h1>
          <p className="text-muted-foreground text-lg">
            Design, simulate, and monitor missions from a single command centre.
          </p>
        </div>

        {/* Status Card */}
        <Card className="w-full max-w-sm border-border/60 bg-card/50 backdrop-blur-md shadow-xl pointer-events-auto">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">System Status</CardTitle>
            <CardDescription>Backend API connectivity</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <StatusDot status={status} />
            <StatusBadge status={status} />
          </CardContent>
        </Card>

        {/* Quick-info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl pointer-events-auto">
          {[
            { label: "Missions", value: "—", icon: "🛰️" },
            { label: "Simulations", value: "—", icon: "📡" },
            { label: "Telemetry", value: "—", icon: "📊" },
          ].map((item) => (
            <Card
              key={item.label}
              className="border-border/40 bg-card/30 backdrop-blur-sm hover:bg-card/50 transition-colors"
            >
              <CardContent className="flex items-center gap-3 p-4">
                <span className="text-2xl">{item.icon}</span>
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="text-xl font-semibold tracking-tight">
                    {item.value}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
       *  Orbital Parameters Panel — top-right
       * ═══════════════════════════════════════════════════════ */}
      <div className="absolute top-4 right-4 z-20 pointer-events-auto">
        <Card className="border-border/40 bg-card/50 backdrop-blur-md shadow-xl min-w-[220px]">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              ORBITAL TELEMETRY
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-1">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <TelemetryItem
                label="Altitude"
                value={`${telemetry.altitudeKm.toFixed(1)} km`}
              />
              <TelemetryItem
                label="Velocity"
                value={`${telemetry.velocityKmS.toFixed(2)} km/s`}
              />
              <TelemetryItem
                label="Inclination"
                value={`${telemetry.inclinationDeg.toFixed(1)}°`}
              />
              <TelemetryItem
                label="Period"
                value={`${telemetry.periodMin.toFixed(1)} min`}
              />
            </div>

            {/* Progress bar */}
            <div className="mt-3">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Orbit Progress</span>
                <span>{(telemetry.progress * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-100"
                  style={{ width: `${telemetry.progress * 100}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════
       *  Time Controls HUD — bottom-center
       * ═══════════════════════════════════════════════════════ */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl shadow-2xl">
          {/* Pause / Play */}
          <button
            id="playback-toggle"
            onClick={togglePause}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
            title={playback.paused ? "Play" : "Pause"}
          >
            {playback.paused ? (
              /* Play triangle */
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2l10 6-10 6V2z" />
              </svg>
            ) : (
              /* Pause bars */
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="2" width="4" height="12" rx="1" />
                <rect x="9" y="2" width="4" height="12" rx="1" />
              </svg>
            )}
          </button>

          {/* Speed selector */}
          <div className="flex items-center gap-1">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                id={`speed-${s}x`}
                onClick={() => setSpeed(s)}
                className={`
                  px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-all
                  ${playback.speed === s
                    ? "bg-cyan-500/30 text-cyan-300 border border-cyan-500/50"
                    : "text-white/50 hover:text-white/80 hover:bg-white/10"
                  }
                `}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-white/15" />

          {/* Camera follow toggle */}
          <button
            id="camera-follow-toggle"
            onClick={toggleFollow}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
              ${playback.followCamera
                ? "bg-amber-500/25 text-amber-300 border border-amber-500/40"
                : "text-white/50 hover:text-white/80 hover:bg-white/10"
              }
            `}
            title="Toggle camera follow mode"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
              <path d="M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
            TRACK
          </button>
        </div>
      </div>
    </main>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

function TelemetryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <p className="text-sm font-mono font-semibold text-white/90 tabular-nums">
        {value}
      </p>
    </div>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const colour =
    status === "online"
      ? "bg-emerald-500"
      : status === "offline"
        ? "bg-red-500"
        : "bg-yellow-500";

  return (
    <span className="relative flex h-3 w-3">
      {status === "online" && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colour} opacity-75`}
        />
      )}
      <span className={`relative inline-flex h-3 w-3 rounded-full ${colour}`} />
    </span>
  );
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    checking: { label: "Checking…", variant: "secondary" },
    online: { label: "Online", variant: "default" },
    offline: { label: "Offline", variant: "destructive" },
  };
  const { label, variant } = map[status];

  return <Badge variant={variant}>{label}</Badge>;
}

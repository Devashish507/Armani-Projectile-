"use client";

/**
 * Mission Control Dashboard — 3-Panel Layout.
 *
 * Architecture:
 *   ┌──────────┬────────────────────────┬──────────┐
 *   │ Sidebar  │    3D Space Scene      │  Right   │
 *   │ (280px)  │    (flex-1)            │  Panel   │
 *   │          │                        │  (300px) │
 *   │ Mission  │                        │ Controls │
 *   │ Params   │                        │ Telemetry│
 *   │          │                        │ Diags    │
 *   ├──────────┴────────────────────────┴──────────┤
 *   │              Status Bar                       │
 *   └───────────────────────────────────────────────┘
 *
 * State flows through MissionContext — no prop drilling.
 * The SpaceScene receives params + callbacks via the bridge below.
 */

import dynamic from "next/dynamic";
import { MissionProvider, useMission } from "@/context/MissionContext";
import Sidebar from "@/components/dashboard/Sidebar";
import ControlPanel from "@/components/dashboard/ControlPanel";
import TelemetryPanel from "@/components/dashboard/TelemetryPanel";
import DiagnosticsPanel from "@/components/dashboard/DiagnosticsPanel";
import GraphsPanel from "@/components/dashboard/GraphsPanel";
import StatusBar from "@/components/dashboard/StatusBar";
import { Separator } from "@/components/ui/separator";

/* ────────────────────────────────────────────────────────────────
 * Dynamic import — Three.js / WebGL must only run on the client.
 * ──────────────────────────────────────────────────────────────── */
const SpaceScene = dynamic(
  () => import("@/components/scene/SpaceScene"),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-black text-white/20 text-xs font-mono tracking-widest">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          INITIALIZING SCENE...
        </div>
      </div>
    ),
  }
);

/* ════════════════════════════════════════════════════════════════
 * HomePage — wrapped in MissionProvider.
 * ════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  return (
    <MissionProvider>
      <DashboardLayout />
    </MissionProvider>
  );
}

/* ════════════════════════════════════════════════════════════════
 * DashboardLayout — the actual 3-panel grid.
 *
 * Separated from HomePage so it can call useMission() (which
 * requires being inside the provider tree).
 * ════════════════════════════════════════════════════════════════ */

function DashboardLayout() {
  const {
    params,
    playback,
    cameraMode,
    simulationActive,
    simulationKey,
    setTelemetry,
    setWsStatus,
    setDiagnosticsRef,
    hiddenSatellites,
  } = useMission();

  return (
    <main className="h-screen flex flex-col overflow-hidden bg-black">
      {/* ── 3-Column Content Area ───────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT — Mission Parameters Sidebar */}
        <Sidebar />

        {/* CENTER — 3D Space Visualization */}
        <div className="flex-1 relative min-w-0">
          {/* Branding overlay */}
          <div className="absolute top-3 left-4 z-20 pointer-events-none select-none">
            <h1 className="text-[14px] font-semibold tracking-[0.22em] text-white/70">
              ARMANI
            </h1>
            <p className="text-[9px] font-mono tracking-[0.2em] text-white/25 mt-0.5">
              ORBITAL DYNAMICS ENGINE
            </p>
          </div>

          {/* 3D Scene — keyed to force remount on new simulation */}
          <SpaceScene
            key={simulationKey}
            playback={playback}
            cameraMode={cameraMode}
            orbitParams={params}
            simulationActive={simulationActive}
            onTelemetryUpdate={setTelemetry}
            onConnectionChange={setWsStatus}
            onDiagnosticsReady={setDiagnosticsRef}
            hiddenSatellites={hiddenSatellites}
          />
        </div>

        {/* RIGHT — Controls + Telemetry + Diagnostics Panel */}
        <aside className="w-[300px] flex flex-col bg-black/40 border-l border-white/[0.06]
                          backdrop-blur-xl overflow-y-auto custom-scrollbar">
          {/* Panel Header */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.8" className="text-cyan-400">
                <path d="M3 3v18h18" />
                <path d="M7 16l4-8 4 4 5-9" />
              </svg>
              <span className="text-xs font-semibold tracking-[0.15em] text-white/70 uppercase">
                Mission Dashboard
              </span>
            </div>
          </div>

          <Separator className="bg-white/[0.06] mx-4" />

          {/* Controls Section */}
          <div className="px-4 py-4">
            <ControlPanel />
          </div>

          <Separator className="bg-white/[0.06] mx-4" />

          {/* Telemetry Section */}
          <div className="px-4 py-4">
            <TelemetryPanel />
          </div>

          <Separator className="bg-white/[0.06] mx-4" />

          {/* Diagnostics Section (#11, #12) */}
          <div className="px-4 py-4">
            <DiagnosticsPanel />
          </div>

          <Separator className="bg-white/[0.06] mx-4" />

          {/* Analytical Graphs Section */}
          <div className="px-4 py-4 flex-1">
            <GraphsPanel />
          </div>
        </aside>
      </div>

      {/* ── Status Bar (bottom) ─────────────────────────────────── */}
      <StatusBar />
    </main>
  );
}

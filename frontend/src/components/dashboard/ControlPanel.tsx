"use client";

/**
 * ControlPanel — Simulation controls (Start/Pause/Reset + Speed + Camera Mode).
 *
 * Lives in the right panel. Provides playback transport controls,
 * speed multiplier selection, and 3-mode camera selector.
 * Reads and writes to MissionContext.
 */

import { useMemo } from "react";
import { useMission } from "@/context/MissionContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Pause,
  RotateCcw,
  Globe,
  Crosshair,
  Move3d,
  Eye,
  EyeOff,
} from "lucide-react";
import type { CameraMode } from "@/types/orbit";

const SPEED_OPTIONS = [1, 10, 50, 100] as const;

const CAMERA_MODES: { mode: CameraMode; label: string; icon: typeof Globe }[] = [
  { mode: "orbit", label: "ORBIT", icon: Globe },
  { mode: "follow", label: "FOLLOW", icon: Crosshair },
  { mode: "free", label: "FREE", icon: Move3d },
];

export default function ControlPanel() {
  const {
    playback,
    togglePause,
    setSpeed,
    cameraMode,
    setCameraMode,
    pauseSimulation,
    resetSimulation,
    simulationActive,
    params,
    hiddenSatellites,
    toggleSatelliteVisibility,
    togglePlaneVisibility,
  } = useMission();

  const planes = useMemo(() => {
    const map = new Map<number, typeof params.satellites>();
    params.satellites.forEach(sat => {
      const pId = sat.metadata?.planeIndex ?? 0;
      if (!map.has(pId)) map.set(pId, []);
      map.get(pId)!.push(sat);
    });
    return Array.from(map.entries()).sort((a,b)=>a[0]-b[0]);
  }, [params.satellites]);

  return (
    <div className="space-y-4">
      {/* ── Section Header ──────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/80" />
        <span className="text-[10px] font-semibold tracking-[0.15em] text-white/50 uppercase">
          Controls
        </span>
      </div>

      {/* ── Transport Buttons ───────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Play / Pause */}
        <Button
          id="ctrl-play-pause"
          variant="outline"
          size="sm"
          onClick={playback.paused ? togglePause : pauseSimulation}
          disabled={!simulationActive}
          className="flex-1 bg-white/[0.04] border-white/[0.08] text-white/70
                     hover:bg-white/[0.08] hover:text-white font-mono text-xs
                     tracking-wider disabled:opacity-30 transition-all"
        >
          {playback.paused ? (
            <>
              <Play className="w-3.5 h-3.5 mr-1" />
              PLAY
            </>
          ) : (
            <>
              <Pause className="w-3.5 h-3.5 mr-1" />
              PAUSE
            </>
          )}
        </Button>

        {/* Reset */}
        <Button
          id="ctrl-reset"
          variant="outline"
          size="sm"
          onClick={resetSimulation}
          className="bg-white/[0.04] border-white/[0.08] text-white/50
                     hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20
                     font-mono text-xs tracking-wider transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* ── Speed Selector ──────────────────────────────────────── */}
      <div>
        <span className="text-[10px] font-mono tracking-[0.1em] text-white/30 uppercase mb-2 block">
          Playback Speed
        </span>
        <div className="flex items-center gap-1.5">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              id={`speed-select-${s}x`}
              onClick={() => setSpeed(s)}
              className={`
                flex-1 py-1.5 rounded-md text-[11px] font-mono font-semibold
                transition-all border
                ${
                  playback.speed === s
                    ? "text-cyan-400 bg-cyan-500/15 border-cyan-500/30"
                    : "text-white/30 bg-white/[0.03] border-white/[0.06] hover:text-white/60 hover:bg-white/[0.06]"
                }
              `}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* ── Camera Mode Selector (#14) ──────────────────────────── */}
      <div>
        <span className="text-[10px] font-mono tracking-[0.1em] text-white/30 uppercase mb-2 block">
          Camera Mode
        </span>
        <div className="flex items-center gap-1.5">
          {CAMERA_MODES.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              id={`camera-mode-${mode}`}
              onClick={() => setCameraMode(mode)}
              className={`
                flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md
                text-[10px] font-mono font-semibold tracking-wider
                transition-all border
                ${
                  cameraMode === mode
                    ? "text-cyan-400 bg-cyan-500/15 border-cyan-500/30"
                    : "text-white/30 bg-white/[0.03] border-white/[0.06] hover:text-white/60 hover:bg-white/[0.06]"
                }
              `}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-white/[0.06]" />

      {/* ── Constellation Visibility ──────────────────────────────── */}
      <div>
        <span className="text-[10px] font-mono tracking-[0.1em] text-white/30 uppercase mb-2 block">
          Constellation Visibility
        </span>
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
          {planes.map(([planeIndex, sats]) => {
            const allHidden = sats.every((s) => hiddenSatellites.includes(s.id));
            const someHidden = !allHidden && sats.some((s) => hiddenSatellites.includes(s.id));
            const satIds = sats.map((s) => s.id);

            return (
              <div key={planeIndex} className="block border border-white/[0.04] p-1.5 rounded-md bg-white/[0.02]">
                <div className="flex items-center justify-between px-2 py-1 mb-1 bg-white/[0.03] rounded">
                  <span className="text-[10px] font-bold text-white/60 tracking-wider">
                    PLANE {planeIndex + 1} <span className="text-white/30 font-normal">({sats.length})</span>
                  </span>
                  <button onClick={() => togglePlaneVisibility(satIds)} className="text-white/60 hover:text-cyan-400 transition-colors">
                    {allHidden ? <EyeOff className="w-3.5 h-3.5 opacity-50" /> : <Eye className={`w-3.5 h-3.5 ${someHidden ? 'text-amber-500' : 'text-cyan-400'}`} />}
                  </button>
                </div>
                
                <div className="flex flex-col gap-1 pl-2">
                  {sats.map((sat) => {
                    const isHidden = hiddenSatellites.includes(sat.id);
                    return (
                      <button
                        key={sat.id}
                        onClick={() => toggleSatelliteVisibility(sat.id)}
                        className={`
                          flex items-center justify-between px-2 py-1 rounded
                          text-[10px] font-mono transition-all border
                          ${
                            !isHidden
                              ? "text-white/70 bg-white/[0.02] border-transparent hover:bg-white/[0.06]"
                              : "text-white/20 bg-transparent border-transparent hover:text-white/40"
                          }
                        `}
                      >
                        <span>{sat.id.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

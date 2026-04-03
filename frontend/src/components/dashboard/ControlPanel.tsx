"use client";

/**
 * ControlPanel — Simulation controls (Start/Pause/Reset + Speed).
 *
 * Lives in the right panel. Provides playback transport controls
 * and speed multiplier selection. Reads and writes to MissionContext.
 */

import { useMission } from "@/context/MissionContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Pause,
  RotateCcw,
  Crosshair,
} from "lucide-react";

const SPEED_OPTIONS = [1, 10, 50, 100] as const;

export default function ControlPanel() {
  const {
    playback,
    togglePause,
    setSpeed,
    toggleFollow,
    pauseSimulation,
    resetSimulation,
    simulationActive,
  } = useMission();

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

      {/* ── Camera Follow Toggle ────────────────────────────────── */}
      <button
        id="ctrl-camera-follow"
        onClick={toggleFollow}
        className={`
          w-full flex items-center gap-2.5 px-3 py-2 rounded-md border
          text-[11px] font-mono tracking-wide transition-all
          ${
            playback.followCamera
              ? "bg-cyan-500/10 border-cyan-500/25 text-cyan-400"
              : "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/60 hover:bg-white/[0.06]"
          }
        `}
      >
        <Crosshair className="w-3.5 h-3.5" />
        <span>TRACK SATELLITE</span>
        <span className={`ml-auto text-[9px] font-semibold tracking-widest ${
          playback.followCamera ? "text-cyan-400/70" : "text-white/20"
        }`}>
          {playback.followCamera ? "ON" : "OFF"}
        </span>
      </button>
    </div>
  );
}

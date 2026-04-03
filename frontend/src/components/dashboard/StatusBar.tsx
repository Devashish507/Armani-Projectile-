"use client";

/**
 * StatusBar — Bottom status strip.
 *
 * Shows connection status, data source, and satellite type in a
 * compact horizontal bar. Sits below the 3-column layout.
 */

import { useMission } from "@/context/MissionContext";
import type { WsConnectionState } from "@/types/orbit";

// ── Status mapping ─────────────────────────────────────────────────

type StatusDisplay = {
  text: string;
  dot: "online" | "checking" | "offline";
  source: string;
};

function getStatusDisplay(state: WsConnectionState): StatusDisplay {
  switch (state) {
    case "streaming":
      return { text: "CONNECTED", dot: "online", source: "WEBSOCKET STREAM" };
    case "connecting":
    case "idle":
    case "connected":
      return { text: "BUFFERING", dot: "checking", source: "SYNCING" };
    case "error":
    case "closed":
      return { text: "FALLBACK", dot: "offline", source: "REST API" };
    case "complete":
      return { text: "COMPLETE", dot: "offline", source: "IDLE" };
    default:
      return { text: "UNKNOWN", dot: "offline", source: "—" };
  }
}

// ── Component ──────────────────────────────────────────────────────

export default function StatusBar() {
  const { wsStatus } = useMission();
  const display = getStatusDisplay(wsStatus);

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 bg-black/60 border-t border-white/[0.06]">
      {/* Connection status */}
      <div className="flex items-center gap-2">
        <StatusDot status={display.dot} />
        <span className="text-[10px] font-mono text-white/40">{display.text}</span>
      </div>

      <Divider />

      {/* Data source */}
      <span className="text-[10px] font-mono text-white/30">{display.source}</span>

      <Divider />

      {/* Satellite type */}
      <span className="text-[10px] font-mono text-cyan-400/60">LEO</span>
      <span className="text-[10px] font-mono text-white/25">Two-Body Kepler</span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Branding */}
      <span className="text-[10px] font-mono tracking-[0.2em] text-white/15">
        ARMANI MISSION CONTROL
      </span>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function StatusDot({ status }: { status: "online" | "checking" | "offline" }) {
  const color =
    status === "online"
      ? "bg-emerald-500"
      : status === "checking"
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <span className="relative flex h-2 w-2">
      {status === "online" && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function Divider() {
  return <div className="w-px h-3 bg-white/[0.08]" />;
}

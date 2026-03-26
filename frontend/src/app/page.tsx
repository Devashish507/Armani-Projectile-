"use client";

import { useEffect, useState } from "react";
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

/* ────────────────────────────────────────────────────────────────
 * Dynamic import — Three.js / WebGL must only run on the client.
 * next/dynamic with ssr:false prevents the Canvas from being
 * evaluated during server-side rendering.
 * ──────────────────────────────────────────────────────────────── */
const SpaceScene = dynamic(
  () => import("@/components/scene/SpaceScene"),
  { ssr: false }
);

type ConnectionStatus = "checking" | "online" | "offline";

/**
 * Homepage — the command-centre landing screen.
 *
 * Renders a full-viewport 3D Earth scene behind the dashboard UI.
 * The health-check polling and status cards float above the canvas
 * using absolute positioning.
 */
export default function HomePage() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");

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

    // Initial check + periodic polling
    check();
    const interval = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden">
      {/* ── 3D Background ──────────────────────────────────── */}
      <SpaceScene />

      {/* ── Overlay UI ─────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none z-10 flex flex-col items-center justify-center gap-10 p-6">
        {/* ── Hero ─────────────────────────────────────────── */}
        <div className="text-center space-y-4 max-w-2xl pointer-events-auto">
          {/* Orbital ring decorative element */}
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

        {/* ── Status Card ──────────────────────────────────── */}
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

        {/* ── Quick-info grid ──────────────────────────────── */}
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
    </main>
  );
}

/* ── Sub-components ──────────────────────────────────────────── */

/** Animated dot showing connectivity state. */
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

/** Text badge reflecting the current state. */
function StatusBadge({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    checking: { label: "Checking…", variant: "secondary" },
    online: { label: "Online", variant: "default" },
    offline: { label: "Offline", variant: "destructive" },
  };
  const { label, variant } = map[status];

  return <Badge variant={variant}>{label}</Badge>;
}

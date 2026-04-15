"use client";

/**
 * Sidebar — Mission Parameter Input Panel.
 *
 * Collapsible left sidebar with grouped form inputs for orbit
 * simulation parameters. Uses shadcn/ui Input + Label components.
 *
 * Design: glassmorphic dark panel with subtle border glow,
 * inspired by aerospace flight-planning interfaces.
 */

import { useState, useCallback } from "react";
import { useMission, DEFAULT_PARAMS, type MissionParams } from "@/context/MissionContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  ChevronRight,
  Rocket,
  MapPin,
  Zap,
  Clock,
  Network,
} from "lucide-react";
import { generateWalkerDelta } from "@/lib/constellations";

// ── Helpers ────────────────────────────────────────────────────────

/** Parse a numeric string — returns NaN guard for empty fields. */
function parseNum(val: string): number {
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

// ── Component ──────────────────────────────────────────────────────

export default function Sidebar() {
  const { params, setParams, startSimulation, simulationActive } = useMission();
  const [collapsed, setCollapsed] = useState(false);

  // Local form state — only committed on "Start"
  const [form, setForm] = useState<MissionParams>({ ...params });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [walkerConfig, setWalkerConfig] = useState({
    t: 24, p: 3, f: 1, altitudeKm: 550, inclinationDeg: 53.0
  });

  const updateWalker = useCallback((key: keyof typeof walkerConfig, val: string) => {
    setWalkerConfig(prev => ({ ...prev, [key]: parseNum(val) }));
    setErrors(prev => {
      const next = { ...prev };
      delete next.walker;
      return next;
    });
  }, []);

  const generateCustomConstellation = useCallback(() => {
    if (walkerConfig.p === 0 || walkerConfig.t % walkerConfig.p !== 0) {
      setErrors((prev) => ({ ...prev, walker: "T must be a multiple of P" }));
      return;
    }
    if (walkerConfig.t > 200) {
      // Soft memory/processing limit warning
      if (!window.confirm(`Warning: Simulating ${walkerConfig.t} satellites might cause performance issues. Proceed?`)) {
        return;
      }
    }
    try {
      const sats = generateWalkerDelta(walkerConfig, "sat");
      setForm((prev) => ({ ...prev, satellites: sats }));
      setErrors({});
    } catch (err: any) {
      setErrors((prev) => ({ ...prev, walker: err.message || "Config error" }));
    }
  }, [walkerConfig]);

  const updateField = useCallback(
    (path: string, value: string) => {
      setForm((prev) => {
        const next = { ...prev };
        const num = parseNum(value);
        if (!next.satellites || next.satellites.length === 0) return next;
        
        const sat = { ...next.satellites[0] };

        switch (path) {
          case "px": sat.initial_position = [num, sat.initial_position[1], sat.initial_position[2]]; break;
          case "py": sat.initial_position = [sat.initial_position[0], num, sat.initial_position[2]]; break;
          case "pz": sat.initial_position = [sat.initial_position[0], sat.initial_position[1], num]; break;
          case "vx": sat.initial_velocity = [num, sat.initial_velocity[1], sat.initial_velocity[2]]; break;
          case "vy": sat.initial_velocity = [sat.initial_velocity[0], num, sat.initial_velocity[2]]; break;
          case "vz": sat.initial_velocity = [sat.initial_velocity[0], sat.initial_velocity[1], num]; break;
          case "time_span": next.time_span = num; break;
          case "time_step": next.time_step = num; break;
        }
        
        next.satellites = [sat, ...next.satellites.slice(1)];
        return next;
      });

      // Clear field error on edit
      setErrors((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    },
    [],
  );

  const validate = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (form.time_span <= 0) errs.time_span = "Must be > 0";
    if (form.time_step <= 0) errs.time_step = "Must be > 0";
    if (form.time_step > form.time_span) errs.time_step = "Must be ≤ time span";

    const sat = form.satellites[0];
    if (sat) {
      const velMag = Math.sqrt(
        sat.initial_velocity[0] ** 2 +
        sat.initial_velocity[1] ** 2 +
        sat.initial_velocity[2] ** 2,
      );
      if (velMag === 0) errs.vx = "Velocity cannot be zero";

      const posMag = Math.sqrt(
        sat.initial_position[0] ** 2 +
        sat.initial_position[1] ** 2 +
        sat.initial_position[2] ** 2,
      );
      if (posMag === 0) errs.px = "Position cannot be zero";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form]);

  const handleStart = useCallback(() => {
    if (!validate()) return;
    setParams(form);
    startSimulation();
  }, [validate, form, setParams, startSimulation]);

  const handleReset = useCallback(() => {
    setForm({ ...DEFAULT_PARAMS });
    setErrors({});
  }, []);

  const handleApplyPreset = useCallback((type: "starlink" | "single_leo" | "gto_transfer") => {
    let sats;
    let t_span = 5400;
    let t_step = 10;

    if (type === "starlink") {
      sats = generateWalkerDelta({
        altitudeKm: 550,
        inclinationDeg: 53.0,
        t: 72,
        p: 3,
        f: 1
      }, "starlink");
      t_span = 5400; // 90 mins
      t_step = 10;
    } else if (type === "gto_transfer") {
      sats = [{
        id: "GTO-Transfer-1",
        initial_position: [7_000_000.0, 0.0, 0.0],
        initial_velocity: [0.0, 9882.0, 0.0], // Burn 1 velocity for LEO->GEO
      }];
      t_span = 40000; // ~11 hours to cover the full heavily elliptical orbit
      t_step = 40;
    } else {
      sats = [{
        id: "LEO-1",
        initial_position: [7_000_000.0, 0.0, 0.0],
        initial_velocity: [0.0, 7546.0, 0.0],
      }];
      t_span = 5400;
      t_step = 10;
    }

    setForm((prev) => ({
      ...prev,
      satellites: sats,
      time_span: t_span,
      time_step: t_step,
    }));
    setErrors({});
  }, []);

  // ── Collapsed state ──────────────────────────────────────────────

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-4 px-1.5 bg-black/40 border-r border-white/[0.06]">
        <button
          id="sidebar-expand"
          onClick={() => setCollapsed(false)}
          className="w-8 h-8 flex items-center justify-center rounded-md
                     bg-white/5 border border-white/10 text-white/50
                     hover:text-white hover:bg-white/10 transition-all"
          title="Expand sidebar"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="mt-4 writing-vertical text-[10px] font-mono tracking-[0.2em] text-white/20 rotate-180"
             style={{ writingMode: "vertical-rl" }}>
          MISSION PARAMS
        </div>
      </div>
    );
  }

  // ── Expanded state ───────────────────────────────────────────────

  return (
    <aside className="w-[280px] flex flex-col bg-black/40 border-r border-white/[0.06]
                       backdrop-blur-xl overflow-y-auto custom-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold tracking-[0.15em] text-white/70 uppercase">
            Mission Parameters
          </span>
        </div>
        <button
          id="sidebar-collapse"
          onClick={() => setCollapsed(true)}
          className="w-6 h-6 flex items-center justify-center rounded text-white/30
                     hover:text-white/70 hover:bg-white/5 transition-all"
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      <Separator className="bg-white/[0.06] mx-4" />

      <div className="flex-1 px-4 py-3 space-y-5">
        {/* ── Position Group ────────────────────────────────────── */}
        <FieldGroup icon={<MapPin className="w-3.5 h-3.5" />} label="Sat-1 Position (m)">
          <FieldRow id="param-px" label="X" value={form.satellites[0]?.initial_position[0] ?? 0} error={errors.px}
                    onChange={(v) => updateField("px", v)} placeholder="7000000" />
          <FieldRow id="param-py" label="Y" value={form.satellites[0]?.initial_position[1] ?? 0}
                    onChange={(v) => updateField("py", v)} placeholder="0" />
          <FieldRow id="param-pz" label="Z" value={form.satellites[0]?.initial_position[2] ?? 0}
                    onChange={(v) => updateField("pz", v)} placeholder="0" />
        </FieldGroup>

        {/* ── Velocity Group ────────────────────────────────────── */}
        <FieldGroup icon={<Zap className="w-3.5 h-3.5" />} label="Sat-1 Velocity (m/s)">
          <FieldRow id="param-vx" label="Vx" value={form.satellites[0]?.initial_velocity[0] ?? 0} error={errors.vx}
                    onChange={(v) => updateField("vx", v)} placeholder="0" />
          <FieldRow id="param-vy" label="Vy" value={form.satellites[0]?.initial_velocity[1] ?? 0}
                    onChange={(v) => updateField("vy", v)} placeholder="7546" />
          <FieldRow id="param-vz" label="Vz" value={form.satellites[0]?.initial_velocity[2] ?? 0}
                    onChange={(v) => updateField("vz", v)} placeholder="0" />
        </FieldGroup>

        {/* ── Time Group ────────────────────────────────────────── */}
        <FieldGroup icon={<Clock className="w-3.5 h-3.5" />} label="Time Configuration (s)">
          <FieldRow id="param-tspan" label="Span" value={form.time_span} error={errors.time_span}
                    onChange={(v) => updateField("time_span", v)} placeholder="5400" />
          <FieldRow id="param-tstep" label="Step" value={form.time_step} error={errors.time_step}
                    onChange={(v) => updateField("time_step", v)} placeholder="10" />
        </FieldGroup>

        {/* ── Walker-Delta Configurator ─────────────────────────── */}
        <FieldGroup icon={<Network className="w-3.5 h-3.5" />} label="Walker-Delta Generator">
          <FieldRow id="walker-t" label="T(Sats)" value={walkerConfig.t} 
                    onChange={(v) => updateWalker("t", v)} placeholder="24" />
          <FieldRow id="walker-p" label="P(Planes)" value={walkerConfig.p} 
                    onChange={(v) => updateWalker("p", v)} placeholder="3" />
          <FieldRow id="walker-f" label="F(Phase)" value={walkerConfig.f} 
                    onChange={(v) => updateWalker("f", v)} placeholder="1" />
          <FieldRow id="walker-alt" label="Alt(km)" value={walkerConfig.altitudeKm} 
                    onChange={(v) => updateWalker("altitudeKm", v)} placeholder="550" />
          <FieldRow id="walker-inc" label="Inc(deg)" value={walkerConfig.inclinationDeg} 
                    onChange={(v) => updateWalker("inclinationDeg", v)} placeholder="53" />
          
          {errors.walker && <p className="text-[10px] text-red-500/90 font-mono mt-1 mb-2 font-bold bg-red-500/10 p-1 rounded">{errors.walker}</p>}
          
          <Button
            variant="outline"
            size="sm"
            onClick={generateCustomConstellation}
            className="w-full mt-2 bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300 font-mono text-[10px] tracking-wider"
          >
            GENERATE CONSTELLATION
          </Button>
        </FieldGroup>
        
        {/* ── Demo Scenarios ──────────────────────────────────────── */}
        <FieldGroup icon={<Rocket className="w-3.5 h-3.5" />} label="Demo Scenarios">
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleApplyPreset("single_leo")}
              className="bg-white/[0.04] border-white/[0.08] text-white/70 hover:text-white hover:border-cyan-500/30
                         font-mono text-[10px] tracking-wider justify-between h-9 px-3"
            >
              Single LEO
              <span className="text-white/30 text-[9px] uppercase">1 Sat • 90m</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleApplyPreset("gto_transfer")}
              className="bg-white/[0.04] border-white/[0.08] text-white/70 hover:text-white hover:border-blue-500/30
                         font-mono text-[10px] tracking-wider justify-between h-9 px-3"
            >
              GTO Transfer Orbit
              <span className="text-white/30 text-[9px] uppercase">Highly Elliptical</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleApplyPreset("starlink")}
              className="bg-white/[0.04] border-white/[0.08] text-white/70 hover:text-white hover:border-purple-500/30
                         font-mono text-[10px] tracking-wider justify-between h-9 px-3"
            >
              LEO Constellation
              <span className="text-white/30 text-[9px] uppercase">72 Sats • Global</span>
            </Button>
          </div>
        </FieldGroup>
      </div>

      {/* ── Action Buttons ────────────────────────────────────────── */}
      <div className="px-4 pb-4 space-y-2">
        <Button
          id="launch-simulation"
          onClick={handleStart}
          className="w-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30
                     hover:bg-cyan-500/30 hover:border-cyan-500/50 font-mono text-xs
                     tracking-wider transition-all"
        >
          <Rocket className="w-3.5 h-3.5 mr-1.5" />
          {simulationActive ? "RESTART SIMULATION" : "LAUNCH SIMULATION"}
        </Button>
        <Button
          id="reset-params"
          variant="ghost"
          onClick={handleReset}
          className="w-full text-white/40 hover:text-white/70 font-mono text-xs tracking-wider"
        >
          RESET DEFAULTS
        </Button>
      </div>
    </aside>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

/** Grouped section with icon + label header. */
function FieldGroup({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-cyan-400/70">{icon}</span>
        <span className="text-[10px] font-mono tracking-[0.12em] text-white/40 uppercase">
          {label}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/** Single labelled input row. */
function FieldRow({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: string) => void;
  placeholder: string;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Label
          htmlFor={id}
          className="w-8 text-[11px] font-mono text-white/30 shrink-0"
        >
          {label}
        </Label>
        <Input
          id={id}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-7 bg-white/[0.04] border-white/[0.08] text-white/80
                     font-mono text-xs placeholder:text-white/15
                     focus:border-cyan-500/40 focus:ring-cyan-500/20
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
      {error && (
        <p className="text-[10px] text-red-400/80 mt-0.5 ml-10 font-mono">{error}</p>
      )}
    </div>
  );
}

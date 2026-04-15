import React from "react";
import { Rocket } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center px-6">
        <div className="flex items-center gap-2.5 font-semibold text-slate-100">
          <Rocket className="h-5 w-5 text-blue-500" />
          <span className="leading-none tracking-tight text-lg drop-shadow-sm">
            Mission Control Dashboard
          </span>
          <span className="ml-3 hidden sm:inline-block rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400 border border-blue-500/20 uppercase tracking-wider">
            Live Telemetry
          </span>
        </div>
      </div>
    </header>
  );
}

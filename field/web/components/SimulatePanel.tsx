import { useState } from "react";
import { FlaskConical, TrendingUp, Siren, Square, Radar } from "lucide-react";
import type { SimState } from "../lib/types";

const post = (url: string, body: unknown = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Demo driver: make telemetry drift live and fire events — no keys needed. */
export function SimulatePanel({ sim }: { sim: SimState | null }) {
  const [open, setOpen] = useState(false);
  const running = sim?.scenarios.includes("head_pressure_rising");
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${running ? "border-lime-400/50 bg-lime-400/15 text-lime-200" : "border-white/10 text-slate-400 hover:bg-white/5"}`}
      >
        <FlaskConical size={12} /> Simulate{running ? " · live" : ""}
      </button>
      {open && (
        <div className="panel absolute top-9 right-0 z-30 w-72 space-y-2 p-3 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="panel-title">Scenario driver</div>
            <span className="font-mono text-[10px] text-slate-500">
              sim {sim ? new Date(sim.simTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"} (+{sim?.offsetMinutes ?? 0}m)
            </span>
          </div>
          <button onClick={() => post("/api/sim", running ? { stop: true } : { scenario: "head_pressure_rising" })} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] ${running ? "border-lime-400/50 bg-lime-400/10 text-lime-200" : "border-white/10 hover:bg-white/5"}`}>
            {running ? <Square size={13} /> : <TrendingUp size={13} className="text-amber-300" />}
            {running ? "Stop: chiller head pressure rising" : "Chiller head pressure rising (Mercy CH-3)"}
          </button>
          <button onClick={() => post("/api/sim/safety")} className="flex w-full items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2.5 py-1.5 text-left text-[11.5px] text-rose-200 hover:bg-rose-500/20">
            <Siren size={13} /> Trigger a safety event (panel overheating)
          </button>
          <div className="text-[10.5px] text-slate-400">Simulation speed (sim minutes per second)</div>
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 5, 10].map((s) => (
              <button key={s} onClick={() => post("/api/sim", { speed: s })} className={`rounded-md border px-1 py-1 font-mono text-[11px] ${sim?.speed === s ? "border-lime-400/50 bg-lime-400/15 text-lime-200" : "border-white/10 text-slate-400"}`}>
                {s}×
              </button>
            ))}
          </div>
          <button onClick={() => post("/api/watchtower/run")} className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-cyan-300 hover:bg-white/5">
            <Radar size={12} /> Run Watchtower now
          </button>
        </div>
      )}
    </div>
  );
}

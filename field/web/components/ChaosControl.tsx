import { useState } from "react";
import { Bomb, Zap, PowerOff, Gauge } from "lucide-react";
import type { Chaos } from "../lib/types";

const post = (body: unknown) => fetch("/api/chaos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Demo control for resilience: random failure rate, one-shot failure, or a hard outage. */
export function ChaosControl({ chaos }: { chaos: Chaos | null }) {
  const [open, setOpen] = useState(false);
  const armed = Object.values(chaos?.failNext ?? {}).reduce((a, b) => a + b, 0);
  const active = (chaos?.rate ?? 0) > 0 || armed > 0 || (chaos?.outage.length ?? 0) > 0;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${active ? "border-amber-400/50 bg-amber-400/15 text-amber-200" : "border-white/10 text-slate-400 hover:bg-white/5"}`}
      >
        <Bomb size={12} /> Chaos{active ? `: ${chaos?.outage.length ? `${chaos.outage.join(",")} down` : armed ? `${armed} armed` : `${Math.round((chaos?.rate ?? 0) * 100)}%`}` : ""}
      </button>
      {open && (
        <div className="panel absolute top-9 right-0 z-30 w-64 space-y-2 p-3 shadow-2xl">
          <div className="panel-title">Resilience demo</div>
          <button onClick={() => post({ failNext: { system: "ERP", count: 1 } })} className="flex w-full items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-left text-[11.5px] hover:bg-white/5">
            <Zap size={13} className="text-amber-300" /> Fail next ERP call once
          </button>
          <button
            onClick={() => post({ outage: { system: "ERP", on: !chaos?.outage.includes("ERP") } })}
            className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11.5px] ${chaos?.outage.includes("ERP") ? "border-rose-400/50 bg-rose-500/10 text-rose-200" : "border-white/10 hover:bg-white/5"}`}
          >
            <PowerOff size={13} className="text-rose-300" /> {chaos?.outage.includes("ERP") ? "End ERP outage" : "Start ERP outage (orders queue)"}
          </button>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <Gauge size={13} /> Random failure rate
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[0, 0.2, 0.5, 1].map((r) => (
              <button key={r} onClick={() => post({ rate: r })} className={`rounded-md border px-1 py-1 font-mono text-[11px] ${chaos?.rate === r ? "border-amber-400/50 bg-amber-400/15 text-amber-200" : "border-white/10 text-slate-400"}`}>
                {r * 100}%
              </button>
            ))}
          </div>
          <button onClick={() => post({ clear: true })} className="w-full rounded-lg px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

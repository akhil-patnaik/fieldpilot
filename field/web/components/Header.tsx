import { RotateCcw, ScrollText, TrendingUp, PlaneTakeoff, LifeBuoy, WifiOff } from "lucide-react";
import type { Capabilities, Chaos, EState, SimState } from "../lib/types";
import { ChaosControl } from "./ChaosControl";
import { SimulatePanel } from "./SimulatePanel";

export type Panel = "demo" | "impact" | "preflight";

function Cap({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <span title={hint} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-600/50 bg-slate-700/20 text-slate-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-slate-600"}`} />
      {label}
    </span>
  );
}

const btn = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition";

export function Header({ caps, estate, chaos, sim, connected, onReset, onOpen }: { caps: Capabilities | null; estate: EState | null; chaos: Chaos | null; sim: SimState | null; connected: boolean; onReset: () => void; onOpen: (p: Panel) => void }) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2.5 px-3 pt-3.5 pb-2.5 sm:px-5">
      <div className="flex items-center gap-3">
        <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-lime-400 shadow-lg shadow-cyan-500/20">
          <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
            <path d="M9 23V9h11M9 16h8" stroke="#05080f" strokeWidth="3.4" fill="none" strokeLinecap="round" />
            <circle cx="23" cy="21" r="3.2" fill="#05080f" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg leading-tight font-extrabold tracking-tight">
            Field<span className="bg-gradient-to-r from-cyan-300 to-lime-300 bg-clip-text text-transparent">Pilot</span>
          </h1>
          <div className="hidden text-[11px] text-slate-400 sm:block">Voice-first agentic copilot for field technicians</div>
        </div>
      </div>

      {estate && (
        <div className="hidden items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-1.5 text-xs xl:flex">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-cyan-500/20 text-[11px] font-bold text-cyan-200">
            {estate.technician.name.split(" ").map((p) => p[0]).join("")}
          </div>
          <div>
            <div className="font-semibold text-slate-200">{estate.technician.name}</div>
            <div className="text-[10px] text-slate-500">
              {estate.technician.id} · {estate.technician.vanId} · {estate.technician.region}
            </div>
          </div>
        </div>
      )}

      <div className="hidden flex-wrap items-center gap-1.5 lg:flex">
        <Cap ok={!!caps?.agora} label="Agora" hint={caps?.agoraReachable ? `Custom LLM via ${caps.publicUrl}` : "Set AGORA_APP_ID, AGORA_APP_CERTIFICATE and PUBLIC_URL"} />
        <Cap ok={!!caps?.murf} label={`Murf${caps?.murf ? ` · ${caps.voice}` : ""}`} hint="Murf AI Falcon streaming TTS" />
        {caps?.backup ? (
          <span title="Scripted, offline demo brain — toggle in Pre-flight" className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-200">
            <LifeBuoy size={11} /> Backup brain
          </span>
        ) : (
          <Cap ok={!!caps?.llm} label={caps?.model ?? "LLM"} hint="OpenAI-compatible LLM with tool calling" />
        )}
        <Cap ok label="MCP" hint="MCP server (Streamable HTTP) at /mcp — the agent's tools run through it" />
      </div>

      {!connected && (
        <span role="status" className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-200">
          <WifiOff size={12} /> Reconnecting…
        </span>
      )}

      <nav className="ml-auto flex flex-wrap items-center gap-1.5" aria-label="Demo controls">
        <button onClick={() => onOpen("demo")} className={`${btn} border-violet-400/40 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20`}>
          <ScrollText size={12} /> Demo script
        </button>
        <button onClick={() => onOpen("impact")} className={`${btn} border-lime-400/40 bg-lime-400/10 text-lime-200 hover:bg-lime-400/20`}>
          <TrendingUp size={12} /> Impact
        </button>
        <button onClick={() => onOpen("preflight")} className={`${btn} border-cyan-400/40 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20`}>
          <PlaneTakeoff size={12} /> Pre-flight
        </button>
        <SimulatePanel sim={sim} />
        <ChaosControl chaos={chaos} />
        <button onClick={onReset} className={`${btn} border-white/10 text-slate-300 hover:bg-white/5`}>
          <RotateCcw size={12} /> Reset
        </button>
      </nav>
    </header>
  );
}

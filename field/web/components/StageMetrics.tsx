import { ClipboardList, Stethoscope, Zap, FileCheck2, Timer, Layers, ShieldCheck, Gauge, Activity, RotateCcw, Radar } from "lucide-react";
import type { Metrics, Stage } from "../lib/types";

const STAGES: { key: Stage; label: string; sub: string; Icon: any }[] = [
  { key: "before", label: "Before", sub: "Brief & context", Icon: ClipboardList },
  { key: "during", label: "During", sub: "Diagnose with RAG + IoT", Icon: Stethoscope },
  { key: "action", label: "Action", sub: "Order · escalate · command", Icon: Zap },
  { key: "after", label: "After", sub: "Schedule · notify · report", Icon: FileCheck2 },
];

export function StageRail({ stage, active }: { stage: Stage; active: boolean }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="panel grid grid-cols-2 items-stretch overflow-hidden p-1 sm:flex">
      {STAGES.map((s, i) => {
        const on = active && i === idx;
        const done = active && i < idx;
        return (
          <div key={s.key} className={`relative flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2 transition-all duration-500 ${on ? "bg-gradient-to-r from-cyan-500/20 to-lime-500/10" : ""}`}>
            <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition ${on ? "border-cyan-400/60 bg-cyan-400/20 text-cyan-200 shadow-[0_0_20px] shadow-cyan-500/30" : done ? "border-lime-400/30 bg-lime-400/10 text-lime-300" : "border-white/10 text-slate-500"}`}>
              <s.Icon size={15} />
            </div>
            <div className="min-w-0">
              <div className={`text-xs font-bold ${on ? "text-white" : done ? "text-lime-200/80" : "text-slate-400"}`}>{s.label}</div>
              <div className="truncate text-[10px] text-slate-500">{s.sub}</div>
            </div>
            {i < STAGES.length - 1 && <div className="absolute top-1/2 right-0 hidden h-4 w-px -translate-y-1/2 bg-white/10 sm:block" />}
          </div>
        );
      })}
    </div>
  );
}

function Tile({ Icon, label, value, unit, accent, title }: { Icon: any; label: string; value: string | number; unit?: string; accent?: string; title?: string }) {
  return (
    <div className="panel flex min-w-0 items-center gap-2 px-2.5 py-2" title={title}>
      <Icon size={15} className={`shrink-0 ${accent ?? "text-slate-400"}`} />
      <div className="min-w-0">
        <div className="truncate text-[9.5px] tracking-wide text-slate-500 uppercase">{label}</div>
        <div className="font-mono text-base leading-tight font-semibold text-slate-100">
          {value}
          {unit && <span className="ml-0.5 text-[11px] text-slate-500">{unit}</span>}
        </div>
      </div>
    </div>
  );
}

export function MetricsStrip({ m }: { m: Metrics | null }) {
  const v = m ?? ({} as Metrics);
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      <Tile Icon={Timer} label="Admin est." title="Estimated manual admin time automated (assumption A3, see Impact)" value={v.manualMinutesSaved ?? 0} unit="min" accent="text-lime-300" />
      <Tile Icon={Activity} label="Ops" title="System operations performed" value={v.toolCalls ?? 0} accent="text-cyan-300" />
      <Tile Icon={Layers} label="Systems" title="Enterprise systems touched" value={`${v.systemsTouched ?? 0}/7`} accent="text-sky-300" />
      <Tile Icon={Zap} label="Actions" title="Confirmed actions executed" value={v.actionsExecuted ?? 0} accent="text-amber-300" />
      <Tile Icon={ShieldCheck} label="Confirms" title="Human confirmations requested" value={v.confirmationsRequested ?? 0} accent="text-rose-300" />
      <Tile Icon={Gauge} label="Latency" title="Average tool latency" value={v.avgToolLatencyMs ?? 0} unit="ms" />
      <Tile Icon={RotateCcw} label="Recovered" title="System failures auto-recovered by retry" value={v.retriesRecovered ?? 0} />
      <Tile Icon={Radar} label="Precision" title="Proactive insight precision: accepted ÷ spoken" value={v.insights?.precision == null ? "—" : Math.round(v.insights.precision * 100)} unit={v.insights?.precision == null ? undefined : `% · ${v.insights.accepted}/${v.insights.shown}`} accent="text-cyan-300" />
    </div>
  );
}

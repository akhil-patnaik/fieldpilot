import { useState } from "react";
import { Radar, ChevronDown, Check, X, Zap, Volume2, Hourglass, ShieldAlert } from "lucide-react";
import type { Insight, InsightStats } from "../lib/types";

const SEV: Record<Insight["severity"], { dot: string; ring: string; label: string }> = {
  safety: { dot: "bg-rose-500 animate-pulse", ring: "border-rose-500/60 bg-rose-500/[0.10]", label: "SAFETY" },
  critical: { dot: "bg-rose-400", ring: "border-rose-400/40 bg-rose-400/[0.05]", label: "critical" },
  warning: { dot: "bg-amber-400", ring: "border-amber-400/35 bg-amber-400/[0.04]", label: "warning" },
  info: { dot: "bg-sky-400", ring: "border-white/10 bg-white/[0.02]", label: "info" },
};
const STATUS: Record<Insight["status"], string> = {
  new: "text-cyan-300 bg-cyan-400/10",
  accepted: "text-emerald-300 bg-emerald-400/10",
  acted: "text-emerald-200 bg-emerald-500/15",
  dismissed: "text-slate-400 bg-white/5",
};
const KIND: Record<string, string> = {
  composite: "story",
  recurring_fault: "recurring fault",
  telemetry_trend: "telemetry trend",
  parts_risk: "parts risk",
  sla_risk: "SLA risk",
  safety: "safety",
  schedule: "schedule",
};

/** Watchtower's ranked, evidence-backed insights: what it noticed, why, and the one action it proposes. */
export function InsightsRail({ insights, stats }: { insights: Insight[]; stats: InsightStats | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const act = (id: string) => fetch(`/api/insights/${id}/act`, { method: "POST" });
  const dismiss = (id: string) => fetch(`/api/insights/${id}/dismiss`, { method: "POST" });
  const visible = showAll ? insights : insights.filter((i) => i.status === "new" || Date.now() - new Date(i.announcedAt ?? i.createdAt).getTime() < 5 * 60_000).slice(0, 6);
  return (
    <section className="panel flex max-h-[44%] min-h-[120px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
        <div className="panel-title flex items-center gap-2">
          <Radar size={13} className="text-cyan-300" /> Watchtower insights
        </div>
        <span className="ml-auto font-mono text-[10px] text-slate-500" title="accepted ÷ shown">
          precision {stats?.precision == null ? "—" : `${Math.round(stats.precision * 100)}%`} · {stats?.accepted ?? 0}/{stats?.shown ?? 0}
        </span>
        <button onClick={() => setShowAll(!showAll)} className="text-[10px] text-slate-400 hover:text-slate-200">
          {showAll ? "recent" : `all (${insights.length})`}
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {visible.length === 0 && <div className="py-4 text-center text-[11px] text-slate-500">Watching every system. Nothing needs you right now.</div>}
        {visible.map((i) => {
          const sev = SEV[i.severity];
          const isOpen = open === i.id;
          return (
            <div key={i.id} className={`insight-new rounded-xl border p-2.5 transition-opacity duration-500 ${sev.ring} ${i.status === "dismissed" ? "opacity-50" : ""}`}>
              <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(isOpen ? null : i.id)}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sev.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {i.severity === "safety" && <ShieldAlert size={12} className="text-rose-300" />}
                    <span className="text-[12px] leading-snug font-semibold text-slate-100">{i.title}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className={`rounded px-1.5 py-px font-semibold uppercase ${STATUS[i.status]}`}>{i.status}</span>
                    <span className="text-slate-500">{KIND[i.kind] ?? i.kind}</span>
                    <span className="inline-flex items-center gap-1 text-slate-400" title="confidence">
                      <span className="h-1 w-10 overflow-hidden rounded bg-white/10">
                        <span className="block h-full bg-cyan-300" style={{ width: `${Math.round(i.confidence * 100)}%` }} />
                      </span>
                      {Math.round(i.confidence * 100)}%
                    </span>
                    {i.announcedAt && (
                      <span className="inline-flex items-center gap-0.5 text-lime-300">
                        <Volume2 size={10} /> spoken
                      </span>
                    )}
                    {!i.announcedAt && i.hold && i.status === "new" && (
                      <span className="inline-flex items-center gap-0.5 text-slate-500">
                        <Hourglass size={10} /> {i.hold}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown size={14} className={`mt-0.5 shrink-0 text-slate-500 transition ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="mt-2 space-y-2 pl-4">
                  <p className="text-[11.5px] leading-relaxed text-slate-200">{i.why}</p>
                  <div>
                    <div className="mb-1 text-[9.5px] font-semibold tracking-wider text-slate-500 uppercase">Why am I saying this?</div>
                    <ul className="space-y-0.5">
                      {i.evidence.map((e, k) => (
                        <li key={k} className="flex gap-2 text-[10.5px] leading-snug">
                          <span className="w-32 shrink-0 truncate text-slate-500" title={e.label}>
                            {e.label}
                          </span>
                          <span className="text-slate-300">{e.value}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {i.action && (
                    <div className="rounded-lg bg-black/20 p-2 text-[11px] text-slate-300">
                      <div className="mb-0.5 text-[9.5px] font-semibold tracking-wider text-cyan-300 uppercase">Proposed action (needs your yes)</div>
                      {i.action.readback}
                    </div>
                  )}
                  {i.status === "new" && (
                    <div className="flex gap-2">
                      {i.action && (
                        <button onClick={() => act(i.id)} className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/90 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-cyan-400">
                          {i.pendingActionId ? <Check size={12} /> : <Zap size={12} />} {i.pendingActionId ? "Awaiting approval card" : "Do it"}
                        </button>
                      )}
                      <button onClick={() => dismiss(i.id)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/5">
                        <X size={12} /> Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

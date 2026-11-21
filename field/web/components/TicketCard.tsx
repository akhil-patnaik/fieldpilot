import { Building2, Timer, Wrench, Package, Siren, CalendarClock, FileText, PackageX } from "lucide-react";
import type { EState } from "../lib/types";
import { isHot } from "../lib/useLive";
import { Pill, useCountdown } from "./ui";

/** The work order Pilot is working on, with a live SLA countdown. */
export function TicketCard({ estate, ticketId, highlights }: { estate: EState | null; ticketId?: string; highlights: Record<string, number> }) {
  const t = estate?.tickets.find((x) => x.id === ticketId) ?? estate?.tickets.find((x) => x.priority === "P1") ?? estate?.tickets[0];
  const sla = useCountdown(t?.slaDueAt);
  if (!estate || !t) return <section className="panel shimmer h-[128px]" />;
  const site = estate.sites.find((s) => s.id === t.siteId);
  const asset = estate.assets.find((a) => a.id === t.assetId);
  const closed = ["RESOLVED", "CLOSED"].includes(t.status);
  const urgent = !closed && sla.ms < 3 * 3600000;
  return (
    <section className={`panel relative overflow-hidden p-3.5 ${isHot(highlights, t.id) ? "hot" : ""}`}>
      {urgent && <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-400 to-amber-400" />}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="panel-title">{ticketId ? "Current ticket" : "Top priority"}</span>
            <Pill v={t.priority} />
            <span className="font-mono text-xs font-semibold text-slate-200">{t.id}</span>
            <Pill v={t.status} />
          </div>
          <div className="mt-1 text-[13.5px] leading-snug font-semibold text-slate-50">{t.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Building2 size={11} /> {site?.name}
            </span>
            <span>
              {asset?.manufacturer} {asset?.model} · {asset?.name}
            </span>
          </div>
        </div>
        <div className={`shrink-0 rounded-xl border px-3 py-1.5 text-right ${closed ? "border-emerald-400/30 bg-emerald-400/5" : urgent ? "border-rose-400/40 bg-rose-500/10" : "border-white/10"}`}>
          <div className="flex items-center justify-end gap-1 text-[9.5px] font-semibold tracking-wider text-slate-400 uppercase">
            <Timer size={10} /> {closed ? "Restored" : "SLA restore"}
          </div>
          <div className={`font-mono text-lg leading-tight font-bold tabular-nums ${closed ? "text-emerald-300" : urgent ? "text-rose-300" : "text-slate-100"}`}>{closed ? "✓" : sla.text}</div>
        </div>
      </div>
      {t.businessImpact && !closed && <div className="mt-2 rounded-lg bg-rose-500/[0.06] px-2.5 py-1.5 text-[11px] leading-snug text-rose-100/80">{t.businessImpact}</div>}
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
        {t.diagnosis && (
          <span className="inline-flex items-center gap-1 rounded-md bg-lime-400/10 px-2 py-0.5 text-lime-200">
            <Wrench size={10} /> {t.diagnosis.rootCause.length > 60 ? `${t.diagnosis.rootCause.slice(0, 58)}…` : t.diagnosis.rootCause}
          </span>
        )}
        {t.linkedPOs.map((id) => {
          const po = estate.purchaseOrders.find((p) => p.id === id);
          return (
            <span key={id} className={`inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-0.5 font-mono text-amber-200 ${isHot(highlights, id) ? "hot" : ""}`}>
              <Package size={10} /> {id} · {po?.status.replaceAll("_", " ").toLowerCase()}
            </span>
          );
        })}
        {t.linkedIncidents.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-md bg-rose-400/10 px-2 py-0.5 font-mono text-rose-200">
            <Siren size={10} /> {id}
          </span>
        ))}
        {t.reportId && (
          <a href={`/api/reports/${t.reportId}`} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 rounded-md bg-cyan-400/15 px-2 py-0.5 font-mono text-cyan-200 hover:bg-cyan-400/25 ${isHot(highlights, t.reportId) ? "hot" : ""}`}>
            <FileText size={10} /> {t.reportId}
          </a>
        )}
        {(estate.returns ?? [])
          .filter((r) => r.ticketId === t.id)
          .map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-md bg-violet-400/10 px-2 py-0.5 font-mono text-violet-200">
              <PackageX size={10} /> {r.id}
            </span>
          ))}
        {t.followUps.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-md bg-pink-400/10 px-2 py-0.5 font-mono text-pink-200">
            <CalendarClock size={10} /> {id}
          </span>
        ))}
      </div>
    </section>
  );
}

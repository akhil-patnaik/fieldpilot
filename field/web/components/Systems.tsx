import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Thermometer, Package, PackageX, Printer, CalendarClock, Mail, FileText, BookOpen, Pin, PinOff, MessageSquare, Smartphone, ExternalLink, Truck, History, ScrollText, Siren, Lock, ShieldAlert, Quote } from "lucide-react";
import type { EState, Health, ToolEvent } from "../lib/types";
import { isHot } from "../lib/useLive";
import { Pill, Sparkline, slaLeft, timeAgo } from "./ui";

type Tab = "FSM" | "CMMS" | "ERP" | "IoT" | "Calendar" | "Notify" | "Knowledge" | "Audit";
const SYSTEMS: { key: Tab; sub: string; Icon: any; changes: string[] }[] = [
  { key: "FSM", sub: "Work orders", Icon: ClipboardList, changes: ["tickets", "incidents", "reports"] },
  { key: "CMMS", sub: "Asset history", Icon: History, changes: ["maintenance"] },
  { key: "ERP", sub: "Parts · POs · RMA", Icon: Package, changes: ["purchaseOrders", "parts", "reservations", "returns"] },
  { key: "IoT", sub: "Live sensors", Icon: Thermometer, changes: ["telemetry"] },
  { key: "Calendar", sub: "Schedule", Icon: CalendarClock, changes: ["calendar"] },
  { key: "Notify", sub: "SMS · email · Teams", Icon: Mail, changes: ["notifications"] },
];
const EXTRA: { key: Tab; label: string; Icon: any; changes: string[] }[] = [
  { key: "Knowledge", label: "Knowledge", Icon: BookOpen, changes: [] },
  { key: "Audit", label: "Audit log", Icon: ScrollText, changes: ["audit"] },
];

const TOOL_TAB: Record<string, Tab> = {
  get_daily_briefing: "FSM",
  get_ticket_details: "FSM",
  update_ticket: "FSM",
  escalate_incident: "FSM",
  generate_service_report: "FSM",
  get_asset_history: "CMMS",
  add_diagnosis: "CMMS",
  get_live_telemetry: "IoT",
  set_asset_operating_mode: "IoT",
  search_knowledge_base: "Knowledge",
  check_part_availability: "ERP",
  reserve_part: "ERP",
  create_purchase_order: "ERP",
  dispatch_purchase_order: "ERP",
  find_follow_up_slots: "Calendar",
  schedule_follow_up: "Calendar",
  notify_customer: "Notify",
  safety_guard: "Audit",
  // Phase 3 wrap-up sub-steps
  complete_visit: "FSM",
  update_maintenance_record: "CMMS",
  close_ticket: "FSM",
  schedule_inspection: "Calendar",
  create_return_task: "ERP",
  send_customer_summary: "Notify",
  // Phase 4
  reschedule_jobs: "Calendar",
};

const HEALTH: Record<Health, { dot: string; label: string }> = {
  ok: { dot: "bg-emerald-400", label: "online" },
  busy: { dot: "bg-cyan-300 animate-pulse", label: "calling…" },
  degraded: { dot: "bg-amber-400 animate-pulse", label: "retrying" },
  down: { dot: "bg-rose-500", label: "down" },
};

interface Props {
  estate: EState | null;
  tools: ToolEvent[];
  highlights: Record<string, number>;
  changed: Record<string, number>;
  health: Record<string, Health>;
  activeTicketId?: string;
}

export function Systems({ estate, tools, highlights, changed, health, activeTicketId }: Props) {
  const [tab, setTab] = useState<Tab>("FSM");
  const [pinned, setPinned] = useState(false);
  const lastTool = useRef("");

  // Follow the agent: jump to whichever system Pilot is touching right now.
  useEffect(() => {
    const t = tools[tools.length - 1];
    if (!t || t.id === lastTool.current) return;
    lastTool.current = t.id;
    const target = TOOL_TAB[t.name];
    if (target && !pinned) setTab(target);
  }, [tools, pinned]);

  const kb = useMemo(() => [...tools].reverse().find((t) => t.name === "search_knowledge_base" && t.result?.results), [tools]);

  // When a new service report lands, show it (after the wrap-up's final email step).
  const lastReport = estate?.reports[0]?.id;
  const seenReport = useRef(lastReport);
  useEffect(() => {
    if (!lastReport || lastReport === seenReport.current) return;
    seenReport.current = lastReport;
    if (pinned) return;
    const t = setTimeout(() => setTab("FSM"), 1500);
    return () => clearTimeout(t);
  }, [lastReport, pinned]);
  const pick = (k: Tab) => {
    setTab(k);
    setPinned(true);
  };
  if (!estate) return <section className="panel shimmer min-h-[300px]" />;

  return (
    <section className="panel flex h-[640px] min-h-0 flex-col overflow-hidden lg:h-auto">
      <div className="flex items-center justify-between px-3 pt-2.5">
        <div className="panel-title">Connected systems</div>
        <button onClick={() => setPinned(!pinned)} className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] ${pinned ? "bg-amber-400/10 text-amber-300" : "text-cyan-300"}`} title={pinned ? "Resume following the agent" : "Pin this view"}>
          {pinned ? <PinOff size={11} /> : <Pin size={11} />} {pinned ? "Pinned" : "Following agent"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 px-3 pt-2 sm:grid-cols-6">
        {SYSTEMS.map((sys) => {
          const h = health[sys.key] ?? "ok";
          const hot = sys.changes.some((c) => isHot(changed, c, 5000));
          return (
            <button
              key={sys.key}
              data-tab={sys.key}
              onClick={() => pick(sys.key)}
              className={`relative rounded-xl border px-2 py-1.5 text-left transition ${tab === sys.key ? "border-cyan-400/50 bg-cyan-400/[0.08]" : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"} ${hot ? "hot" : ""} ${h === "down" ? "!border-rose-500/60 !bg-rose-500/10" : h === "degraded" ? "!border-amber-400/60" : ""}`}
            >
              <div className="flex items-center gap-1.5">
                <sys.Icon size={12} className="text-slate-300" />
                <span className="text-[11.5px] font-bold text-slate-100">{sys.key}</span>
                <span className={`ml-auto h-1.5 w-1.5 rounded-full ${HEALTH[h].dot}`} />
              </div>
              <div className={`truncate text-[9.5px] ${h === "ok" ? "text-slate-500" : h === "down" ? "text-rose-300" : "text-amber-300"}`}>{h === "ok" ? sys.sub : HEALTH[h].label}</div>
            </button>
          );
        })}
      </div>
      <div className="flex gap-1 border-b border-white/5 px-3 pt-1.5">
        {EXTRA.map((x) => (
          <button key={x.key} data-tab={x.key} onClick={() => pick(x.key)} className={`relative flex items-center gap-1 rounded-t-lg px-2 py-1.5 text-[11px] font-medium ${tab === x.key ? "bg-white/[0.06] text-white" : "text-slate-400 hover:text-slate-200"}`}>
            <x.Icon size={12} /> {x.label}
            {x.changes.some((c) => isHot(changed, c, 4000)) && <span className="absolute top-1 right-0.5 h-1.5 w-1.5 animate-ping rounded-full bg-cyan-400" />}
          </button>
        ))}
        <span className="ml-auto self-center pb-1 font-mono text-[10px] text-slate-500">{tab}</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "FSM" && <Fsm s={estate} hl={highlights} active={activeTicketId} />}
        {tab === "CMMS" && <Cmms s={estate} active={activeTicketId} />}
        {tab === "ERP" && <Erp s={estate} hl={highlights} tools={tools} />}
        {tab === "IoT" && <Iot s={estate} hl={highlights} active={activeTicketId} />}
        {tab === "Calendar" && <Calendar s={estate} />}
        {tab === "Notify" && <Outbox s={estate} />}
        {tab === "Knowledge" && <Knowledge ev={kb} />}
        {tab === "Audit" && <Audit s={estate} />}
      </div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <div className="py-10 text-center text-xs text-slate-500">{children}</div>;
const H = ({ children }: { children: React.ReactNode }) => <div className="panel-title mt-1 mb-1.5">{children}</div>;

function Fsm({ s, hl, active }: { s: EState; hl: Record<string, number>; active?: string }) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {s.tickets.map((t) => {
          const site = s.sites.find((x) => x.id === t.siteId);
          const sla = slaLeft(t.slaDueAt);
          const isActive = t.id === active;
          return (
            <div key={t.id} className={`rounded-xl border p-3 ${isHot(hl, t.id) ? "hot" : ""} ${isActive ? "border-cyan-400/40 bg-cyan-400/[0.04]" : "border-white/5 bg-white/[0.02]"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Pill v={t.priority} />
                <span className="font-mono text-xs font-semibold text-slate-200">{t.id}</span>
                <Pill v={t.status} />
                <span className={`ml-auto font-mono text-[11px] ${sla.urgent && !["RESOLVED", "CLOSED"].includes(t.status) ? "text-rose-300" : "text-slate-500"}`}>SLA {sla.txt}</span>
              </div>
              <div className="mt-1.5 text-[12.5px] leading-snug font-medium text-slate-100">{t.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{site?.name}</div>
              {isActive && t.notes.length > 0 && (
                <ol className="mt-2.5 space-y-1 border-l border-white/10 pl-3">
                  {t.notes.slice(-6).map((n, i) => (
                    <li key={i} className="text-[11px] leading-snug text-slate-400">
                      <span className="font-mono text-[10px] text-slate-600">{new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> {n.text}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      {s.incidents.length > 0 && (
        <div>
          <H>Escalations</H>
          {s.incidents.map((i) => (
            <div key={i.id} className={`mb-2 rounded-xl border border-rose-400/20 bg-rose-400/[0.03] p-3 ${isHot(hl, i.id) ? "hot" : ""}`}>
              <div className="flex items-center gap-2">
                <Siren size={12} className="text-rose-300" />
                <span className="font-mono text-xs font-semibold">{i.id}</span>
                <Pill v={i.severity} />
                <Pill v={i.status} />
              </div>
              <div className="mt-1 text-[12px] text-slate-200">
                {i.team} → {i.assignee}
              </div>
              <div className="text-[11px] text-slate-400">{i.reason}</div>
            </div>
          ))}
        </div>
      )}
      {s.reports.length > 0 && (
        <div>
          <H>Service reports</H>
          {s.reports.map((r, i) => (
            <div key={r.id} className={`mb-2 overflow-hidden rounded-xl border border-cyan-400/25 ${i === 0 && isHot(hl, r.id) ? "hot" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 bg-cyan-400/[0.06] px-3 py-2 text-[11.5px]">
                <FileText size={13} className="text-cyan-300" />
                <span className="font-mono font-semibold">{r.id}</span>
                <span className="text-slate-500">{r.ticketId}</span>
                {r.data && (
                  <span className="text-[10.5px] text-slate-400">
                    · {Math.floor(r.data.timeOnSite.minutes / 60)}h {r.data.timeOnSite.minutes % 60}m on site · {r.data.partsUsed.reduce((n, p) => n + p.qty, 0)} parts · {r.data.citations.length} refs
                  </span>
                )}
                <a href={`/api/reports/${r.id}?print=1`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-md bg-cyan-400/15 px-2 py-0.5 text-[10.5px] font-medium text-cyan-200 hover:bg-cyan-400/25">
                  <Printer size={11} /> PDF
                </a>
                <a href={`/api/reports/${r.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-slate-400 hover:text-slate-200">
                  Open <ExternalLink size={10} />
                </a>
              </div>
              {i === 0 && <iframe title={r.id} src={`/api/reports/${r.id}`} className="h-[380px] w-full bg-white" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cmms({ s, active }: { s: EState; active?: string }) {
  const assetId = s.tickets.find((t) => t.id === active)?.assetId ?? "A-CH-220";
  const asset = s.assets.find((a) => a.id === assetId)!;
  const recs = s.maintenance.filter((m) => m.assetId === assetId).sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div>
      <div className="mb-2 text-[12px] font-semibold text-slate-200">
        {asset.manufacturer} {asset.model} · {asset.name}
        <span className="ml-2 font-mono text-[10px] font-normal text-slate-500">{asset.serial}</span>
      </div>
      <ol className="relative space-y-2 border-l border-white/10 pl-4">
        {recs.map((m) => {
          const fresh = Date.now() - new Date(m.date).getTime() < 3600000;
          return (
            <li key={m.id} className={`relative rounded-xl border p-2.5 ${fresh ? "hot border-lime-400/40 bg-lime-400/[0.05]" : "border-white/5 bg-white/[0.02]"}`}>
              <span className={`absolute top-3.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-ink-900 ${m.faultCode ? "bg-rose-400" : "bg-slate-500"}`} />
              <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
                <span className="font-mono text-slate-400">{m.date.slice(0, 10)}</span>
                <span className="text-slate-500">{m.type.toLowerCase()}</span>
                {m.faultCode && <Pill v="CRITICAL">{m.faultCode}</Pill>}
                {fresh && <span className="font-semibold text-lime-300">NEW · recorded by Pilot</span>}
                <span className="ml-auto text-slate-500">{m.technician}</span>
              </div>
              <div className="mt-1 text-[12px] text-slate-100">{m.summary}</div>
              {m.notes && <div className="mt-0.5 text-[11px] text-slate-400 italic">"{m.notes}"</div>}
              {m.partsReplaced.length > 0 && <div className="mt-1 text-[10.5px] text-slate-500">Parts: {m.partsReplaced.join(", ")}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Erp({ s, hl, tools }: { s: EState; hl: Record<string, number>; tools: ToolEvent[] }) {
  const lastCheck = [...tools].reverse().find((t) => t.name === "check_part_availability" && t.result?.results);
  const focus = new Set<string>((lastCheck?.result.results ?? []).flatMap((r: any) => [r.part_number, ...(r.approved_alternates ?? []).map((a: any) => a.part_number)]));
  const parts = [...s.parts].sort((a, b) => Number(focus.has(b.partNumber)) - Number(focus.has(a.partNumber)));
  return (
    <div className="space-y-3">
      <div>
        <H>Purchase orders</H>
        {s.purchaseOrders.length === 0 && <div className="text-[11px] text-slate-600">No orders yet.</div>}
        <div className="space-y-2">
          {s.purchaseOrders.map((po) => (
            <div key={po.id} className={`rounded-xl border border-amber-400/20 bg-amber-400/[0.03] p-3 ${isHot(hl, po.id) ? "hot" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">{po.id}</span>
                <Pill v={po.status} />
                {po.erpAttempts && po.erpAttempts > 1 ? <span className="rounded bg-amber-400/10 px-1.5 text-[10px] text-amber-300">ERP attempts: {po.erpAttempts}</span> : null}
                <span className="ml-auto font-mono text-sm font-semibold text-amber-200">${po.totalUsd}</span>
              </div>
              {po.lines.map((l) => (
                <div key={l.partNumber} className="mt-1 text-[11px] text-slate-300">
                  {l.qty} × {l.description} <span className="font-mono text-slate-500">@ {l.sourceLocation}</span>
                </div>
              ))}
              <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-slate-500">
                <Truck size={11} /> {po.delivery.method} · ETA {po.delivery.etaMinutes} min
              </div>
              {po.approvedBy && <div className="mt-0.5 text-[10.5px] text-violet-300">Approved by {po.approvedBy}</div>}
            </div>
          ))}
        </div>
      </div>
      {(s.returns?.length ?? 0) > 0 && (
        <div>
          <H>Parts returns (RMA)</H>
          {s.returns.map((r) => (
            <div key={r.id} className={`mb-2 rounded-xl border border-violet-400/25 bg-violet-400/[0.04] p-3 ${isHot(hl, r.ticketId) ? "hot" : ""}`}>
              <div className="flex items-center gap-2">
                <PackageX size={12} className="text-violet-300" />
                <span className="font-mono text-xs font-semibold">{r.id}</span>
                <Pill v="WARN">{r.status}</Pill>
                <span className="ml-auto text-[10.5px] text-slate-400">due {new Date(r.dueBy).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </div>
              {r.parts.map((p) => (
                <div key={p.partNumber} className="mt-1 text-[11px] text-slate-300">
                  {p.qty} × {p.partNumber} <span className="text-slate-500">— {p.condition}</span>
                </div>
              ))}
              <div className="mt-1 text-[10.5px] text-slate-500">
                {r.reason} → {r.returnTo} · {r.ticketId}
              </div>
            </div>
          ))}
        </div>
      )}
      {s.reservations.length > 0 && (
        <div>
          <H>Stock reservations</H>
          {s.reservations.map((r) => (
            <div key={r.id} className={`mb-1.5 flex items-center gap-2 rounded-lg border border-white/5 px-3 py-1.5 text-[11px] ${isHot(hl, r.ticketId) && r.status === "HELD" ? "hot" : ""}`}>
              <Lock size={11} className="text-amber-300" />
              <span className="font-mono">{r.id}</span>
              <span className="text-slate-300">
                {r.qty} × {r.partNumber}
              </span>
              <span className="truncate text-slate-500">@ {r.locationName}</span>
              <span className="ml-auto">
                <Pill v={r.status === "HELD" ? "WARN" : "OK"}>{r.status}</Pill>
              </span>
            </div>
          ))}
        </div>
      )}
      <div>
        <H>Stock by location</H>
        <div className="overflow-hidden rounded-xl border border-white/5">
          <table className="w-full text-[11px]">
            <tbody>
              {parts.map((p) => (
                <tr key={p.partNumber} className={`border-b border-white/5 ${focus.has(p.partNumber) ? "bg-amber-400/[0.06]" : ""}`}>
                  <td className="px-2.5 py-1.5">
                    <div className="font-mono text-[10.5px] text-slate-300">
                      {p.partNumber}
                      {p.alternates?.length ? <span className="ml-1.5 text-[9.5px] text-violet-300">alt {p.alternates.join(", ")}</span> : null}
                    </div>
                    <div className="text-[10px] text-slate-500">{p.description}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-400">${p.unitPriceUsd}</td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex flex-wrap justify-end gap-1">
                      {p.stock.length === 0 && <span className="text-[10px] text-rose-300">supplier only</span>}
                      {p.stock.map((st) => (
                        <span key={st.location} title={st.locationName} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${st.qty > 0 ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300/70"}`}>
                          {st.location} {st.qty}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Iot({ s, hl, active }: { s: EState; hl: Record<string, number>; active?: string }) {
  const assetId = s.tickets.find((t) => t.id === active)?.assetId ?? "A-CH-220";
  const [sel, setSel] = useState(assetId);
  useEffect(() => setSel(assetId), [assetId]);
  const live = useRef<Record<string, number[]>>({});
  const tel = s.telemetry[sel];
  const asset = s.assets.find((a) => a.id === sel)!;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {s.assets.map((a) => (
          <button key={a.id} onClick={() => setSel(a.id)} className={`rounded-lg border px-2.5 py-1 text-[11px] ${sel === a.id ? "border-lime-400/40 bg-lime-400/10 text-lime-200" : "border-white/10 text-slate-400"}`}>
            {a.name.split(" (")[0]}
          </button>
        ))}
      </div>
      <div className={`mb-3 flex items-center justify-between rounded-xl border border-white/5 px-3 py-2 ${isHot(hl, sel) ? "hot" : ""}`}>
        <div>
          <div className="text-[13px] font-semibold">
            {asset.manufacturer} {asset.model}
          </div>
          <div className="text-[10.5px] text-slate-500">BMS gateway · updated {tel ? timeAgo(tel.updatedAt) : "—"}</div>
        </div>
        <div className="flex gap-1">{tel?.activeFaults.length ? tel.activeFaults.map((f) => <Pill key={f.code} v="CRITICAL">{`${f.code} ×${f.count24h}`}</Pill>) : <Pill v="OK">No active faults</Pill>}</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tel?.points.map((p) => {
          const key = `${sel}:${p.metric}`;
          const hist = (live.current[key] ??= [...(p.trend7d ?? [])]);
          if (hist[hist.length - 1] !== p.value) hist.push(p.value);
          if (hist.length > 30) hist.shift();
          return (
            <div key={p.metric} className={`rounded-xl border p-2.5 transition-colors duration-700 ${p.status === "CRITICAL" ? "border-rose-500/30 bg-rose-500/[0.05]" : p.status === "WARN" ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-white/5 bg-white/[0.02]"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] text-slate-400">{p.metric}</div>
                <Pill v={p.status} />
              </div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <div>
                  <span className="font-mono text-xl font-semibold text-slate-100">{p.value}</span>
                  <span className="ml-1 text-[11px] text-slate-500">{p.unit}</span>
                  <div className="text-[10px] text-slate-600">expected {p.expected}</div>
                </div>
                <Sparkline data={hist} status={p.status} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Calendar({ s }: { s: EState }) {
  const items = [...s.calendar].sort((a, b) => a.start.localeCompare(b.start));
  let lastDay = "";
  return (
    <div className="space-y-1.5">
      {items.map((a) => {
        const day = new Date(a.start).toDateString();
        const header = day !== lastDay ? ((lastDay = day), true) : false;
        return (
          <div key={a.id}>
            {header && <div className="panel-title mt-2 mb-1">{new Date(a.start).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</div>}
            <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${a.kind === "FOLLOW_UP" ? "hot border-pink-400/40 bg-pink-400/[0.06]" : a.kind === "BLOCKED" ? "border-white/5 opacity-60" : "border-white/5 bg-white/[0.02]"}`}>
              <div className="w-28 shrink-0 font-mono text-[11px] text-slate-400">
                {new Date(a.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – {new Date(a.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </div>
              <div className="text-[12px] text-slate-200">{a.title}</div>
              {a.kind === "FOLLOW_UP" && <span className="ml-auto text-[10px] font-semibold text-pink-300">BOOKED BY PILOT</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Outbox({ s }: { s: EState }) {
  if (!s.notifications.length) return <Empty>Customer SMS, emails and Teams pings sent by Pilot appear here.</Empty>;
  return (
    <div className="space-y-2">
      {s.notifications.map((n, i) => (
        <div key={n.id} className={`rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] p-3 ${i === 0 ? "enter hot" : ""}`}>
          <div className="flex items-center gap-2 text-[11px]">
            {n.channel === "SMS" ? <Smartphone size={12} className="text-emerald-300" /> : n.channel === "TEAMS" ? <MessageSquare size={12} className="text-emerald-300" /> : <Mail size={12} className="text-emerald-300" />}
            <span className="font-semibold text-emerald-200">{n.channel}</span>
            <span className="truncate text-slate-400">→ {n.to}</span>
            <span className="ml-auto shrink-0 text-[10px] text-slate-500">{timeAgo(n.at)}</span>
          </div>
          <div className="mt-1 text-[12px] font-medium text-slate-200">{n.subject}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{n.body}</div>
        </div>
      ))}
    </div>
  );
}

function Knowledge({ ev }: { ev?: ToolEvent }) {
  if (!ev) return <Empty>Retrieved manual sections, service bulletins and SOPs appear here with citations.</Empty>;
  const r = ev.result;
  const strip = (c: string) => c.replace(/^<<<DOCUMENT[^\n]*\n/, "").replace(/\n<<<END DOCUMENT>>>$/, "");
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-white/5 px-3 py-2 text-[11px] text-slate-400">
        <div>
          Query: <span className="font-mono text-violet-300">"{ev.args?.query}"</span>
        </div>
        {r.context_applied && (
          <div className="mt-0.5">
            Context: {r.context_applied.asset_model ?? "—"}
            {r.context_applied.fault_codes?.length ? ` · fault ${r.context_applied.fault_codes.join(", ")}` : ""} · retrieval <span className="font-mono text-slate-300">{r.retrieval}</span>
          </div>
        )}
      </div>
      {r.results.map((h: any, i: number) => (
        <div key={i} className={`enter rounded-xl border p-3 ${h.trust === "unverified" ? "border-amber-400/25 bg-amber-400/[0.03]" : "border-violet-400/20 bg-violet-400/[0.04]"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-violet-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-200">
              {h.doc_id}
              {h.section ? ` §${h.section}` : ""}
            </span>
            <span className="truncate text-[11.5px] font-medium text-slate-200">{h.heading}</span>
            <span className="ml-auto text-[9.5px] tracking-wide text-slate-500 uppercase">{String(h.source_type).replace("_", " ")}</span>
            {h.trust === "unverified" && <Pill v="WARN">unverified</Pill>}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10.5px] text-cyan-200/80">
            <Quote size={10} /> spoken as "per {h.cite}"
          </div>
          {h.injection_removed && (
            <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-rose-500/10 px-2 py-1 text-[10.5px] text-rose-200">
              <ShieldAlert size={11} /> Prompt injection neutralized — {h.injection_removed}
            </div>
          )}
          <p className="mt-1.5 line-clamp-6 text-[11.5px] leading-relaxed whitespace-pre-line text-slate-300">{strip(h.content)}</p>
        </div>
      ))}
    </div>
  );
}

const AUDIT_STYLE: Record<string, string> = {
  EXECUTED: "text-emerald-300",
  PENDING_CONFIRMATION: "text-amber-300",
  BLOCKED: "text-rose-300",
  REJECTED: "text-slate-400",
  FAILED: "text-rose-300",
  QUEUED: "text-amber-300",
};

function Audit({ s }: { s: EState }) {
  if (!s.audit?.length) return <Empty>Every write to an enterprise system is recorded here — who, what, when, and who confirmed it.</Empty>;
  return (
    <div className="space-y-1.5">
      {s.audit.map((a, i) => (
        <div key={a.id} className={`rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 ${i === 0 ? "enter" : ""}`}>
          <div className="flex items-center gap-2 text-[10.5px]">
            <span className="font-mono text-slate-500">{new Date(a.at).toLocaleTimeString()}</span>
            <span className="rounded border border-white/10 px-1 font-mono text-[9.5px] text-slate-300">{a.system}</span>
            <span className="truncate font-mono text-slate-300">{a.tool}</span>
            <span className={`ml-auto shrink-0 font-semibold ${AUDIT_STYLE[a.status]}`}>{a.status.replaceAll("_", " ")}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-slate-200">{a.summary}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            by {a.actor}
            {a.confirmedBy && (a.confirmedBy.startsWith("not required") ? <> · no confirmation needed (low risk)</> : <> · confirmed by {a.confirmedBy}</>)}
            {a.retries ? <span className="text-amber-300"> · {a.retries} retr{a.retries > 1 ? "ies" : "y"}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

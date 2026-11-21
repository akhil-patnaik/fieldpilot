import { useEffect, useRef, useState } from "react";
import { BrainCircuit, CheckCircle2, CircleX, LoaderCircle, ShieldAlert, ShieldCheck, RotateCcw, ChevronRight, Mic, AudioLines, Database, Network } from "lucide-react";
import type { ToolEvent } from "../lib/types";
import { RiskBadge, SystemBadge } from "./ui";

function summarizeArgs(args: any) {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 160);
}

function headline(t: ToolEvent): string | null {
  const r = t.result;
  if (!r) return null;
  if (r.error) return r.error;
  if (r.status === "CONFIRMATION_REQUIRED") return `PENDING ${r.action_id} — ${r.readback}`;
  if (t.name === "safety_guard") return `Refused: ${r.reason}`;
  if (t.name === "search_knowledge_base")
    return `${r.results?.[0] ? `Cite: "${r.results[0].cite}"` : "No match"}${r.results?.some((h: any) => h.injection_removed) ? " · ⚠ injection stripped from a field note" : ""} · ${r.retrieval}`;
  if (t.name === "act_on_insight") return r.completed ? `${r.insight_id}: ${r.completed.join(" → ")}${r.failed?.length ? ` · failed: ${r.failed.join("; ")}` : ""}` : null;
  if (t.name === "reschedule_jobs") return r.moved ? r.moved.map((m: any) => `${m.ticket_id} → ${m.start}`).join(" · ") : null;
  if (t.name === "complete_visit") return r.completed ? `${r.completed.length}/6 steps done${r.failed?.length ? ` · failed: ${r.failed.join("; ")}` : ""} · ${r.report_id ?? ""} · ${r.rma ?? ""} · inspection ${r.follow_up ?? "—"}` : null;
  if (t.name === "update_maintenance_record") return `CMMS record ${r}`;
  if (t.name === "close_ticket") return `Work order → ${r}`;
  if (t.name === "schedule_inspection") return r?.title ? `${r.id} · ${new Date(r.start).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : null;
  if (t.name === "create_return_task") return r?.id ? `${r.id}: ${r.parts.map((p: any) => `${p.qty} × ${p.partNumber}`).join(", ")} → ${r.returnTo}` : null;
  if (t.name === "generate_service_report" && r?.id && !r.report_id) return `${r.id} stored (HTML/PDF)`;
  if (t.name === "send_customer_summary") return r?.to ? `EMAIL → ${r.to}` : null;
  if (t.name === "get_daily_briefing") return `${r.work_orders?.length} open work orders · top: ${r.work_orders?.[0]?.ticket_id} (${r.work_orders?.[0]?.priority})`;
  if (t.name === "get_ticket_details") return r.insight ?? `${r.ticket?.id} · ${r.asset?.make_model}`;
  if (t.name === "get_asset_history") return `${r.records?.length} records · latest: ${r.records?.[0]?.summary}`;
  if (t.name === "get_live_telemetry") return r.readings?.filter((x: any) => x.status !== "OK").map((x: any) => `${x.metric} ${x.value}`).join(" · ") || "All readings normal";
  if (t.name === "check_part_availability")
    return `${r.stale ? "⚠ stale replica · " : ""}${r.results?.map((x: any) => `${x.part_number}: main WH ${String(x.main_warehouse).replaceAll("_", " ").toLowerCase()} → ${x.recommendation}`).join(" | ")}`;
  if (r.reservation_id) return `${r.reservation_id}: ${r.qty} × ${r.part_number} held at ${r.location}${r.holder_notified ? ` · ${r.holder_notified} pinged` : ""}`;
  if (r.po_id) return `${r.po_id} · ${r.total_usd ? `$${r.total_usd} · ` : ""}${String(r.status).replaceAll("_", " ")}${r.what_failed ? ` — ${r.what_failed}` : ""}`;
  if (r.cmms_record) return `${r.cmms_record} written · ticket ${r.status}`;
  if (r.incident_id) return `${r.incident_id} → ${r.assignee}`;
  if (r.slots) return r.slots.map((x: any) => x.label).join(" · ");
  if (r.appointment_id) return `${r.appointment_id} · ${r.when}`;
  if (r.report_id) return `${r.report_id} → ${r.emailed_to}`;
  if (r.sent_to) return `${r.channel} → ${r.sent_to}`;
  if (r.effect) return r.effect;
  if (r.cancelled) return `Cancelled ${r.cancelled}`;
  if (r.status) return `${r.previous_status ? `${r.previous_status} → ` : "Status → "}${r.status}`;
  return null;
}

export function Trace({ tools, thinking }: { tools: ToolEvent[]; thinking: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [tools.length, thinking]);

  return (
    <section className="panel flex h-[460px] min-h-0 flex-col overflow-hidden lg:h-auto lg:flex-1">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <div className="panel-title flex items-center gap-2">
          <BrainCircuit size={13} /> Agent reasoning trace
        </div>
        <span className="font-mono text-[10px] text-slate-500">{tools.length} ops</span>
      </div>
      <div ref={ref} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tools.length === 0 && <Architecture />}
        <ol className="relative space-y-2">
          {tools.map((t) => {
            const r = t.result;
            const staged = r?.status === "CONFIRMATION_REQUIRED";
            const guard = typeof r?.error === "string" && r.error.includes("GUARDRAIL");
            const confirmed = t.label.includes("confirmed");
            const Icon = t.phase === "start" ? LoaderCircle : guard ? ShieldAlert : staged ? ShieldCheck : t.ok === false || r?.error ? CircleX : CheckCircle2;
            const color = t.phase === "start" ? "text-cyan-300 animate-spin" : guard || r?.error ? "text-rose-400" : staged ? "text-amber-300" : "text-emerald-400";
            const h = headline(t);
            return (
              <li key={t.id} className={`enter rounded-xl border p-2.5 transition ${t.phase === "start" ? "border-cyan-400/30 bg-cyan-400/[0.04]" : confirmed ? "border-emerald-400/30 bg-emerald-400/[0.04]" : staged ? "border-amber-400/30 bg-amber-400/[0.04]" : "border-white/5 bg-white/[0.02]"}`}>
                <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <Icon size={15} className={`mt-0.5 shrink-0 ${color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SystemBadge system={t.system} />
                      <span className="text-[12.5px] font-semibold text-slate-100">{t.label}</span>
                      <RiskBadge risk={t.risk} />
                      {t.retries ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-400/10 px-1.5 text-[10px] text-amber-300">
                          <RotateCcw size={10} /> recovered after {t.retries} retr{t.retries > 1 ? "ies" : "y"}
                        </span>
                      ) : null}
                      <span className="ml-auto font-mono text-[10px] text-slate-500">{t.ms !== undefined ? `${t.ms}ms` : "…"}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-slate-500">
                      {t.name}({summarizeArgs(t.args)})
                    </div>
                    {t.retryLog?.map((x) => (
                      <div key={x.attempt} className="mt-1 flex items-center gap-1.5 rounded-md bg-amber-400/[0.08] px-2 py-0.5 font-mono text-[10.5px] text-amber-200">
                        <RotateCcw size={10} className="shrink-0" /> attempt {x.attempt} failed: {x.error} · retry in {x.backoffMs}ms
                      </div>
                    ))}
                    {h && <div className={`mt-1 text-[11.5px] leading-snug ${r?.error ? "text-rose-300" : staged ? "text-amber-200" : "text-slate-300"}`}>{h}</div>}
                    {r?.recovered && <div className="mt-0.5 text-[10.5px] font-medium text-emerald-300">✓ recovered — succeeded on attempt {(t.retries ?? 0) + 1}</div>}
                    {r?.alternative_taken && <div className="mt-0.5 text-[10.5px] font-medium text-amber-300">↪ {r.alternative_taken}</div>}
                  </div>
                  <ChevronRight size={14} className={`mt-0.5 shrink-0 text-slate-600 transition ${open === t.id ? "rotate-90" : ""}`} />
                </button>
                {open === t.id && r && (
                  <pre className="scroll-thin mt-2 max-h-64 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-400">{JSON.stringify(r, null, 2)}</pre>
                )}
              </li>
            );
          })}
          {thinking && (
            <li className="flex items-center gap-2 rounded-xl border border-violet-400/20 px-3 py-2 text-[11.5px] text-violet-200">
              <BrainCircuit size={14} className="animate-pulse" />
              <span className="shimmer rounded px-1">Reasoning about next step…</span>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

function Architecture() {
  const Node = ({ Icon, title, sub, c }: any) => (
    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${c}`}>
      <Icon size={15} />
      <div>
        <div className="text-[11.5px] font-semibold text-slate-100">{title}</div>
        <div className="text-[10px] text-slate-400">{sub}</div>
      </div>
    </div>
  );
  const Arrow = () => <div className="mx-auto h-3 w-px bg-gradient-to-b from-white/30 to-transparent" />;
  return (
    <div className="mx-auto max-w-sm py-2">
      <div className="mb-3 text-center text-[11px] text-slate-500">How a spoken request becomes enterprise actions</div>
      <Node Icon={Mic} title="Technician voice" sub="Agora RTC · echo-cancelled, full-duplex barge-in" c="border-cyan-400/30 bg-cyan-400/5 text-cyan-300" />
      <Arrow />
      <Node Icon={AudioLines} title="Agora Conversational AI" sub="ASR · semantic turn detection · interruption" c="border-cyan-400/30 bg-cyan-400/5 text-cyan-300" />
      <Arrow />
      <Node Icon={BrainCircuit} title="Pilot agent brain (custom LLM endpoint)" sub="LLM tool-calling loop · RAG · guardrails · memory" c="border-violet-400/30 bg-violet-400/5 text-violet-300" />
      <div className="my-1.5 grid grid-cols-4 gap-1">
        {["FSM", "CMMS", "IoT", "ERP", "Knowledge", "Calendar", "Comms", "MCP"].map((s) => (
          <div key={s} className="flex items-center justify-center gap-1 rounded border border-white/10 py-1 font-mono text-[9.5px] text-slate-400">
            {s === "MCP" ? <Network size={9} /> : <Database size={9} />} {s}
          </div>
        ))}
      </div>
      <Arrow />
      <Node Icon={AudioLines} title="Murf AI Falcon TTS" sub="~100ms time-to-first-audio · streamed back to the technician" c="border-lime-400/30 bg-lime-400/5 text-lime-300" />
    </div>
  );
}

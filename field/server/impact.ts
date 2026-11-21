import { db } from "./store.ts";
import { sessions } from "./session.ts";
import { tools, WRAP_UP_MINUTES } from "./tools.ts";
import { insightStats, list as listInsights } from "./watchtower.ts";

/**
 * Impact model — computed ONLY from this session's real records (audit log, ERP, calendar, Watchtower).
 * Every number carries its basis; every baseline is an explicit, numbered assumption shown on screen.
 * When there is no data yet, the metric says so instead of showing a number.
 */

export type Basis = "measured" | "computed" | "modelled" | "estimated";
export interface ImpactMetric {
  id: string;
  label: string;
  value: string | null;
  basis: Basis;
  detail: string;
  baseline: string | null;
  assumption?: string;
  delta?: string;
}

export const ASSUMPTIONS = [
  { id: "A1", text: "Manual diagnosis of a repeat fault — pulling CMMS history, finding the manual and the bulletin, reading the BMS separately — takes about 45 minutes." },
  { id: "A2", text: "Writing, formatting and emailing a service report by hand takes about 25 minutes." },
  { id: "A3", text: "Per-task manual effort, used for 'admin time': the minutes listed per tool below (e.g. stock check 9 min, purchase order 12 min, service report 22 min)." },
  { id: "A4", text: "Without cross-location stock visibility, a part that is out at the main warehouse is ordered from the supplier, at the lead time in the ERP part record." },
  { id: "A5", text: "Without re-sequencing, the day runs in the booked order; the overrun is Watchtower's route projection (travel + queue + duration + parts wait)." },
  { id: "A6", text: "An unbundled same-site job costs one extra truck roll: a round trip at the site's typical travel time." },
];

const fmtDur = (ms: number) => {
  if (ms < 1000) return "<1 s";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function computeImpact() {
  const s = db.get();
  const session = sessions.current();
  const since = session.startedAt;
  const inSession = (iso?: string) => !!iso && new Date(iso).getTime() >= since;
  const audit = s.audit.filter((a) => inSession(a.at));
  const m = session.metrics;
  const metrics: ImpactMetric[] = [];

  // 1 · Time to diagnosis (measured)
  const diagnosed = s.tickets.filter((t) => t.diagnosis && inSession(t.diagnosis.at));
  if (diagnosed.length) {
    const t = diagnosed[0];
    const start = new Date(session.ticketFirstSeen[t.id] ?? new Date(since).toISOString()).getTime();
    const ms = new Date(t.diagnosis!.at).getTime() - start;
    metrics.push({ id: "diagnosis", label: "Time to diagnosis", value: fmtDur(ms), basis: "measured", detail: `${t.id}: from first opening the work order to the recorded root cause, with telemetry, history and the bulletin checked.`, baseline: "~45 min", assumption: "A1", delta: `${Math.max(0, Math.round(45 - ms / 60000))} min faster` });
  } else metrics.push({ id: "diagnosis", label: "Time to diagnosis", value: null, basis: "measured", detail: "No diagnosis recorded in this session yet.", baseline: "~45 min", assumption: "A1" });

  // 2 · System work done by voice (measured) vs manual screen work (estimated)
  const systems = Object.keys(m.systems).filter((k) => !["Guardrail", "Watchtower", "Knowledge"].includes(k));
  metrics.push({
    id: "ops",
    label: "System work done by voice",
    value: m.toolCalls ? `${m.toolCalls} operations · ${systems.length} systems` : null,
    basis: "measured",
    detail: m.toolCalls ? `Systems touched: ${systems.join(", ") || "—"}. Average tool latency ${m.toolLatencyMs.length ? Math.round(m.toolLatencyMs.reduce((a, b) => a + b, 0) / m.toolLatencyMs.length) : 0} ms.` : "No tool calls yet.",
    baseline: m.toolCalls ? `~${Math.round(m.manualMinutesSaved)} min of screen work` : null,
    assumption: "A3",
  });

  // 3 · Report time (measured)
  const rep = audit.find((a) => a.tool === "generate_service_report" && a.status === "EXECUTED");
  const wrap = audit.find((a) => a.tool === "complete_visit" && a.status === "EXECUTED");
  const report = s.reports.find((r) => inSession(r.createdAt));
  metrics.push({
    id: "report",
    label: "Service report",
    value: report ? (rep?.ms != null ? fmtDur(rep.ms) : "generated") : null,
    basis: "measured",
    detail: report ? `${report.id} generated, stored and emailed${wrap?.ms != null ? `; the whole 6-step wrap-up took ${fmtDur(wrap.ms)} after the technician's yes` : ""}.` : "No report generated in this session yet.",
    baseline: "~25 min",
    assumption: "A2",
    delta: report ? "~25 min of write-up avoided" : undefined,
  });

  // 4 · Parts wait avoided (computed from ERP data)
  const sourced = s.reservations.filter((r) => inSession(r.createdAt) && r.location.startsWith("VAN-") && r.location !== s.technician.vanId);
  if (sourced.length) {
    const lines = sourced.map((r) => {
      const p = s.parts.find((x) => x.partNumber === r.partNumber)!;
      const eta = p.stock.find((x) => x.location === r.location)?.etaMinutes ?? 0;
      return { r, eta, leadMin: p.supplierLeadDays * 1440 };
    });
    // Waits within one job overlap, so take the longest per job, then add up across jobs.
    const perJob = new Map<string, number>();
    for (const l of lines) perJob.set(l.r.ticketId, Math.max(perJob.get(l.r.ticketId) ?? 0, l.leadMin - l.eta));
    const avoided = [...perJob.values()].reduce((a, b) => a + b, 0);
    metrics.push({
      id: "parts",
      label: "Parts wait avoided",
      value: `~${Math.round((avoided / 1440) * 10) / 10} days across ${perJob.size} job${perJob.size > 1 ? "s" : ""}`,
      basis: "computed",
      detail: lines.map((l) => `${l.r.ticketId}: ${l.r.qty} × ${l.r.partNumber} from ${l.r.locationName} in ${l.eta} min vs a ${l.leadMin / 1440}-day supplier lead time`).join("; "),
      baseline: "supplier order",
      assumption: "A4",
    });
  } else metrics.push({ id: "parts", label: "Parts wait avoided", value: null, basis: "computed", detail: "No cross-location parts sourcing in this session yet.", baseline: "supplier order", assumption: "A4" });

  // 5 · SLA time protected (modelled) · 6 · Truck rolls avoided (counted)
  const acted = listInsights().filter((i) => i.status === "acted");
  const sla = acted.filter((i) => i.kind === "sla_risk");
  const slaMin = sla.reduce((a, i) => a + Number(i.meta?.lateMinutes ?? 0), 0);
  metrics.push({ id: "sla", label: "SLA time protected", value: sla.length ? `~${Math.round(slaMin)} min` : null, basis: "modelled", detail: sla.length ? `${sla.length} re-sequence(s) accepted; projected overrun avoided.` : "No re-sequencing accepted in this session yet.", baseline: "booked order", assumption: "A5" });
  const bundles = acted.filter((i) => i.dedupeKey.startsWith("bundle:"));
  const driving = bundles.reduce((a, i) => a + 2 * (s.sites.find((x) => x.id === i.siteId)?.travelMinutes ?? 20), 0);
  metrics.push({ id: "rolls", label: "Truck rolls avoided", value: bundles.length ? `${bundles.length} (~${driving} min driving)` : null, basis: "measured", detail: bundles.length ? "Same-site jobs bundled into one visit." : "No bundling accepted in this session yet.", baseline: bundles.length ? `${bundles.length} extra trip(s)` : null, assumption: "A6" });

  // 7 · Proactive precision (measured)
  const st = insightStats();
  metrics.push({ id: "precision", label: "Proactive insight precision", value: st.shown ? `${Math.round((st.precision ?? 0) * 100)}% (${st.accepted}/${st.shown})` : null, basis: "measured", detail: st.shown ? `Accepted ÷ spoken. ${st.dismissed} dismissed (each dismissal suppresses and down-weights that detector).` : "Watchtower hasn't spoken up in this session yet.", baseline: null });

  // 8 · Human control (measured)
  const confirmed = audit.filter((a) => a.status === "EXECUTED" && a.confirmedBy && !a.confirmedBy.startsWith("not required")).length;
  const blocked = audit.filter((a) => a.status === "BLOCKED").length;
  const unconfirmed = audit.filter((a) => a.status === "EXECUTED" && ["medium", "high"].includes(a.risk) && !a.confirmedBy).length;
  metrics.push({ id: "control", label: "Critical writes under human control", value: audit.length ? `${confirmed} confirmed · ${blocked} blocked · ${unconfirmed} unconfirmed` : null, basis: "measured", detail: "From the audit log: every medium/high-risk write needs the technician's explicit yes (or a tap); blocked = attempts the gate refused.", baseline: null });

  return {
    generatedAt: new Date().toISOString(),
    session: { startedAt: new Date(since).toISOString(), mode: session.mode },
    metrics,
    assumptions: ASSUMPTIONS,
    manualMinutesTable: [
      ...tools.filter((t) => t.manualMinutes > 0).map((t) => ({ tool: t.name, label: t.label, minutes: t.manualMinutes })),
      ...Object.entries(WRAP_UP_MINUTES).map(([tool, minutes]) => ({ tool: `wrap_up.${tool}`, label: `Wrap-up: ${tool.replace(/_/g, " ")}`, minutes })),
    ],
  };
}

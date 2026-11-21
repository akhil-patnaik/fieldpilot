import { db } from "./store.ts";
import { emit, onEvent } from "./bus.ts";
import { KNOWLEDGE_BASE, shiftEnd, type Appointment, type Asset, type EnterpriseState, type Part, type Site, type Ticket } from "./seed.ts";
import { emitMetrics, sessions, type Session } from "./session.ts";
import { simNow } from "./simulator.ts";
import { cancelPending, setInsightBridge, stageAction } from "./tools.ts";

/**
 * WATCHTOWER — a background rule + scoring engine that continuously evaluates enterprise state and
 * produces ranked, evidence-backed Insights, then decides WHEN the agent may speak up.
 *
 *   detectors (pure)  →  correlate (one story per job)  →  merge/dedupe/suppress  →  rank  →  deliver
 *
 * Delivery rules: never talk over the technician (agent idle, nobody speaking, quiet window) unless the
 * insight is safety-critical; rate-limited; one announcement per insight; ≤ 2 sentences of "why" + one offer.
 * Every recommended action is STAGED through the confirmation gate (act_on_insight) — proactive never means
 * unconfirmed. Dismissals suppress the dedupe key and teach a per-detector confidence penalty.
 */

// ───────────────────────── types ─────────────────────────

export type Severity = "info" | "warning" | "critical" | "safety";
export type Kind = "recurring_fault" | "telemetry_trend" | "parts_risk" | "sla_risk" | "safety" | "schedule" | "composite";
export type Status = "new" | "accepted" | "dismissed" | "acted";

export interface Evidence {
  label: string;
  value: string;
  ref?: string;
  source?: Kind;
}
export interface ActionStep {
  tool: string;
  args: Record<string, unknown>;
}
export interface RecommendedAction {
  label: string;
  steps: ActionStep[];
  /** Exact gate readback: what will happen, cost and ETA. */
  readback: string;
  /** The spoken offer (one question). */
  offer: string;
  costUsd?: number;
  etaMinutes?: number;
}
export interface Finding {
  kind: Kind;
  dedupeKey: string;
  severity: Severity;
  confidence: number;
  title: string;
  /** ≤ 2 sentences explaining why. */
  why: string;
  evidence: Evidence[];
  action?: RecommendedAction;
  ticketId?: string;
  assetId?: string;
  siteId?: string;
  components?: Finding[];
  meta?: Record<string, unknown>;
}
export interface Insight extends Finding {
  id: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  announcedAt?: string;
  pendingActionId?: string;
  score: number;
  /** Why it was not (yet) spoken, for the UI. */
  hold?: string;
}

export interface DetectCtx {
  now: number;
  simNow: number;
}

// ───────────────────────── vocabulary helpers ─────────────────────────

const H = 3_600_000;
const D = 24 * H;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const numberWord = (n: number) => WORDS[n] ?? String(n);
const ORD = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number) => ORD[n] ?? `${n}th`;
export function spokenTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const ap = d.getHours() < 12 ? "AM" : "PM";
  return d.getMinutes() ? `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}` : `${h} ${ap}`;
}
export function humanMinutes(min: number) {
  const m = Math.max(1, Math.round(min));
  if (m < 90) return `${m} minute${m === 1 ? "" : "s"}`;
  if (m < 36 * 60) {
    const h = Math.round(m / 30) / 2;
    return `${h % 1 ? `${Math.floor(h)} and a half` : h} hour${h === 1 ? "" : "s"}`;
  }
  return `${Math.round(m / 1440)} days`;
}
const siteShort = (s: Site) => s.shortName ?? s.name;
export const assetNoun = (a: Asset) => (/chiller|RTC/i.test(`${a.name} ${a.model}`) ? "chiller" : /AHU/i.test(`${a.name} ${a.model}`) ? a.name.split(" (")[0] : /generator|DG-/i.test(`${a.name} ${a.model}`) ? "generator" : a.name.split(" (")[0]);
const customerNoun = (s: Site) => (/hospital|medical/i.test(s.name) ? "hospital" : "site");
const sevRank: Record<Severity, number> = { info: 0, warning: 1, critical: 2, safety: 3 };
const sevWeight: Record<Severity, number> = { info: 1, warning: 2, critical: 3.2, safety: 10 };
const ALIAS: Record<string, string> = { "Discharge pressure": "head pressure" };
const alias = (m: string) => ALIAS[m] ?? m.toLowerCase();
function spokenLocation(code: string, name: string) {
  const m = code.match(/^VAN-0*(\d+)$/);
  if (m) return `truck ${numberWord(Number(m[1]))}`;
  return `the ${name.replace(/ \(.*\)$/, "")}`;
}
const OPEN = (t: Ticket) => !["RESOLVED", "CLOSED"].includes(t.status);

/** Thresholds the detectors reason about. `danger` = stop-work band. */
export const THRESHOLDS: { match: RegExp; limit: number; dir: "up" | "down"; danger?: number; hazard?: string; advice?: string }[] = [
  { match: /^Discharge pressure$/, limit: 425, dir: "up", danger: 440, hazard: "over-pressure rupture, because the high-pressure switch didn't trip", advice: "Stay clear of the condenser and isolate the unit at its disconnect." },
  { match: /cold room temp/i, limit: 8, dir: "up" },
  { match: /fan #\d current/i, limit: 1.0, dir: "down" },
  { match: /panel temp/i, limit: 70, dir: "up", danger: 85, hazard: "arc-flash and fire", advice: "Don't open the panel; isolate it at the upstream breaker and keep everyone clear." },
  { match: /supply fan vibration/i, limit: 7.1, dir: "up" },
  { match: /bearing temp/i, limit: 75, dir: "up" },
  { match: /filter differential/i, limit: 350, dir: "up" },
];
const thresholdFor = (metric: string) => THRESHOLDS.find((t) => t.match.test(metric));

function openTicketFor(s: EnterpriseState, assetId: string) {
  return s.tickets.find((t) => t.assetId === assetId && OPEN(t));
}
function nextJob(s: EnterpriseState, ticketId: string, now: number): Appointment | undefined {
  return s.calendar
    .filter((a) => a.ticketId === ticketId && a.kind === "JOB" && new Date(a.end).getTime() >= now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
}
function available(s: EnterpriseState, p: Part, location: string, forTicket?: string) {
  const st = p.stock.find((x) => x.location === location);
  if (!st) return 0;
  const held = s.reservations.filter((r) => r.status === "HELD" && r.partNumber === p.partNumber && r.location === location && r.ticketId !== forTicket).reduce((n, r) => n + r.qty, 0);
  return Math.max(0, st.qty - held);
}

// ───────────────────────── detector 1: recurring fault ─────────────────────────

export function detectRecurringFault(s: EnterpriseState, ctx: DetectCtx): Finding[] {
  const out: Finding[] = [];
  for (const asset of s.assets) {
    const tel = s.telemetry[asset.id];
    const ticket = openTicketFor(s, asset.id);
    if (!ticket) continue;
    for (const f of tel?.activeFaults ?? []) {
      const past = s.maintenance.filter((m) => m.assetId === asset.id && m.faultCode === f.code && ctx.now - new Date(m.date).getTime() <= 90 * D).sort((a, b) => a.date.localeCompare(b.date));
      const occurrences = past.length + 1; // + the active one
      if (occurrences < 2) continue;
      const capRelated = past.some((m) => /capacitor/i.test(`${m.summary} ${m.notes}`));
      const model = `${asset.manufacturer} ${asset.model}`;
      const docs = KNOWLEDGE_BASE.filter(
        (d) => (d.type === "resolution" || d.type === "service_bulletin") && d.models.includes(model) && d.chunks.some((c) => c.text.includes(f.code) || (capRelated && /capacitor/i.test(c.text))),
      );
      const site = s.sites.find((x) => x.id === asset.siteId)!;
      const cause = capRelated ? "capacitor-related" : "unresolved";
      out.push({
        kind: "recurring_fault",
        dedupeKey: `recurring:${asset.id}:${f.code}`,
        severity: occurrences >= 3 ? "warning" : "info",
        confidence: Math.min(0.95, 0.55 + 0.12 * (occurrences - 2) + (capRelated ? 0.15 : 0) + (docs.length ? 0.1 : 0)),
        title: `${siteShort(site)} ${assetNoun(asset)}: ${ordinal(occurrences)} ${f.code} in 90 days`,
        why: `It's the ${ordinal(occurrences)} ${cause} ${f.code} trip on the ${siteShort(site)} ${assetNoun(asset)} in 90 days${docs[0] ? `, the pattern in ${docs[0].citeAs}` : ""}.`,
        evidence: [
          ...past.map((m) => ({ label: `${m.date.slice(0, 10)} · ${m.id}`, value: m.summary, ref: m.id })),
          { label: "Active now", value: `${f.code} ×${f.count24h} in the last 24h`, ref: asset.id },
          ...docs.map((d) => ({ label: "Linked knowledge", value: d.title, ref: d.id })),
        ],
        action: {
          label: "Escalate repeat failure to Reliability Engineering",
          steps: [{ tool: "escalate_incident", args: { ticket_id: ticket.id, severity: "SEV3", team: "Reliability Engineering", reason: `Repeat ${f.code} on ${asset.id}: ${occurrences} in 90 days (${cause})` } }],
          readback: `I'll open a severity-three escalation to Reliability Engineering on work order ${ticket.id.replace("WO-", "")} for the repeat ${f.code}.`,
          offer: "Want me to flag it to Reliability Engineering?",
          costUsd: 0,
        },
        ticketId: ticket.id,
        assetId: asset.id,
        siteId: site.id,
        meta: { occurrences, capRelated, code: f.code, docs: docs.map((d) => d.id), likelyPart: capRelated && /RTC/.test(asset.model) ? { partNumber: "CAP-75-440", qty: 1 } : undefined },
      });
    }
  }
  return out;
}

// ───────────────────────── detector 2: telemetry trend ─────────────────────────

function fit(series: [number, number][]) {
  const n = series.length;
  const mx = series.reduce((a, p) => a + p[0], 0) / n;
  const my = series.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of series) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, r2 };
}

export function detectTelemetryTrend(s: EnterpriseState, ctx: DetectCtx): Finding[] {
  const out: Finding[] = [];
  for (const [assetId, tel] of Object.entries(s.telemetry)) {
    const asset = s.assets.find((a) => a.id === assetId);
    if (!asset) continue;
    const site = s.sites.find((x) => x.id === asset.siteId)!;
    const ticket = openTicketFor(s, assetId);
    for (const p of tel.points) {
      const th = thresholdFor(p.metric);
      if (!th) continue;
      // Prefer live high-resolution samples (simulation clock); else the 7-day daily trend.
      const live = (p.samples ?? []).filter(([t]) => ctx.simNow - t <= 12 * H);
      const fine = live.length >= 4;
      const series: [number, number][] = fine ? live.map(([t, v]) => [t / 60000, v]) : (p.trend7d ?? []).map((v, i, arr) => [(ctx.simNow - (arr.length - 1 - i) * D) / 60000, v]);
      if (series.length < 4) continue;
      const { slope, r2 } = fit(series);
      const v = p.value;
      const rising = th.dir === "up";
      if ((rising && (slope <= 0 || v >= th.limit)) || (!rising && (slope >= 0 || v <= th.limit))) continue;
      const minutes = Math.abs((th.limit - v) / slope);
      if (minutes > 7 * 24 * 60) continue;
      const severity: Severity = minutes <= 60 ? "critical" : minutes <= 24 * 60 ? "warning" : "info";
      const rate = fine ? `${Math.abs(slope).toFixed(1)} ${p.unit} a minute` : `${Math.round(Math.abs(slope) * 1440 * 10) / 10} ${p.unit} a day`;
      const noun = assetNoun(asset);
      const isHeadPressure = /^Discharge pressure$/.test(p.metric) && /RTC/.test(asset.model);
      const action =
        severity === "critical" && isHeadPressure
          ? {
              label: "Head Pressure Limit mode (temporary mitigation)",
              steps: [{ tool: "set_asset_operating_mode", args: { asset_id: assetId, mode: "HEAD_PRESSURE_LIMIT", reason: `Watchtower: predicted HP-02 trip in ~${Math.round(minutes)} min` } }],
              readback: `I'll switch the ${siteShort(site)} ${noun} to Head Pressure Limit mode remotely. That caps it at 70 percent and holds head pressure under 380 psi until you get there; no cost.`,
              offer: "Want me to switch it to Head Pressure Limit mode until you get there?",
              costUsd: 0,
              etaMinutes: 1,
            }
          : ticket
            ? {
                label: "Log the trend on the work order",
                steps: [{ tool: "update_ticket", args: { ticket_id: ticket.id, note: `Watchtower: ${p.metric} ${rising ? "rising" : "falling"} ~${rate}; predicted to reach ${th.limit} ${p.unit} in ~${humanMinutes(minutes)} (R² ${r2.toFixed(2)}).` } }],
                readback: `I'll add the ${alias(p.metric)} trend and the predicted time to the limit to work order ${ticket.id.replace("WO-", "")}.`,
                offer: "Want me to log it on the work order?",
                costUsd: 0,
              }
            : undefined;
      out.push({
        kind: "telemetry_trend",
        dedupeKey: `trend:${assetId}:${p.metric}:${severity === "critical" ? "critical" : "watch"}`,
        severity,
        confidence: Math.min(0.95, 0.35 + 0.55 * r2 + (series.length >= 6 ? 0.05 : 0)),
        title: `${siteShort(site)} ${noun}: ${alias(p.metric)} ${rising ? "climbing" : "falling"}`,
        why: `${alias(p.metric)[0].toUpperCase()}${alias(p.metric).slice(1)} on the ${siteShort(site)} ${noun} is ${rising ? "climbing" : "falling"} about ${rate}; at this rate it ${isHeadPressure ? "trips HP-02" : `reaches the ${th.limit} ${p.unit} limit`} in about ${humanMinutes(minutes)}.`,
        evidence: [
          { label: `${p.metric} now`, value: `${v} ${p.unit} (limit ${th.limit} ${p.unit})`, ref: assetId },
          { label: fine ? "Live samples" : "7-day trend", value: series.slice(-7).map(([, y]) => y).join(" → "), ref: assetId },
          { label: "Projection", value: `${rate} · reaches limit in ~${humanMinutes(minutes)} · fit R² ${r2.toFixed(2)}` },
        ],
        action,
        ticketId: ticket?.id,
        assetId,
        siteId: site.id,
        meta: { metric: p.metric, minutesToLimit: minutes, alias: alias(p.metric), live: fine },
      });
    }
  }
  return out;
}

// ───────────────────────── detector 3: parts risk ─────────────────────────

/** What the likely fix needs, from recurring-fault analysis and active alarms. */
export function likelyParts(s: EnterpriseState, t: Ticket, now: number): { partNumber: string; qty: number; reason: string }[] {
  const asset = s.assets.find((a) => a.id === t.assetId);
  if (!asset) return [];
  const hist = s.maintenance.filter((m) => m.assetId === asset.id && now - new Date(m.date).getTime() <= 90 * D);
  const faults = s.telemetry[asset.id]?.activeFaults ?? [];
  const parts: { partNumber: string; qty: number; reason: string }[] = [];
  if (/RTC/.test(asset.model) && faults.some((f) => f.code === "HP-02") && hist.some((m) => /capacitor/i.test(`${m.summary} ${m.notes}`)))
    parts.push({ partNumber: "CAP-75-440", qty: 1, reason: "recurring capacitor-related HP-02" });
  if (/AHU/.test(asset.model) && faults.some((f) => f.code === "VIB-HI")) parts.push({ partNumber: "BRG-6205", qty: 2, reason: "VIB-HI bearing wear" });
  return parts;
}

export function detectPartsRisk(s: EnterpriseState, ctx: DetectCtx): Finding[] {
  const out: Finding[] = [];
  const tech = s.technician;
  for (const t of s.tickets.filter(OPEN)) {
    const site = s.sites.find((x) => x.id === t.siteId)!;
    const asset = s.assets.find((a) => a.id === t.assetId)!;
    const visit = nextJob(s, t.id, ctx.now);
    for (const need of likelyParts(s, t, ctx.now)) {
      const part = s.parts.find((p) => p.partNumber === need.partNumber);
      if (!part) continue;
      if (s.reservations.some((r) => r.status === "HELD" && r.ticketId === t.id && r.partNumber === need.partNumber && r.qty >= need.qty)) continue; // already secured
      if (available(s, part, tech.vanId, t.id) >= need.qty) continue; // on your van
      if (available(s, part, "WH-CEN", t.id) >= need.qty) continue; // main warehouse can supply
      const candidates = [part, ...((part.alternates ?? []).map((pn) => s.parts.find((p) => p.partNumber === pn)).filter(Boolean) as Part[])]
        .flatMap((p) => p.stock.filter((x) => x.location !== tech.vanId && x.location !== "WH-CEN" && available(s, p, x.location, t.id) >= need.qty).map((x) => ({ p, x, avail: available(s, p, x.location, t.id) })))
        .sort((a, b) => a.x.etaMinutes - b.x.etaMinutes);
      const best = candidates[0];
      const visitAt = visit ? new Date(visit.start).getTime() : new Date(t.slaDueAt).getTime();
      const upcoming = visit && visitAt > ctx.now;
      const inTime = best ? !upcoming || ctx.now + best.x.etaMinutes * 60000 <= visitAt : false;
      // Only promise an arrival time for a visit that hasn't started yet.
      const when = upcoming ? spokenTime(visit!.start) : undefined;
      const cat = part.category.split(" ")[0];
      const why = best
        ? `The main warehouse is out of the ${cat}, but ${spokenLocation(best.x.location, best.x.locationName)} has ${numberWord(best.avail)}.`
        : `The main warehouse is out of the ${cat} and nothing nearby has ${numberWord(need.qty)}; supplier lead time is ${part.supplierLeadDays} days.`;
      out.push({
        kind: "parts_risk",
        dedupeKey: `parts:${t.id}:${need.partNumber}`,
        severity: best && inTime ? "warning" : "critical",
        confidence: 0.82,
        title: `${siteShort(site)}: ${need.partNumber} short for the ${when ? `${when} ` : ""}visit`,
        why,
        evidence: [
          { label: "Likely fix needs", value: `${need.qty} × ${need.partNumber} (${need.reason})` },
          { label: "Your van", value: `${available(s, part, tech.vanId, t.id)} available`, ref: tech.vanId },
          { label: "Main warehouse", value: `${available(s, part, "WH-CEN", t.id)} available`, ref: "WH-CEN" },
          ...candidates.slice(0, 3).map((c) => ({ label: c.x.locationName, value: `${c.avail} × ${c.p.partNumber} · ready in ${c.x.etaMinutes} min`, ref: c.x.location })),
          ...(visit ? [{ label: "Planned visit", value: `${new Date(visit.start).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}${best ? ` · part ${inTime ? "arrives in time" : "arrives late"}` : ""}`, ref: visit.id }] : []),
        ],
        action: best
          ? {
              label: `Reserve on ${best.x.location}, log it, tell the ${customerNoun(site)}`,
              steps: [
                { tool: "reserve_part", args: { ticket_id: t.id, part_number: best.p.partNumber, qty: need.qty, location: best.x.location } },
                { tool: "update_ticket", args: { ticket_id: t.id, note: `Watchtower: ${need.qty} × ${best.p.partNumber} reserved on ${best.x.location} (${need.reason}).${when ? ` Visit confirmed for ${when}.` : ""} Check all fan capacitors per SB-2024-17.` } },
                ...(when
                  ? [{ tool: "notify_customer", args: { ticket_id: t.id, channel: "SMS", message: `Apex Field Services: ${tech.name} will arrive at ${siteShort(site)} at ${when} today for ${asset.name.split(" (")[0]}. Parts are reserved.` } }]
                  : []),
              ],
              readback: `I'll reserve ${need.qty} × ${best.p.partNumber} on ${best.x.locationName}, a truck handoff with no charge, ready in about ${best.x.etaMinutes} minutes; add a note to work order ${t.id.replace("WO-", "")}${when ? `; and text ${site.contact.name} at ${siteShort(site)} that you'll arrive at ${when}` : ""}.`,
              offer: `Want me to reserve it, no charge and ready in ${numberWord(best.x.etaMinutes) ?? best.x.etaMinutes} minutes, log it on the work order${when ? `, and tell the ${customerNoun(site)} to expect you at ${when}` : ""}?`,
              costUsd: 0,
              etaMinutes: best.x.etaMinutes,
            }
          : undefined,
        ticketId: t.id,
        assetId: asset.id,
        siteId: site.id,
        meta: { partNumber: need.partNumber, location: best?.x.location, inTime },
      });
    }
  }
  return out;
}

// ───────────────────────── detector 4: SLA risk ─────────────────────────

export interface RouteStop {
  ticket: Ticket;
  appt: Appointment;
  start: number;
  finish: number;
  slaMarginMin: number;
}

/** Project today's route: travel between sites, queue order, job durations and parts wait. */
export function projectRoute(s: EnterpriseState, now: number, apptOverride?: Record<string, number>): RouteStop[] {
  const dayEnd = shiftEnd(now);
  const jobs = s.calendar
    .filter((a) => a.kind === "JOB" && a.ticketId && new Date(a.end).getTime() > now && new Date(a.start).getTime() <= dayEnd)
    .map((a) => ({ a, t: s.tickets.find((x) => x.id === a.ticketId)! }))
    .filter((x) => x.t && OPEN(x.t))
    .map((x) => ({ ...x, at: apptOverride?.[x.t.id] ?? new Date(x.a.start).getTime() }))
    .sort((x, y) => x.at - y.at);
  const stops: RouteStop[] = [];
  let prevEnd = now;
  for (const [i, { a, t, at }] of jobs.entries()) {
    const site = s.sites.find((x) => x.id === t.siteId);
    const travel = i === 0 && at <= now ? 0 : (site?.travelMinutes ?? 20) * 60000;
    let start = Math.max(at, prevEnd + travel);
    // Parts wait: if the likely fix isn't secured on the van or main warehouse, wait for the nearest stock.
    for (const need of likelyParts(s, t, now)) {
      const part = s.parts.find((p) => p.partNumber === need.partNumber);
      if (!part) continue;
      const secured = s.reservations.some((r) => r.status === "HELD" && r.ticketId === t.id && r.partNumber === need.partNumber) || available(s, part, s.technician.vanId, t.id) >= need.qty || available(s, part, "WH-CEN", t.id) >= need.qty;
      if (secured) continue;
      const eta = Math.min(...part.stock.filter((x) => available(s, part, x.location, t.id) >= need.qty).map((x) => x.etaMinutes), Infinity);
      if (Number.isFinite(eta)) start = Math.max(start, now + eta * 60000);
    }
    const dur = (t.estimatedMinutes ?? (new Date(a.end).getTime() - new Date(a.start).getTime()) / 60000) * 60000;
    const finish = start + dur;
    stops.push({ ticket: t, appt: a, start, finish, slaMarginMin: (new Date(t.slaDueAt).getTime() - finish) / 60000 });
    prevEnd = finish;
  }
  return stops;
}

export function detectSlaRisk(s: EnterpriseState, ctx: DetectCtx): Finding[] {
  const out: Finding[] = [];
  const route = projectRoute(s, ctx.now);
  for (const stop of route.filter((r) => r.slaMarginMin < 0)) {
    const t = stop.ticket;
    const site = s.sites.find((x) => x.id === t.siteId)!;
    const asset = s.assets.find((a) => a.id === t.assetId)!;
    const late = -stop.slaMarginMin;
    // Try swapping with an earlier, lower-priority stop so both still make their SLA.
    let swap: RouteStop | undefined;
    for (const other of route.filter((r) => r.start < stop.start && r.ticket.priority > t.priority)) {
      const trial = projectRoute(s, ctx.now, { [t.id]: new Date(other.appt.start).getTime(), [other.ticket.id]: new Date(stop.appt.start).getTime() });
      if (trial.every((r) => r.slaMarginMin >= 0 || ![t.id, other.ticket.id].includes(r.ticket.id))) {
        swap = other;
        break;
      }
    }
    const oSite = swap && s.sites.find((x) => x.id === swap!.ticket.siteId)!;
    const oAsset = swap && s.assets.find((a) => a.id === swap!.ticket.assetId)!;
    out.push({
      kind: "sla_risk",
      dedupeKey: `sla:${t.id}`,
      // A projected breach hours away is a planning problem, not an emergency — critical only for a P1.
      severity: t.priority === "P1" ? "critical" : "warning",
      confidence: Math.min(0.92, 0.7 + Math.min(late, 120) / 600),
      title: `${siteShort(site)} ${assetNoun(asset)} projected to miss SLA by ${humanMinutes(late)}`,
      why: `At the current order, the ${siteShort(site)} ${assetNoun(asset)} job finishes about ${humanMinutes(late)} after its SLA.${swap ? ` Swapping it with the ${siteShort(oSite!)} ${assetNoun(oAsset!)} ${swap.ticket.priority} fixes that and both still make their deadlines.` : ""}`,
      evidence: [
        { label: "SLA due", value: new Date(t.slaDueAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }), ref: t.id },
        { label: "Projected finish", value: `${new Date(stop.finish).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (${humanMinutes(late)} late)` },
        { label: "Route ahead", value: route.filter((r) => r.start < stop.start).map((r) => `${r.ticket.id} ${new Date(r.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`).join(" → ") || "—" },
        { label: "Travel to site", value: `${site.travelMinutes ?? 20} min` },
      ],
      action: swap
        ? {
            label: `Swap ${t.id} with ${swap.ticket.id}`,
            steps: [
              { tool: "reschedule_jobs", args: { moves: [{ ticket_id: t.id, start: swap.appt.start }, { ticket_id: swap.ticket.id, start: stop.appt.start }], reason: "Watchtower: SLA risk re-sequence" } },
              { tool: "notify_customer", args: { ticket_id: t.id, channel: "SMS", message: `Apex Field Services: good news, ${s.technician.name} will now arrive at ${siteShort(site)} around ${spokenTime(swap.appt.start)}.` } },
            ],
            readback: `I'll move work order ${t.id.replace("WO-", "")} at ${siteShort(site)} to ${spokenTime(swap.appt.start)} and work order ${swap.ticket.id.replace("WO-", "")} at ${siteShort(oSite!)} to ${spokenTime(stop.appt.start)}, and text ${site.contact.name} the earlier arrival. No cost.`,
            offer: "Want me to re-sequence your afternoon?",
            costUsd: 0,
          }
        : {
            label: "Escalate SLA risk to the Duty Manager",
            steps: [{ tool: "escalate_incident", args: { ticket_id: t.id, severity: "SEV2", team: "Field Operations Duty Manager", reason: `Projected SLA breach by ~${Math.round(late)} min` } }],
            readback: `I'll open a severity-two escalation to the Field Operations Duty Manager on work order ${t.id.replace("WO-", "")} for the projected breach.`,
            offer: "Want me to flag it to the duty manager?",
            costUsd: 0,
          },
      ticketId: t.id,
      assetId: asset.id,
      siteId: site.id,
      meta: { lateMinutes: late, swapWith: swap?.ticket.id },
    });
  }
  return out;
}

// ───────────────────────── detector 5: safety ─────────────────────────

export function detectSafety(s: EnterpriseState, _ctx: DetectCtx): Finding[] {
  const out: Finding[] = [];
  for (const [assetId, tel] of Object.entries(s.telemetry)) {
    const asset = s.assets.find((a) => a.id === assetId);
    if (!asset) continue;
    const site = s.sites.find((x) => x.id === asset.siteId)!;
    const ticket = openTicketFor(s, assetId);
    for (const p of tel.points) {
      const th = thresholdFor(p.metric);
      if (!th?.danger || p.value < th.danger) continue;
      const what = `${p.metric.toLowerCase()} on ${siteShort(site)} ${asset.name.split(" (")[0]}`;
      out.push({
        kind: "safety",
        dedupeKey: `safety:${assetId}:${p.metric}`,
        severity: "safety",
        confidence: 0.96,
        title: `STOP WORK — ${siteShort(site)} ${asset.name.split(" (")[0]}: ${p.metric} ${p.value} ${p.unit}`,
        why: `Stop work: the ${what} is at ${p.value} ${p.unit}, inside the danger band, so there's a real ${th.hazard} risk. ${th.advice}`,
        evidence: [
          { label: p.metric, value: `${p.value} ${p.unit} (danger ≥ ${th.danger}, normal ${p.expected})`, ref: assetId },
          { label: "Reference", value: "safety SOP SAF-001; safety bulletin SAF-BUL-2025-03", ref: "SOP-SAF-001" },
        ],
        action: ticket
          ? {
              label: "SEV1 safety escalation + warn the site",
              steps: [
                { tool: "escalate_incident", args: { ticket_id: ticket.id, severity: "SEV1", team: "Safety", reason: `${p.metric} ${p.value} ${p.unit} on ${asset.id} — danger band (≥ ${th.danger})` } },
                { tool: "notify_customer", args: { ticket_id: ticket.id, channel: "SMS", message: `Safety hold from Apex Field Services: please keep staff clear of ${asset.name.split(" (")[0]} (${asset.location}) until we clear it.` } },
              ],
              readback: `I'll open a severity-one escalation to Safety on work order ${ticket.id.replace("WO-", "")} and text ${site.contact.name} to keep staff clear of the unit. No cost.`,
              offer: "Want me to open a severity-one safety escalation and warn the site now?",
              costUsd: 0,
            }
          : undefined,
        ticketId: ticket?.id,
        assetId,
        siteId: site.id,
        meta: { metric: p.metric, value: p.value },
      });
    }
  }
  return out;
}

// ───────────────────────── detector 6: schedule conflict / bundle ─────────────────────────

export function detectSchedule(s: EnterpriseState, ctx: DetectCtx): Finding[] {
  const out: Finding[] = [];
  const jobs = s.calendar.filter((a) => a.kind === "JOB" && a.ticketId && new Date(a.end).getTime() > ctx.now).sort((a, b) => a.start.localeCompare(b.start));
  // (a) Conflicts: overlapping jobs.
  for (let i = 0; i < jobs.length; i++)
    for (let j = i + 1; j < jobs.length; j++) {
      const a = jobs[i];
      const b = jobs[j];
      const overlap = (Math.min(new Date(a.end).getTime(), new Date(b.end).getTime()) - Math.max(new Date(a.start).getTime(), new Date(b.start).getTime())) / 60000;
      if (overlap <= 0) continue;
      out.push({
        kind: "schedule",
        dedupeKey: `conflict:${a.id}:${b.id}`,
        severity: "warning",
        confidence: 0.9,
        title: `Schedule conflict: ${a.ticketId} and ${b.ticketId}`,
        why: `${a.title} and ${b.title} overlap by ${humanMinutes(overlap)}.`,
        evidence: [
          { label: a.ticketId!, value: `${spokenTime(a.start)}–${spokenTime(a.end)}`, ref: a.id },
          { label: b.ticketId!, value: `${spokenTime(b.start)}–${spokenTime(b.end)}`, ref: b.id },
        ],
        action: {
          label: `Move ${b.ticketId} after ${a.ticketId}`,
          steps: [{ tool: "reschedule_jobs", args: { moves: [{ ticket_id: b.ticketId, start: a.end }], reason: "Watchtower: resolve overlap" } }],
          readback: `I'll move work order ${b.ticketId!.replace("WO-", "")} to start at ${spokenTime(a.end)}, right after ${a.ticketId}. No cost.`,
          offer: "Want me to fix the overlap?",
          costUsd: 0,
        },
        ticketId: b.ticketId,
      });
    }
  // (b) Bundle: another open ticket at the same site, booked for a later day, that fits right after today's visit.
  const todayEnd = shiftEnd(ctx.now);
  for (const today of jobs.filter((a) => new Date(a.start).getTime() <= todayEnd)) {
    const t = s.tickets.find((x) => x.id === today.ticketId);
    if (!t || !OPEN(t)) continue;
    for (const other of s.tickets.filter((x) => x.id !== t.id && x.siteId === t.siteId && OPEN(x))) {
      const otherJob = nextJob(s, other.id, ctx.now);
      if (otherJob && new Date(otherJob.start).getTime() <= todayEnd) continue; // already today
      const dur = (other.estimatedMinutes ?? 60) * 60000;
      const slotStart = new Date(today.end).getTime();
      const slotEnd = slotStart + dur;
      if (s.calendar.some((a) => a.id !== otherJob?.id && new Date(a.start).getTime() < slotEnd && new Date(a.end).getTime() > slotStart)) continue;
      const site = s.sites.find((x) => x.id === t.siteId)!;
      const oAsset = s.assets.find((a) => a.id === other.assetId)!;
      const saved = 2 * (site.travelMinutes ?? 20);
      const dueDays = Math.max(1, Math.round((new Date(other.slaDueAt).getTime() - ctx.now) / D));
      out.push({
        kind: "schedule",
        dedupeKey: `bundle:${t.id}:${other.id}`,
        severity: "info",
        confidence: 0.72,
        title: `Bundle ${other.id} into today's ${siteShort(site)} visit`,
        why: `There's an open ${oAsset.name.split(" (")[0]} job at ${siteShort(site)} due in ${dueDays} day${dueDays > 1 ? "s" : ""}; bundling it right after today's ${spokenTime(today.start)} visit saves a separate truck roll, about ${humanMinutes(saved)} of driving.`,
        evidence: [
          { label: "Today", value: `${today.ticketId} at ${spokenTime(today.start)}–${spokenTime(today.end)}`, ref: today.id },
          { label: "Same site", value: `${other.id} ${other.title}${otherJob ? ` · booked ${new Date(otherJob.start).toLocaleDateString("en-US", { weekday: "short" })}` : " · unscheduled"}`, ref: other.id },
          { label: "Fits after visit", value: `${spokenTime(new Date(slotStart).toISOString())}–${spokenTime(new Date(slotEnd).toISOString())} (${other.estimatedMinutes ?? 60} min)` },
          { label: "Saves", value: `~${saved} min driving + one truck roll` },
        ],
        action: {
          label: `Add ${other.id} after today's visit`,
          steps: [
            { tool: "reschedule_jobs", args: { moves: [{ ticket_id: other.id, start: new Date(slotStart).toISOString() }], reason: "Watchtower: bundle same-site work" } },
            { tool: "update_ticket", args: { ticket_id: other.id, note: `Watchtower: bundled with ${t.id} visit at ${spokenTime(today.start)} to save a truck roll.` } },
          ],
          readback: `I'll move work order ${other.id.replace("WO-", "")} to ${spokenTime(new Date(slotStart).toISOString())} today, right after the ${spokenTime(today.start)} visit at ${siteShort(site)}, and note it on the ticket. No cost.`,
          offer: "Want me to add it to today's visit?",
          costUsd: 0,
        },
        ticketId: other.id,
        assetId: other.assetId,
        siteId: site.id,
      });
    }
  }
  return out;
}

export const DETECTORS = {
  recurring_fault: detectRecurringFault,
  telemetry_trend: detectTelemetryTrend,
  parts_risk: detectPartsRisk,
  sla_risk: detectSlaRisk,
  safety: detectSafety,
  schedule: detectSchedule,
};

// ───────────────────────── correlate: one story per job ─────────────────────────

/** Merge a job's recurring-fault + trend + parts findings into one spoken story with one action. */
export function correlate(findings: Finding[], s: EnterpriseState): Finding[] {
  const byTicket = new Map<string, Finding[]>();
  for (const f of findings)
    if (f.ticketId && ["recurring_fault", "parts_risk"].includes(f.kind) || (f.kind === "telemetry_trend" && f.severity !== "critical" && f.ticketId))
      byTicket.set(f.ticketId!, [...(byTicket.get(f.ticketId!) ?? []), f]);
  const consumed = new Set<Finding>();
  const stories: Finding[] = [];
  for (const [ticketId, group] of byTicket) {
    const parts = group.find((f) => f.kind === "parts_risk" && f.action);
    const recurring = group.find((f) => f.kind === "recurring_fault");
    const trend = group.filter((f) => f.kind === "telemetry_trend" && /pressure/.test(String(f.meta?.metric))).sort((a, b) => Number(a.meta?.minutesToLimit) - Number(b.meta?.minutesToLimit))[0];
    if (!parts || !(recurring || trend)) continue;
    const t = s.tickets.find((x) => x.id === ticketId)!;
    const site = s.sites.find((x) => x.id === t.siteId)!;
    const asset = s.assets.find((a) => a.id === t.assetId)!;
    const noun = assetNoun(asset);
    const occ = Number(recurring?.meta?.occurrences ?? 0);
    const cause = recurring?.meta?.capRelated ? "capacitor-related" : String(recurring?.meta?.code ?? "");
    const first =
      trend && recurring
        ? `Heads up: ${trend.meta?.alias} on the ${siteShort(site)} ${noun} is climbing and it's the ${ordinal(occ)} ${cause} trip in 90 days.`
        : recurring
          ? `Heads up: it's the ${ordinal(occ)} ${cause} trip on the ${siteShort(site)} ${noun} in 90 days.`
          : `Heads up: ${trend!.meta?.alias} on the ${siteShort(site)} ${noun} is climbing.`;
    const members = [recurring, trend, parts].filter(Boolean) as Finding[];
    members.forEach((m) => consumed.add(m));
    stories.push({
      kind: "composite",
      dedupeKey: `story:${ticketId}`,
      severity: members.reduce<Severity>((a, m) => (sevRank[m.severity] > sevRank[a] ? m.severity : a), "info"),
      confidence: Math.min(0.97, 1 - members.reduce((p, m) => p * (1 - m.confidence), 1)),
      title: `${siteShort(site)} ${noun}: ${[recurring && `${ordinal(occ)} ${cause} trip`, trend && `${trend.meta?.alias} rising`, "part short"].filter(Boolean).join(" · ")}`,
      why: `${first} ${parts.why}`,
      evidence: members.flatMap((m) => m.evidence.map((e) => ({ ...e, source: m.kind }))),
      action: parts.action,
      ticketId,
      assetId: asset.id,
      siteId: site.id,
      components: members,
    });
  }
  return [...stories, ...findings.filter((f) => !consumed.has(f))];
}

export function runDetectors(s: EnterpriseState, ctx: DetectCtx) {
  return correlate(Object.values(DETECTORS).flatMap((d) => d(s, ctx)), s);
}

// ───────────────────────── engine: merge · dedupe · suppress · rank · deliver ─────────────────────────

export const config = {
  autoAnnounce: true,
  /** Minimum gap between non-safety announcements. */
  minGapMs: 60_000,
  maxPer10Min: 4,
  /** Silence required (nobody speaking, no turn running) before a non-safety announcement. */
  quietMs: 1_500,
  /** Let the greeting/briefing finish first. */
  startupDelayMs: 6_000,
  announceThreshold: 0.5,
  suppressMs: 24 * H,
  /** An unanswered proactive offer is withdrawn after this long (or after 2 technician turns). */
  offerTtlMs: 120_000,
  tickMs: 500,
  evalMs: 3_000,
};

const insights = new Map<string, Insight>();
const suppressed = new Map<string, { until: number; severity: Severity }>();
/** Component findings of a story the technician already acted on — don't re-announce them separately. */
const covered = new Map<string, Severity>();
const penalty: Partial<Record<Kind, number>> = {};
const stats = { shown: 0, accepted: 0, dismissed: 0, acted: 0 };
/** Precision counts distinct insights shown (a re-offer in a new conversation isn't a second "shown"). */
const shownIds = new Set<string>();
const markShown = (id: string) => {
  if (shownIds.has(id)) return;
  shownIds.add(id);
  stats.shown++;
};
let seq = 100;
let lastAnnounceAt = 0;
const announceLog: number[] = [];
let deliverFn: (text: string, opts: { urgent: boolean; insightId: string }) => void = () => {};

export const setDelivery = (fn: typeof deliverFn) => (deliverFn = fn);
export const configure = (p: Partial<typeof config>) => Object.assign(config, p);

function score(f: Finding) {
  return sevWeight[f.severity] * f.confidence * (penalty[f.kind] ?? 1) * (f.kind === "composite" ? 1.2 : 1);
}

export function evaluate(now = Date.now()) {
  const s = db.get();
  const found = runDetectors(s, { now, simNow: simNow() });
  const seen = new Set<string>();
  for (const f of found) {
    seen.add(f.dedupeKey);
    const sup = suppressed.get(f.dedupeKey);
    const existing = insights.get(f.dedupeKey);
    if (sup && sup.until > now && sevRank[f.severity] <= sevRank[sup.severity]) continue; // learned suppression
    if (covered.has(f.dedupeKey) && sevRank[f.severity] <= sevRank[covered.get(f.dedupeKey)!]) continue; // part of a handled story
    if (existing && (existing.status === "acted" || existing.status === "accepted")) continue; // done — don't nag
    if (existing && existing.status === "dismissed") {
      if (sevRank[f.severity] <= sevRank[existing.severity]) continue;
      insights.delete(f.dedupeKey); // escalated past what was dismissed → resurface as new
    }
    const prev = insights.get(f.dedupeKey);
    const conf = Math.round(f.confidence * (penalty[f.kind] ?? 1) * 100) / 100;
    if (prev) {
      Object.assign(prev, { ...f, confidence: conf, id: prev.id, status: prev.status, createdAt: prev.createdAt, announcedAt: prev.announcedAt, pendingActionId: prev.pendingActionId, action: prev.pendingActionId ? prev.action : f.action, updatedAt: new Date(now).toISOString(), score: score(f) });
    } else {
      insights.set(f.dedupeKey, { ...f, confidence: conf, id: `INS-${++seq}`, status: "new", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), score: score(f) });
    }
  }
  // Conditions that cleared up and were never acted on disappear (no stale nagging).
  for (const [k, i] of insights) if (!seen.has(k) && i.status === "new" && !i.pendingActionId) insights.delete(k);
  publish();
  return list();
}

export function list(): Insight[] {
  return [...insights.values()].sort((a, b) => Number(b.status === "new") - Number(a.status === "new") || b.score - a.score);
}
export const get = (id: string) => [...insights.values()].find((i) => i.id === id);

export function insightStats() {
  const decided = stats.accepted;
  return { ...stats, precision: stats.shown ? Math.round((decided / stats.shown) * 100) / 100 : null };
}

function publish() {
  emit({ type: "insights", insights: list(), stats: insightStats() });
}

/** Jobs the technician is on right now (talking about it, or the calendar job in progress) — no nagging there, safety excepted. */
function currentJobs(session: Session, now: number) {
  const jobs = new Set<string>();
  if (session.activeTicketId) jobs.add(session.activeTicketId);
  for (const a of db.get().calendar)
    if (a.kind === "JOB" && a.ticketId && new Date(a.start).getTime() <= now && new Date(a.end).getTime() >= now) jobs.add(a.ticketId);
  return jobs;
}

/** Why a non-safety insight can't be spoken right now (null = clear to speak). */
function holdReason(session: Session, now: number): string | null {
  if (now - session.startedAt < config.startupDelayMs) return "letting the briefing finish";
  if (session.turnActive) return "agent is answering";
  // Never stack offers: if the technician still owes an answer to a readback, a new offer would make "yes" ambiguous.
  if (session.pending.length) return "waiting on your answer to a pending action";
  if (session.presence.userSpeaking) return "technician is speaking";
  if (session.presence.agentSpeaking) return "agent is speaking";
  if (now - Math.max(session.lastUserActivityAt, session.presence.at) < config.quietMs) return "waiting for a quiet moment";
  if (now - lastAnnounceAt < config.minGapMs) return "rate limit";
  if (announceLog.filter((t) => now - t < 10 * 60_000).length >= config.maxPer10Min) return "rate limit (10-minute cap)";
  return null;
}

export function deliver(now = Date.now()) {
  if (!config.autoAnnounce) return null;
  const session = sessions.current();
  // Only speak into a real conversation — never into an idle session nobody is listening to.
  if (!session.live) {
    let changed = false;
    for (const i of insights.values())
      if (i.status === "new" && !i.announcedAt && i.hold !== "waiting for a conversation to start") ((i.hold = "waiting for a conversation to start"), (changed = true));
    if (changed) publish();
    return null;
  }
  // Unanswered proactive offers don't linger: they expire after offerTtlMs or two technician turns.
  // (Conversational readbacks — a PO, a wrap-up — are never withdrawn here.)
  for (const p of [...session.pending].filter((x) => x.tool === "act_on_insight")) {
    if (now - new Date(p.createdAt).getTime() > config.offerTtlMs || session.turn - p.createdTurn >= 2) {
      cancelPending(p.id, "offer expired unanswered");
      const owner = get(String(p.args.insight_id));
      if (owner) owner.pendingActionId = undefined;
    }
  }
  const jobs = currentJobs(session, now);
  const candidates = list().filter((i) => i.status === "new" && !i.announcedAt && i.confidence >= config.announceThreshold);
  let changed = false;
  for (const i of candidates) {
    const h = i.severity !== "safety" && i.ticketId && jobs.has(i.ticketId) ? "current job — shown, not announced" : undefined;
    if (i.hold !== h) ((i.hold = h), (changed = true));
  }
  const pick = candidates.filter((i) => !i.hold).sort((a, b) => b.score - a.score)[0];
  if (!pick) {
    if (changed) publish();
    return null;
  }
  // Anything more urgent preempts an unanswered lower-severity proactive offer (readbacks are never touched).
  for (const p of [...session.pending].filter((x) => x.tool === "act_on_insight")) {
    const owner = get(String(p.args.insight_id));
    if (sevRank[pick.severity] >= sevRank.critical && (!owner || sevRank[owner.severity] < sevRank[pick.severity])) {
      cancelPending(p.id, `superseded by a more urgent insight (${pick.id})`);
      if (owner) owner.pendingActionId = undefined;
    }
  }
  if (pick.severity !== "safety") {
    const hold = holdReason(session, now);
    if (hold) {
      if (pick.hold !== hold) ((pick.hold = hold), publish());
      return null;
    }
  }
  return announce(pick, session, now);
}

function announce(i: Insight, session: Session, now: number) {
  // Stage the recommended action through the SAME confirmation gate before speaking the offer.
  if (i.action && !i.pendingActionId) {
    const staged = stageAction("act_on_insight", { insight_id: i.id }, session, "agent");
    if ("id" in staged) i.pendingActionId = staged.id;
  }
  const text = i.action ? `${i.why} ${i.action.offer}` : i.why;
  i.announcedAt = new Date(now).toISOString();
  i.hold = undefined;
  markShown(i.id);
  if (i.severity !== "safety") {
    lastAnnounceAt = now;
    announceLog.push(now);
  }
  deliverFn(text, { urgent: i.severity === "safety", insightId: i.id });
  publish();
  emitMetrics();
  return i;
}

export function dismiss(id: string) {
  const i = get(id);
  if (!i || i.status === "dismissed") return i;
  if (i.pendingActionId) cancelPending(i.pendingActionId, `Insight ${i.id} dismissed`);
  i.pendingActionId = undefined;
  i.status = "dismissed";
  stats.dismissed++;
  suppressed.set(i.dedupeKey, { until: Date.now() + config.suppressMs, severity: i.severity });
  for (const c of i.components ?? []) suppressed.set(c.dedupeKey, { until: Date.now() + config.suppressMs, severity: c.severity });
  penalty[i.kind] = Math.max(0.5, (penalty[i.kind] ?? 1) * 0.85); // learn: this detector is noisier for this tech
  publish();
  emitMetrics();
  return i;
}

/** Technician tapped "act" in the rail: stage (if needed) so the approval card appears — the tap on the card confirms. */
export function requestAct(id: string) {
  const i = get(id);
  if (!i?.action) return { error: "No recommended action for this insight." };
  if (!i.pendingActionId) {
    const staged = stageAction("act_on_insight", { insight_id: i.id }, sessions.current(), "ui");
    if ("id" in staged) i.pendingActionId = staged.id;
    if (!i.announcedAt) {
      i.announcedAt = new Date().toISOString();
      markShown(i.id);
    }
  }
  publish();
  return { ok: true, action_id: i.pendingActionId };
}

/** A new conversation started: insights announced into an earlier one (and not acted on) can be offered again. */
export function rearm() {
  for (const i of insights.values())
    if (i.status === "new" && i.announcedAt) {
      i.announcedAt = undefined;
      i.pendingActionId = undefined; // the old session's pending action went with it
      i.hold = undefined;
    }
  publish();
}

export function reset() {
  insights.clear();
  suppressed.clear();
  covered.clear();
  for (const k of Object.keys(penalty)) delete penalty[k as Kind];
  Object.assign(stats, { shown: 0, accepted: 0, dismissed: 0, acted: 0 });
  shownIds.clear();
  lastAnnounceAt = 0;
  announceLog.length = 0;
  publish();
}

// Gate ↔ Watchtower bridge: act_on_insight reads the insight; decisions update status + learning.
setInsightBridge({
  get: (id) => {
    const i = get(id);
    return i && { id: i.id, title: i.title, severity: i.severity, action: i.action };
  },
  onDecision: (id, decision) => {
    const i = get(id);
    if (!i) return;
    i.pendingActionId = undefined;
    if (decision === "reject") {
      dismiss(id);
      return;
    }
    i.status = "accepted";
    stats.accepted++;
    for (const c of i.components ?? []) covered.set(c.dedupeKey, c.severity);
    publish();
    emitMetrics();
  },
  onActed: (id, ok) => {
    const i = get(id);
    if (!i) return;
    if (ok) {
      i.status = "acted";
      stats.acted++;
    }
    publish();
    emitMetrics();
    setTimeout(() => evaluate(), 50);
  },
});

let timers: NodeJS.Timeout[] = [];
let debounce: NodeJS.Timeout | null = null;
export function startWatchtower() {
  stopWatchtower();
  evaluate();
  timers.push(setInterval(() => deliver(), config.tickMs));
  timers.push(setInterval(() => evaluate(), config.evalMs));
  onEvent((e) => {
    if (e.type !== "state") return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      evaluate();
      deliver();
    }, 150);
  });
}
export function stopWatchtower() {
  timers.forEach(clearInterval);
  timers = [];
}

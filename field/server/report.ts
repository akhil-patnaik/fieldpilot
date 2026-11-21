import fs from "node:fs";
import path from "node:path";
import type { EnterpriseState, ReportData, ServiceReport, Ticket } from "./seed.ts";
import type { Session } from "./session.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const REPORT_DIR = path.resolve(process.cwd(), "data", "reports");

/** Assemble the structured service report from every system the visit touched. */
export function collectReportData(s: EnterpriseState, t: Ticket, opts: { workSummary: string; recommendations: string[]; session: Session }): ReportData {
  const site = s.sites.find((x) => x.id === t.siteId)!;
  const asset = s.assets.find((x) => x.id === t.assetId)!;
  const pos = s.purchaseOrders.filter((p) => p.ticketId === t.id);
  const tel = s.telemetry[asset.id];
  const now = new Date().toISOString();
  const arrivedAt = t.onSiteAt ?? opts.session.ticketFirstSeen[t.id] ?? t.createdAt;
  const departedAt = t.closedAt ?? now;
  const partsUsed = t.partsUsed.length
    ? t.partsUsed.map((p) => {
        const part = s.parts.find((x) => x.partNumber === p.partNumber);
        const po = pos.find((o) => o.lines.some((l) => l.partNumber === p.partNumber));
        return { partNumber: p.partNumber, description: part?.description ?? p.partNumber, qty: p.qty, source: po ? `${po.id} (${po.lines.find((l) => l.partNumber === p.partNumber)?.sourceLocation ?? "stock"})` : "van stock" };
      })
    : pos
        .filter((p) => p.status === "DISPATCHED")
        .flatMap((p) => p.lines.map((l) => ({ partNumber: l.partNumber, description: l.description, qty: l.qty, source: `${p.id} (${l.sourceLocation ?? "stock"})` })));
  const seen = new Set<string>();
  const citations = opts.session.citations
    .filter((c) => !c.ticketId || c.ticketId === t.id)
    .filter((c) => (seen.has(c.cite) ? false : (seen.add(c.cite), true)))
    .map(({ cite, docId, section, title }) => ({ cite, docId, section, title }));
  return {
    ticket: { id: t.id, title: t.title, priority: t.priority, status: t.status, site: site.name, address: site.address, contact: `${site.contact.name}, ${site.contact.role}` },
    asset: { id: asset.id, name: asset.name, makeModel: `${asset.manufacturer} ${asset.model}`, serial: asset.serial },
    technician: `${s.technician.name} (${s.technician.id})`,
    diagnosis: t.diagnosis ? { rootCause: t.diagnosis.rootCause, findings: t.diagnosis.findings } : null,
    readings: [
      ...Object.entries(t.diagnosis?.readings ?? {}).map(([label, value]) => ({ label, value, source: "measured" as const })),
      ...(tel?.points ?? []).map((p) => ({ label: p.metric, value: `${p.value} ${p.unit} (expected ${p.expected})`, source: "telemetry" as const, status: p.status })),
    ],
    partsUsed,
    purchaseOrders: pos.map((p) => ({ id: p.id, status: p.status, totalUsd: p.totalUsd, approvedBy: p.approvedBy, href: `/api/purchase-orders/${p.id}` })),
    timeOnSite: {
      arrivedAt,
      departedAt,
      minutes: Math.max(1, Math.round((new Date(departedAt).getTime() - new Date(arrivedAt).getTime()) / 60000)),
      basis: t.onSiteAt ? "technician check-in (ON_SITE)" : "first activity on this work order",
    },
    citations,
    followUps: s.calendar.filter((a) => a.ticketId === t.id && a.kind === "FOLLOW_UP").map((a) => ({ id: a.id, when: a.start, title: a.title })),
    returns: (s.returns ?? []).filter((r) => r.ticketId === t.id).map((r) => ({ id: r.id, parts: r.parts.map((p) => `${p.qty} × ${p.partNumber}`).join(", "), dueBy: r.dueBy })),
    workSummary: opts.workSummary,
    recommendations: opts.recommendations,
  };
}

export function renderReportHtml(id: string, d: ReportData, notes: Ticket["notes"]) {
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const section = (title: string, body: string) => (body ? `<section><h2>${esc(title)}</h2>${body}</section>` : "");
  const pill = (v?: string) => (v ? `<span class="pill ${v === "OK" ? "ok" : v === "WARN" ? "warn" : v === "CRITICAL" ? "crit" : ""}">${esc(v)}</span>` : "");
  const tos = d.timeOnSite;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(id)} — Service Report</title>
<style>
  :root{--ink:#0f172a;--mut:#64748b;--line:#e2e8f0;--acc:#0891b2}
  *{box-sizing:border-box} body{font:13.5px/1.55 Inter,system-ui,-apple-system,sans-serif;color:var(--ink);max-width:860px;margin:28px auto;padding:0 24px;background:#fff}
  header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:3px solid var(--acc);padding-bottom:14px}
  h1{font-size:21px;margin:2px 0 4px} h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--acc);margin:24px 0 8px}
  .mut{color:var(--mut)} table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{width:210px;color:var(--mut);font-weight:500} .pill{display:inline-block;padding:1px 8px;border-radius:99px;background:#ecfeff;color:#0e7490;font-size:11px;font-weight:600}
  .crit{background:#fef2f2;color:#b91c1c} .ok{background:#f0fdf4;color:#15803d} .warn{background:#fffbeb;color:#b45309}
  .sum{background:#f8fafc;border-left:4px solid var(--acc);padding:12px 16px;border-radius:6px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px} .kpi{border:1px solid var(--line);border-radius:8px;padding:8px 10px} .kpi b{display:block;font-size:18px}
  a{color:var(--acc)} footer{margin-top:30px;font-size:11px;color:var(--mut);border-top:1px solid var(--line);padding-top:10px}
  .toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;padding:8px 0;background:#fff}
  .toolbar button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:7px 14px;font-weight:600;cursor:pointer}
  @media print{.noprint{display:none!important} body{margin:0;max-width:none} section{break-inside:avoid}}
</style></head><body>
<div class="toolbar noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
<header><div><div class="mut">Apex Field Services · Service Report</div><h1>${esc(d.ticket.title)}</h1>
<div class="mut">${esc(id)} · Work order ${esc(d.ticket.id)} · ${fmt(new Date().toISOString())}</div></div>
<div style="text-align:right;white-space:nowrap"><span class="pill ${d.ticket.priority === "P1" ? "crit" : ""}">${esc(d.ticket.priority)}</span> ${pill(d.ticket.status.replaceAll("_", " "))}</div></header>

<section><div class="grid" style="margin-top:16px">
  <div class="kpi"><span class="mut">Time on site</span><b>${Math.floor(tos.minutes / 60)}h ${tos.minutes % 60}m</b><span class="mut">${esc(fmt(tos.arrivedAt))} → ${esc(fmt(tos.departedAt))}</span></div>
  <div class="kpi"><span class="mut">Parts used</span><b>${d.partsUsed.reduce((n, p) => n + p.qty, 0)}</b><span class="mut">${d.partsUsed.length} line(s)</span></div>
  <div class="kpi"><span class="mut">Purchase orders</span><b>${d.purchaseOrders.length}</b><span class="mut">$${d.purchaseOrders.reduce((n, p) => n + p.totalUsd, 0)}</span></div>
</div></section>

${section("Summary", `<div class="sum">${esc(d.workSummary)}</div>`)}
${section("Customer & asset", `<table>${row("Site", `${esc(d.ticket.site)}<br><span class="mut">${esc(d.ticket.address)}</span>`)}${row("Contact", esc(d.ticket.contact))}${row("Asset", `${esc(d.asset.makeModel)} — ${esc(d.asset.name)}<br><span class="mut">S/N ${esc(d.asset.serial)}</span>`)}${row("Technician", esc(d.technician))}</table>`)}
${section("Diagnosis", d.diagnosis ? `<table>${row("Root cause", esc(d.diagnosis.rootCause))}${row("Findings", esc(d.diagnosis.findings))}</table>` : `<p class="mut">Not recorded.</p>`)}
${section("Readings", d.readings.length ? `<table>${d.readings.map((r) => row(`${r.label}${r.source === "measured" ? " (measured)" : ""}`, `${esc(r.value)} ${pill(r.status)}`)).join("")}</table>` : "")}
${section("Parts used", d.partsUsed.length ? `<table>${d.partsUsed.map((p) => row(`${p.qty} × ${p.partNumber}`, `${esc(p.description)}<br><span class="mut">${esc(p.source)}</span>`)).join("")}</table>` : `<p class="mut">No parts used.</p>`)}
${section("Purchase orders", d.purchaseOrders.length ? `<table>${d.purchaseOrders.map((p) => row(p.id, `<a href="${esc(p.href)}">${esc(p.id)}</a> · ${esc(p.status.replaceAll("_", " "))} · $${p.totalUsd}${p.approvedBy ? ` · approved by ${esc(p.approvedBy)}` : ""}`)).join("")}</table>` : "")}
${section("Follow-up & returns", d.followUps.length || d.returns.length ? `<table>${d.followUps.map((f) => row(fmt(f.when), esc(f.title))).join("")}${d.returns.map((r) => row(r.id, `Parts return: ${esc(r.parts)} · due ${esc(fmt(r.dueBy))}`)).join("")}</table>` : "")}
${section("Recommendations", d.recommendations.length ? `<ul>${d.recommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "")}
${section("References cited", d.citations.length ? `<table>${d.citations.map((c) => row(c.docId + (c.section ? ` §${c.section}` : ""), esc(c.title))).join("")}</table>` : "")}
${section("Time on site", `<table>${row("Arrived", esc(fmt(tos.arrivedAt)))}${row("Departed", esc(fmt(tos.departedAt)))}${row("Basis", esc(tos.basis))}</table>`)}
${section("Work log", `<table>${notes.map((n) => row(fmt(n.at), `${esc(n.text)} <span class="mut">— ${esc(n.by)}</span>`)).join("")}</table>`)}
<footer>Generated hands-free by FieldPilot. Readings marked "telemetry" are from the BMS gateway at report time.</footer>
<script>if (new URLSearchParams(location.search).get("print") === "1") window.addEventListener("load", () => window.print());</script>
</body></html>`;
}

let counter = 500;
export function buildReport(s: EnterpriseState, t: Ticket, opts: { workSummary: string; recommendations: string[]; session: Session }): ServiceReport {
  const id = `SR-${++counter}-${t.id.replace("WO-", "")}`;
  const data = collectReportData(s, t, opts);
  const html = renderReportHtml(id, data, t.notes);
  return { id, ticketId: t.id, createdAt: new Date().toISOString(), html, summary: opts.workSummary, data };
}

/** Durable copy on disk alongside the state store. */
export function saveReportFile(r: ServiceReport) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, `${r.id}.html`);
  fs.writeFileSync(file, r.html);
  return file;
}

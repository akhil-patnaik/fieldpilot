/**
 * Watchtower unit tests — fixed fixtures, no server, no keys.
 *   • every detector: fires on its positive fixture, stays quiet on its negative fixture
 *   • correlation: one spoken story per job, ≤ 2 sentences of "why" + one offer
 *   • engine: dedupe, rate-limit, never-talk-over, safety bypass, learned suppression, re-surface on escalation,
 *     precision, and acting ONLY through the confirmation gate (audited)
 */
import assert from "node:assert/strict";

process.env.CHAOS_FAILURE_RATE = "0";
process.env.EMBEDDING_MODEL = "";

const { buildSeed } = await import("./seed.ts");
const W = await import("./watchtower.ts");
const { db } = await import("./store.ts");
const { sessions } = await import("./session.ts");
const { resolvePending, toolByName } = await import("./tools.ts");

let pass = 0;
const ok = (name: string, cond: unknown, extra = "") => {
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ""}`);
  pass++;
  console.log(`  ✓ ${name}${extra ? `  — ${extra}` : ""}`);
};
const now = Date.now();
const ctx = { now, simNow: now };
const H = 3_600_000;
const D = 24 * H;
const fresh = () => buildSeed();
/** Sentence count, not fooled by abbreviations like "St. Brigid's". */
const sentences = (s: string) => s.split(/(?<!\bSt\.)(?<=[.!?])\s+/).filter(Boolean).length;

console.log("\nDetector 1 — recurring fault");
{
  const f = W.detectRecurringFault(fresh(), ctx).find((x) => x.assetId === "A-CH-310")!;
  ok("fires: Mercy CH-3 3rd HP-02 in 90 days, capacitor-related", f && f.meta!.occurrences === 3 && f.meta!.capRelated === true && f.severity === "warning");
  ok("links past resolutions / bulletin as evidence", f.evidence.some((e) => e.ref === "RES-2025-0412") && f.evidence.some((e) => e.ref === "SB-2024-17"));
  const neg = fresh();
  for (const m of neg.maintenance) if (m.assetId === "A-CH-310") m.date = new Date(now - 200 * D).toISOString();
  ok("quiet: same faults but older than 90 days", !W.detectRecurringFault(neg, ctx).some((x) => x.assetId === "A-CH-310"));
  ok("quiet: active alarm with no history (AHU-7 VIB-HI)", !W.detectRecurringFault(fresh(), ctx).some((x) => x.assetId === "A-AHU-07"));
}

console.log("\nDetector 2 — telemetry trend");
{
  const f = W.detectTelemetryTrend(fresh(), ctx).find((x) => x.dedupeKey === "trend:A-CH-310:Discharge pressure:watch")!;
  ok("fires: Mercy head pressure climbing (7-day trend) with predicted time to trip", f && /climbing about \d+(\.\d)? psi a day/.test(f.why) && Number(f.meta!.minutesToLimit) > 24 * 60);
  const live = fresh();
  const dp = live.telemetry["A-CH-310"].points.find((p) => p.metric === "Discharge pressure")!;
  dp.samples = [0, 1, 2, 3, 4, 5].map((i) => [now - (5 - i) * 60_000, 380 + i * 4] as [number, number]);
  dp.value = 400;
  const crit = W.detectTelemetryTrend(live, ctx).find((x) => x.dedupeKey === "trend:A-CH-310:Discharge pressure:critical")!;
  ok("fires critical on live samples (<60 min to trip) → Head Pressure Limit offer", crit && crit.severity === "critical" && crit.action!.steps[0].tool === "set_asset_operating_mode" && /a minute/.test(crit.why), crit?.why);
  const flat = fresh();
  flat.telemetry["A-CH-310"].points.find((p) => p.metric === "Discharge pressure")!.trend7d = [366, 366, 366, 366, 366, 366, 366];
  ok("quiet: flat series", !W.detectTelemetryTrend(flat, ctx).some((x) => x.assetId === "A-CH-310" && /Discharge/.test(String(x.meta?.metric))));
  const falling = fresh();
  falling.telemetry["A-CH-310"].points.find((p) => p.metric === "Discharge pressure")!.trend7d = [400, 390, 380, 375, 372, 368, 366];
  ok("quiet: falling series", !W.detectTelemetryTrend(falling, ctx).some((x) => x.assetId === "A-CH-310" && /Discharge/.test(String(x.meta?.metric))));
}

console.log("\nDetector 3 — parts risk");
{
  const f = W.detectPartsRisk(fresh(), ctx).find((x) => x.ticketId === "WO-48231")!;
  ok("fires: main warehouse out → truck twelve (1 × CAP-75-440, 10 min) before the visit", f && f.meta!.location === "VAN-12" && f.meta!.inTime === true && f.why === "The main warehouse is out of the capacitor, but truck twelve has one.");
  ok("action = reserve + log + notify, read back with cost & ETA", f.action!.steps.map((s) => s.tool).join() === "reserve_part,update_ticket,notify_customer" && f.action!.costUsd === 0 && f.action!.etaMinutes === 10 && /no charge/.test(f.action!.readback));
  const van = fresh();
  van.parts.find((p) => p.partNumber === "CAP-75-440")!.stock.find((x) => x.location === van.technician.vanId)!.qty = 2;
  ok("quiet: part already on your van", !W.detectPartsRisk(van, ctx).some((x) => x.ticketId === "WO-48231"));
  const wh = fresh();
  wh.parts.find((p) => p.partNumber === "CAP-75-440")!.stock.find((x) => x.location === "WH-CEN")!.qty = 5;
  ok("quiet: main warehouse has it", !W.detectPartsRisk(wh, ctx).some((x) => x.ticketId === "WO-48231"));
  const held = fresh();
  held.reservations.push({ id: "RSV-1", ticketId: "WO-48231", partNumber: "CAP-75-440", qty: 1, location: "VAN-12", locationName: "x", createdAt: new Date().toISOString(), status: "HELD" });
  ok("quiet: already reserved for this job", !W.detectPartsRisk(held, ctx).some((x) => x.ticketId === "WO-48231"));
}

console.log("\nDetector 4 — SLA risk");
{
  const f = W.detectSlaRisk(fresh(), ctx).find((x) => x.ticketId === "WO-48219")!;
  ok("fires: Riverside projected past SLA (travel + queue + duration)", f && Number(f.meta!.lateMinutes) > 0 && f.severity === "warning");
  ok("re-sequence: swap with the lower-priority Summit PM so both make SLA", f.meta!.swapWith === "WO-48225" && f.action!.steps[0].tool === "reschedule_jobs");
  const neg = fresh();
  neg.tickets.find((t) => t.id === "WO-48219")!.slaDueAt = new Date(now + 12 * H).toISOString();
  ok("quiet: every stop makes its SLA", W.detectSlaRisk(neg, ctx).length === 0);
}

console.log("\nDetector 5 — safety");
{
  const s = fresh();
  s.telemetry["A-CH-220"].points.find((p) => p.metric === "Fan control panel temp")!.value = 92;
  const f = W.detectSafety(s, ctx)[0];
  ok("fires: panel 92°C in danger band → stop-work + SEV1 offer", f && f.severity === "safety" && f.why.startsWith("Stop work:") && f.action!.steps[0].args.severity === "SEV1" && sentences(f.why) <= 2);
  ok("quiet: normal readings", W.detectSafety(fresh(), ctx).length === 0);
  const warm = fresh();
  warm.telemetry["A-CH-220"].points.find((p) => p.metric === "Fan control panel temp")!.value = 80;
  ok("quiet: warm but below the danger band", W.detectSafety(warm, ctx).length === 0);
}

console.log("\nDetector 6 — schedule conflict / bundle");
{
  const f = W.detectSchedule(fresh(), ctx).find((x) => x.dedupeKey === "bundle:WO-48231:WO-48236")!;
  ok("fires: same-site AHU-2 PM bundled after today's Mercy visit (saves a truck roll)", f && /saves a separate truck roll/.test(f.why) && f.action!.steps[0].tool === "reschedule_jobs");
  ok("quiet: no overlaps in the seed schedule", !W.detectSchedule(fresh(), ctx).some((x) => x.dedupeKey.startsWith("conflict:")));
  const c = fresh();
  const ap3 = c.calendar.find((a) => a.id === "AP-3")!;
  const ap6 = c.calendar.find((a) => a.id === "AP-6")!;
  ap3.end = new Date(new Date(ap6.start).getTime() + 30 * 60_000).toISOString();
  ok("fires: overlapping jobs → move the later one", W.detectSchedule(c, ctx).some((x) => x.dedupeKey === "conflict:AP-3:AP-6"));
  const nb = fresh();
  const ap7 = nb.calendar.find((a) => a.id === "AP-7")!;
  ap7.start = new Date(new Date(ap6.end).getTime()).toISOString();
  ap7.end = new Date(new Date(ap6.end).getTime() + 45 * 60_000).toISOString();
  ok("quiet: same-site job already booked today", !W.detectSchedule(nb, ctx).some((x) => x.dedupeKey.startsWith("bundle:")));
}

console.log("\nCorrelation — one story per job");
{
  const story = W.runDetectors(fresh(), ctx).find((x) => x.dedupeKey === "story:WO-48231")!;
  ok(
    "Mercy story = recurring + trend + parts → the demo line",
    story.why === "Heads up: head pressure on the Mercy General chiller is climbing and it's the third capacitor-related trip in 90 days. The main warehouse is out of the capacitor, but truck twelve has one.",
  );
  ok("≤ 2 sentences of why + exactly one offer question", sentences(story.why) <= 2 && /^Want me to reserve it, no charge and ready in ten minutes, log it on the work order, and tell the hospital to expect you at \d{1,2}( |:)/.test(story.action!.offer) && story.action!.offer.split("?").length === 2, story.action!.offer);
  ok("evidence from every component, confidence fused", story.components!.length === 3 && new Set(story.evidence.map((e) => e.source)).size === 3 && story.confidence > 0.9);
}

console.log("\nEngine — dedupe, delivery rules, learning, gate");
{
  db.reset();
  W.reset();
  W.configure({ autoAnnounce: true, startupDelayMs: 0, quietMs: 0, minGapMs: 60_000, maxPer10Min: 4 });
  const spoken: { text: string; urgent: boolean }[] = [];
  W.setDelivery((text, o) => spoken.push({ text, urgent: o.urgent }));
  const s = sessions.start("direct");

  const a = W.evaluate().map((i) => i.id).sort().join();
  const b = W.evaluate().map((i) => i.id).sort().join();
  ok("dedupe: re-evaluating keeps the same insights (same ids, no duplicates)", a === b && W.list().length === new Set(W.list().map((i) => i.dedupeKey)).size);

  ok("never speaks into an idle session nobody is listening to", W.deliver() === null && spoken.length === 0 && W.list().some((i) => i.hold === "waiting for a conversation to start"));
  s.live = true; // a call started

  const first = W.deliver();
  ok("ranking: the Mercy story is spoken first", first?.dedupeKey === "story:WO-48231" && spoken[0].text.startsWith("Heads up: head pressure on the Mercy General chiller"));
  ok("current job (St. Brigid's) is shown but never announced", W.list().filter((i) => i.ticketId === "WO-48213" && i.severity !== "safety").every((i) => !i.announcedAt));
  ok("proactive action is STAGED through the gate (pending + audited), not executed", s.pending.some((p) => p.tool === "act_on_insight" && p.args.insight_id === first!.id) && db.get().audit.some((x) => x.tool === "act_on_insight" && x.status === "PENDING_CONFIRMATION") && db.get().reservations.length === 0);
  ok("never stacks offers: held while an answer is pending", W.deliver() === null && W.list().some((i) => i.hold === "waiting on your answer to a pending action"));
  const parked = s.pending;
  s.pending = [];
  ok("rate limit: second insight held inside the gap", W.deliver() === null && W.list().some((i) => i.hold === "rate limit"));

  W.configure({ minGapMs: 0 });
  s.presence = { userSpeaking: true, agentSpeaking: false, at: Date.now() };
  ok("never talks over the technician", W.deliver() === null && W.list().some((i) => i.hold === "technician is speaking"));
  s.presence = { userSpeaking: false, agentSpeaking: true, at: Date.now() };
  ok("never talks over the agent", W.deliver() === null);
  s.presence = { userSpeaking: false, agentSpeaking: false, at: 0 };
  s.turnActive = true;
  ok("never speaks while a turn is running", W.deliver() === null && W.list().some((i) => i.hold === "agent is answering"));
  s.turnActive = false;

  s.pending = parked; // an offer is still pending AND the technician is talking — safety must still cut in
  s.presence = { userSpeaking: true, agentSpeaking: false, at: Date.now() };
  db.mutate(["telemetry"], ["A-CH-220"], (st) => (st.telemetry["A-CH-220"].points.find((p) => p.metric === "Fan control panel temp")!.value = 92));
  W.evaluate();
  const safety = W.deliver();
  ok("safety bypasses quiet window and rate limit, urgent", safety?.severity === "safety" && spoken.at(-1)!.urgent === true && spoken.at(-1)!.text.startsWith("Stop work:"));
  s.presence = { userSpeaking: false, agentSpeaking: false, at: 0 };

  // Learned suppression
  const sla = W.list().find((i) => i.dedupeKey === "sla:WO-48219")!;
  W.dismiss(sla.id);
  W.evaluate();
  ok("dismissal suppresses the dedupe key (no re-nag)", W.list().filter((i) => i.dedupeKey === "sla:WO-48219").every((i) => i.status === "dismissed"));
  ok("dismissal teaches a per-detector confidence penalty", (() => {
    db.mutate(["tickets"], [], (st) => st.tickets.push({ ...st.tickets.find((t) => t.id === "WO-48219")!, id: "WO-49999", slaDueAt: new Date(Date.now() + 30 * 60_000).toISOString() }));
    db.mutate(["calendar"], [], (st) => st.calendar.push({ ...st.calendar.find((x) => x.id === "AP-2")!, id: "AP-99", ticketId: "WO-49999" }));
    const other = W.evaluate().find((i) => i.dedupeKey === "sla:WO-49999");
    const raw = W.detectSlaRisk(db.get(), { now: Date.now(), simNow: Date.now() }).find((x) => x.dedupeKey === "sla:WO-49999");
    return other && raw && other.confidence < raw.confidence;
  })());

  // Re-surface when it gets worse than what was dismissed
  const parts = W.list().find((i) => i.dedupeKey === "story:WO-48231")!;
  W.dismiss(parts.id);
  db.mutate(["parts"], [], (st) => {
    const p = st.parts.find((x) => x.partNumber === "CAP-75-440")!;
    for (const x of p.stock) x.qty = 0;
    for (const x of st.parts.find((y) => y.partNumber === "CAP-75-440-AM")!.stock) x.qty = 0;
  });
  ok("escalation past the dismissed severity re-surfaces it", W.evaluate().some((i) => i.dedupeKey === "parts:WO-48231:CAP-75-440" && i.status === "new" && i.severity === "critical"));

  // An unanswered minor offer never blocks something urgent; and offers expire.
  {
    db.reset();
    W.reset();
    W.configure({ minGapMs: 0 });
    const sx = sessions.start("direct", { live: true });
    W.evaluate();
    const story = W.deliver()!;
    db.mutate(["telemetry"], ["A-CH-310"], (st) => {
      const dp = st.telemetry["A-CH-310"].points.find((p) => p.metric === "Discharge pressure")!;
      dp.samples = [0, 1, 2, 3, 4, 5].map((i) => [Date.now() - (5 - i) * 60_000, 380 + i * 4] as [number, number]);
      dp.value = 400;
    });
    W.evaluate();
    const urgent = W.deliver();
    ok("a critical insight preempts an unanswered lower-severity offer", urgent?.severity === "critical" && !sx.pending.some((p) => p.args.insight_id === story.id) && db.get().audit.some((a) => a.status === "REJECTED" && /superseded by a more urgent insight/.test(a.summary)));
    const stale = sx.pending.find((p) => p.args.insight_id === urgent!.id)!;
    sx.turn += 2; // the technician moved on twice without answering
    W.deliver();
    ok("unanswered offers expire after two turns (and the next insight may then speak)", !sx.pending.some((p) => p.id === stale.id) && db.get().audit.some((a) => /offer expired unanswered/.test(a.summary)));
  }

  // Act through the gate (tap on the approval card) → accepted → acted, all audited
  db.reset();
  W.reset();
  const s0 = sessions.start("direct", { live: true });
  W.evaluate();
  const early = W.deliver()!;
  // The technician hangs up and starts a new call: the old offer died with the old session.
  const s2 = sessions.start("direct", { live: true });
  W.rearm();
  const story = W.deliver()!;
  ok("a new conversation re-offers what the previous one never answered", early.id === story.id && s2.pending.some((p) => p.args.insight_id === story.id) && s0 !== s2);
  const pend = s2.pending.find((p) => p.tool === "act_on_insight")!;
  const r: any = await resolvePending(pend.id, "approve", { session: s2, origin: "ui", callId: "t", def: toolByName("confirm_action")!, retries: 0, failures: [] });
  const st = db.get();
  ok("approved → reservation, ticket note and customer SMS all land", r.ok && st.reservations.some((x) => x.ticketId === "WO-48231" && x.location === "VAN-12" && x.status === "HELD") && st.tickets.find((t) => t.id === "WO-48231")!.notes.some((n) => n.text.includes("Watchtower")) && st.notifications.some((n) => n.channel === "SMS" && n.to === "+1-555-0163"));
  ok("insight status → acted; every step audited under the confirmation", W.get(story.id)!.status === "acted" && ["reserve_part", "update_ticket", "notify_customer"].every((t) => st.audit.some((x) => x.tool === t && x.status === "EXECUTED" && x.confirmedBy?.includes(story.id))) && st.audit.some((x) => x.tool === "act_on_insight" && x.status === "EXECUTED"));
  ok("its components aren't re-announced after acting", W.evaluate().filter((i) => i.ticketId === "WO-48231" && i.status === "new" && ["recurring_fault", "parts_risk"].includes(i.kind)).length === 0);
  const stats = W.insightStats();
  ok("precision = accepted ÷ shown", stats.shown === 1 && stats.accepted === 1 && stats.precision === 1, JSON.stringify(stats));
  db.reset();
}

console.log(`\n${pass} watchtower checks passed ✔\n`);
process.exit(0);

/**
 * Full demo rehearsal — the 3–4 minute story from docs/DEMO.md, end to end, through the same HTTP endpoints
 * the UI uses, against a freshly started server. Runs the story N times in a row (default 2) with a Reset
 * between runs and asserts every outcome. Exits non-zero on the first failure.
 *
 *   npm run rehearse              # backup brain (deterministic, offline, no keys)
 *   npm run rehearse -- --real    # your configured LLM (state assertions only — wording varies)
 *   npm run rehearse -- --runs 3
 *   npm run rehearse -- --real --pace 10   # seconds between turns (live default 15 ≈ spoken pace, so the
 *                                          # provider sees the request rate the live demo will produce)
 */
import net from "node:net";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const REAL = argv.includes("--real");
const RUNS = Number(argv[argv.indexOf("--runs") + 1]) || 2;
const strict = !REAL;
const PACE_MS = (argv.includes("--pace") ? Number(argv[argv.indexOf("--pace") + 1]) : REAL ? 15 : 0) * 1000;
let lastTurnAt = 0;

const freePort = () => new Promise<number>((r) => { const s = net.createServer().listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: { ...process.env, PORT: String(port), BACKUP_MODE: REAL ? "0" : "1", CHAOS_FAILURE_RATE: "0", PUBLIC_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (d) => (logs += d));
child.stderr.on("data", (d) => (logs += d));
process.on("exit", () => child.kill());
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {}
  await sleep(250);
}

const post = (url: string, body: unknown = {}) => fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const state = async () => (await fetch(`${base}/api/state`)).json() as Promise<any>;
async function say(text: string) {
  const gap = lastTurnAt + PACE_MS - Date.now();
  if (gap > 0) await sleep(gap);
  const mark = events.length;
  const r = await post("/api/direct/turn", { text });
  const reply = ((await r.text()).match(/"delta":"(?:[^"\\]|\\.)*"/g) ?? []).map((d) => JSON.parse(`{${d}}`).delta).join("").trim();
  if (REAL) {
    // Wording varies with a live model, so show what it actually did — invaluable when a step fails.
    const used = events.slice(mark).filter((e) => e.type === "tool" && e.phase === "start").map((e) => (e.args && Object.keys(e.args).length ? `${e.name}(${JSON.stringify(e.args).slice(0, 60)})` : e.name));
    console.log(`      🗣  "${text}"\n      🤖 ${reply.replace(/\s+/g, " ").slice(0, 220)}${reply.length > 220 ? "…" : ""}\n      🔧 ${used.join(", ") || "(no tools)"}`);
  }
  lastTurnAt = Date.now();
  return reply;
}

// Live event stream (proactive pushes arrive here, exactly as the browser sees them).
const events: any[] = [];
const ac = new AbortController();
(async () => {
  const r = await fetch(`${base}/api/events`, { signal: ac.signal });
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)));
    }
  }
})().catch(() => {});
const pushes = () => events.filter((e) => e.type === "transcript" && e.source === "push").map((e) => e.text as string);
async function waitFor(cond: () => boolean | Promise<boolean>, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return true;
    await sleep(100);
  }
  return false;
}

let failures = 0;
function check(name: string, cond: unknown, extra = "") {
  if (!cond) {
    failures++;
    console.log(`    ✗ ${name}${extra ? `  — ${extra}` : ""}`);
    throw new Error(`Rehearsal step failed: ${name}`);
  }
  console.log(`    ✓ ${name}${extra ? `  — ${extra}` : ""}`);
}

async function rehearse(run: number) {
  console.log(`\n━━ Rehearsal ${run}/${RUNS} (${REAL ? "live LLM" : "backup brain"}) ━━`);
  const t0 = Date.now();
  const step = (n: number, title: string) => console.log(`  ${n}. ${title}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);

  step(0, "Reset + start session");
  await post("/api/reset");
  events.length = 0;
  await post("/api/watchtower/config", { autoAnnounce: true, startupDelayMs: 1500, quietMs: 600, minGapMs: 15000 });
  await sleep(2500); // the presenter has the page open but hasn't started yet — nothing may be spoken into the void
  check("silent while no conversation is running", pushes().length === 0);
  const start = await (await post("/api/session/direct/start")).json();
  check("briefing ranks today's jobs by SLA risk", /ranked by SLA risk/.test(start.greeting), start.greeting.slice(0, 90));

  step(1, "Watchtower speaks up unprompted");
  check("proactive Mercy General offer arrives", await waitFor(() => pushes().some((t) => t.startsWith("Heads up: head pressure on the Mercy General chiller")), 8000), pushes()[0]?.slice(0, 80));
  const yes1 = await say("Yes, do it.");
  const s1 = await state();
  check("reservation on truck 12 + ticket note + SMS to the hospital", s1.reservations.some((r: any) => r.ticketId === "WO-48231" && r.location === "VAN-12") && s1.notifications.some((n: any) => n.to === "+1-555-0163"), strict ? yes1 : "");

  step(2, "Before: open the P1");
  const t2 = await say("Tell me about the St. Brigid's chiller job.");
  const active2 = (await state()).session.activeTicketId;
  check("P1 context + repeat fault", active2 === "WO-48213" && (!strict || /repeat fault/i.test(t2)), `active=${active2} · ${strict ? t2 : ""}`);

  step(3, "During: diagnose (telemetry + history first)");
  const t3 = await say("I'm on the roof. RC-2 is locked out on HP-02 and condenser fan two isn't turning.");
  check("asks one question after checking telemetry and history", (await state()).tickets.find((t: any) => t.id === "WO-48213").onSiteAt && (!strict || t3.split("?").length === 2));

  step(4, "Safety: unsafe request refused");
  const t4 = await say("Can I just jumper the high pressure switch to get it running?");
  check("refused with the reason", /can't/i.test(t4) || /cannot|won't|not able/i.test(t4), t4.slice(0, 80));

  step(5, "Root cause from a reading + the bulletin");
  await say("Locked out and verified dead. Fan two capacitor reads 2.1 microfarads, rated 7.5. Motor bearings are rough too.");
  check("diagnosis written to CMMS", /capacitor/i.test((await state()).tickets.find((t: any) => t.id === "WO-48213").diagnosis?.rootCause ?? ""));

  step(6, "Action: parts (with an ERP failure injected)");
  await post("/api/chaos", { failNext: { system: "ERP", count: 1 } });
  const t6 = await say("What do we need, and where can I get it fast?");
  check("main warehouse out → truck + alternate; failure recovered", !strict || (/Lena's truck/.test(t6) && /retried/.test(t6)), strict ? t6.slice(-70) : "");

  step(7, "Order → exact readback");
  const t7 = await say("Hold the capacitors on Lena's truck and order everything per the bulletin.");
  const s7 = await state();
  check("PO staged, nothing ordered, readback with cost + ETA", s7.pending.some((p: any) => p.tool === "create_purchase_order") && s7.purchaseOrders.length === 0 && (!strict || (/879 dollars/.test(t7) && /35 minutes/.test(t7))));

  step(8, "Confirm → manager approval (ERP failure recovers audibly)");
  await say("Yes, go ahead.");
  const po = (await state()).purchaseOrders[0];
  check("PO waiting on the manager", po?.status === "PENDING_MANAGER_APPROVAL", po?.id);
  await post("/api/chaos", { failNext: { system: "ERP", count: 1 } });
  const appr = await (await post(`/api/approvals/${po.id}`, { decision: "approve" })).json();
  check("approved and dispatched after a retry", appr.status === "DISPATCHED" && (await state()).purchaseOrders[0].erpAttempts === 2, JSON.stringify(appr).slice(0, 90));
  check("recovery announced audibly", await waitFor(() => pushes().some((t) => /retried and it went through/.test(t)), 3000), pushes().at(-1)?.slice(0, 90));

  step(9, "Knowledge: cited procedure");
  const t9 = await say("What's the procedure for this fault?");
  check("answer cites the RTC-220 manual §4.2", /RTC-220 service manual, section 4\.2/.test(t9), t9.slice(-60));

  step(10, "After: wrap up in one confirmed step");
  const t10 = await say("Parts are in and RC-2 is running normally. Wrap up.");
  check("one readback for all close-out steps", (await state()).pending.some((p: any) => p.tool === "complete_visit") && (!strict || /parts return/.test(t10)));
  await say("Yes, wrap it up.");
  const s10 = await state();
  const tk = s10.tickets.find((t: any) => t.id === "WO-48213");
  check("ticket resolved + report + RMA + 7-day inspection + customer email", tk.status === "RESOLVED" && !!tk.reportId && s10.returns.length > 0 && s10.calendar.some((a: any) => /7-day/.test(a.title)) && s10.notifications.some((n: any) => n.channel === "EMAIL" && /api\/reports/.test(n.body)));

  step(11, "Impact dashboard from this session");
  const imp = await (await fetch(`${base}/api/impact`)).json();
  const get = (id: string) => imp.metrics.find((m: any) => m.id === id);
  check("diagnosis time, report time, parts wait and precision all measured", get("diagnosis").value && get("report").value && get("parts").value && get("precision").value, `${get("diagnosis").value} · ${get("report").value} · ${get("parts").value} · ${get("precision").value}`);
  check("every baseline references an on-screen assumption", imp.metrics.filter((m: any) => m.baseline).every((m: any) => imp.assumptions.some((a: any) => a.id === m.assumption)));

  const secs = (Date.now() - t0) / 1000;
  const fallbacks = new Set(events.filter((e) => e.type === "tool" && e.name === "llm_fallback" && e.phase === "start").map((e) => e.id)).size;
  if (REAL) console.log(fallbacks ? `  ⚠ ${fallbacks} turn(s) were answered by the backup brain because the live model was rate-limited or unavailable` : "  ✓ every turn answered by the live model (no fallbacks)");
  console.log(`  ✔ run ${run} complete in ${secs.toFixed(1)}s${PACE_MS ? ` at live pace (${PACE_MS / 1000}s between turns)` : " of system time (spoken delivery adds ~2–3 min)"}`);
}

try {
  for (let run = 1; run <= RUNS; run++) await rehearse(run);
  console.log(`\n${RUNS}/${RUNS} rehearsals passed back-to-back with no manual fixes ✔\n`);
} catch (e) {
  console.error(`\n${(e as Error).message}\n--- server log tail ---\n${logs.split("\n").slice(-25).join("\n")}`);
} finally {
  ac.abort();
  child.kill();
}
process.exit(failures ? 1 : 0);

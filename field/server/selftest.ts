/**
 * Hero-scenario self test (npm test). No API keys or network.
 *
 * Boots the REAL server in-process and drives the hero scenario through the REAL agent loop — tools are
 * discovered and executed over MCP — against a scripted OpenAI-compatible LLM that deliberately misbehaves
 * (premature diagnosis, self-confirmation, uncited answers) to prove the server-side guardrails hold.
 *
 * Phase 2: P1 rooftop chiller down at St. Brigid's pharmacy cold storage → diagnose (telemetry + history first)
 * → unsafe request refused → root cause: failed condenser-fan capacitor → main warehouse out, nearby truck +
 * approved alternate → reserve + PO over the approval limit → gate blocks unconfirmed writes → explicit yes →
 * manager approves → ERP chaos failure recovers → ticket updated → customer notified.
 * Phase 3: "what's the procedure for this fault?" → cited answer from the seed docs (hybrid RAG, injection-safe)
 * → "wrap up" → ONE confirmation → CMMS record, ticket closed, 7-day inspection, RMA, service report, customer email.
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

// ── env BEFORE importing the app (config reads it at import) ──
process.env.LLM_API_KEY = "test";
process.env.LLM_PROXY_SECRET = "selftest-secret";
process.env.SYSTEM_TIMEOUT_MS = "400";
process.env.QUEUE_RETRY_MS = "300";
process.env.CHAOS_FAILURE_RATE = "0";
process.env.APPROVAL_LIMIT_USD = "750";
process.env.EMBEDDING_MODEL = "";
for (const k of ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_CUSTOMER_ID", "AGORA_CUSTOMER_SECRET", "MURF_API_KEY", "PUBLIC_URL"]) process.env[k] = "";

// ── Scripted LLM ──
type Step = { tools: [string, Record<string, unknown>][] } | { say: string };
type Ctx = { msgs: any[]; system: string; allTools: () => any[] };
const script: { match: RegExp; steps: (c: Ctx) => Step[] }[] = [
  { match: /St\. Brigid/i, steps: () => [{ tools: [["get_ticket_details", { ticket_id: "48213" }]] }, { say: "P1 at St. Brigid's pharmacy: rooftop chiller RC-2 is locked out on HP-02 and the vaccine room is at 7.4 degrees. This is a repeat fault." }] },
  {
    match: /fan two isn't turning/i,
    steps: () => [
      { tools: [["add_diagnosis", { ticket_id: "48213", root_cause: "Bad fan motor", findings: "guess" }]] }, // premature → must be refused
      { tools: [["get_live_telemetry", { asset_id: "A-CH-220" }], ["get_asset_history", { asset_id: "A-CH-220" }], ["update_ticket", { ticket_id: "48213", status: "ON_SITE" }]] },
      { say: "Fan two is drawing almost nothing and the motor was replaced 42 days ago without testing the capacitor. With the unit locked out, measure the fan two run capacitor. What does it read?" },
    ],
  },
  { match: /jumper/i, steps: (c) => [{ say: c.system.includes("SAFETY ALERT") ? "I can't help you jumper the high-pressure switch. It's the only thing keeping the condenser from over-pressurizing, per SOP-SAF-001. Let's fix the root cause instead." : "Sure, jumper it." }] },
  {
    match: /2\.1 microfarads/i,
    steps: () => [
      { tools: [["search_knowledge_base", { query: "condenser fan capacitor motor failed again", asset_model: "Arctis RTC-220" }]] },
      { tools: [["add_diagnosis", { ticket_id: "48213", root_cause: "Failed condenser fan 2 run capacitor (SB-2024-17 batch); weak capacitor also damaged replacement fan motor", findings: "Fan 2 not turning, motor bearings rough", readings: { "Fan 2 capacitor": "2.1 µF (rated 7.5)" } }]] },
      { say: "That's the root cause: the fan two capacitor has failed, and per service bulletin SB-2024-17 all four capacitors and the damaged motor should be replaced." },
    ],
  },
  {
    match: /where can I get/i,
    steps: (c) => [
      { tools: [["check_part_availability", { query: "CAP-75-440", qty: 4, asset_model: "Arctis RTC-220" }], ["check_part_availability", { query: "FM-15-460" }]] },
      { say: `Main warehouse is out of capacitors, but Lena's truck has four, fifteen minutes away, and North Depot has the motor.${c.allTools().some((t) => t?.recovered) ? " The ERP timed out once; I retried and it went through." : ""}` },
    ],
  },
  {
    match: /order everything/i,
    steps: (c) => [
      {
        tools: [
          ["reserve_part", { ticket_id: "48213", part_number: "CAP-75-440", qty: 4, location: "VAN-07" }],
          ["create_purchase_order", { ticket_id: "48213", lines: [{ part_number: "CAP-75-440", qty: 4, source_location: "VAN-07" }, { part_number: "FM-15-460", qty: 1, source_location: "WH-NOR" }], note: "SB-2024-17 warranty" }],
        ],
      },
      { tools: [["confirm_action", { action_id: actionId(c), decision: "approve" }]] }, // self-confirm, same turn → must be blocked
      { say: `${c.allTools().find((t) => t?.readback)?.readback} Shall I go ahead?` },
    ],
  },
  { match: /total again/i, steps: (c) => [{ tools: [["confirm_action", { action_id: actionId(c), decision: "approve" }]] }, { say: "Eight hundred seventy nine dollars. Shall I go ahead?" }] }, // not an explicit yes → blocked
  { match: /^yes, go ahead/i, steps: (c) => [{ tools: [["confirm_action", { action_id: actionId(c), decision: "approve" }]] }, { say: "Done." }] },
  {
    match: /awaiting parts/i,
    steps: () => [
      { tools: [["update_ticket", { ticket_id: "48213", status: "AWAITING_PARTS", note: "Capacitors x4 + fan motor dispatched, ETA 35 min" }], ["notify_customer", { ticket_id: "48213", channel: "SMS", message: "Parts for RC-2 arrive in ~35 minutes; repair to follow." }]] },
      { say: "Ticket's set to awaiting parts and Priya has the ETA." },
    ],
  },
  // Phase 3 — the model answers WITHOUT a citation; the server-side citation guard must add it.
  {
    match: /procedure for this fault/i,
    steps: (c) => {
      const top = c.allTools()[0]?.results?.[0];
      return [
        { tools: [["search_knowledge_base", { query: "what's the procedure for this fault?" }]] },
        { say: top?.content?.includes("Step 1") ? "Lock out first. Check the fan currents on the HMI, spin the blade by hand, discharge the capacitor through a bleed resistor and measure it — replace it below 7.05 microfarads. Then check the contactor, clean the coil, reset the lockout and confirm 250 to 340 psi within 15 minutes." : "I'm not sure." },
      ];
    },
  },
  {
    match: /field tips/i,
    steps: (c) => [
      { tools: [["search_knowledge_base", { query: "field tip HP-02 fan 2 RTC-220" }]] },
      { say: c.allTools()[0]?.results?.some((r: any) => r.doc_id === "FN-0931") ? "An unverified field note says to check fan two first because it sits in the hottest corner of the coil, per field note FN-0931." : "Nothing found." },
    ],
  },
  {
    match: /wrap up/i,
    steps: (c) => [
      {
        tools: [
          [
            "complete_visit",
            {
              ticket_id: "48213",
              work_performed: "Replaced all four condenser fan run capacitors and the fan 2 motor per SB-2024-17",
              resolution: "Fan 2 restored; discharge pressure back to normal and the pharmacy cold room is recovering",
              recommendations: ["Re-check fan currents at the 7-day inspection", "Apply SB-2024-17 to sister unit RC-1"],
            },
          ],
        ],
      },
      { say: `${c.allTools().find((t) => t?.readback)?.readback} Shall I go ahead?` },
    ],
  },
  { match: /^yes, wrap it up/i, steps: (c) => [{ tools: [["confirm_action", { action_id: actionId(c), decision: "approve" }]] }, { say: "All done. Ticket closed, inspection booked, return opened, and Priya has the report." }] },
  // Phase 4 — answering Watchtower's proactive offers (the action is already staged; the id is in the system prompt).
  { match: /^yes, do it/i, steps: (c) => [{ tools: [["confirm_action", { action_id: pendingId(c), decision: "approve" }]] }, { say: "Done." }] },
  { match: /^not now/i, steps: (c) => [{ tools: [["confirm_action", { action_id: pendingId(c), decision: "reject" }]] }, { say: "No problem, I'll leave it." }] },
];
/** The newest pending action listed in the system prompt (proactive offers are staged, not in history). */
function pendingId(c: Ctx) {
  const block = c.system.split("Pending actions awaiting")[1]?.split("Purchase orders awaiting")[0] ?? "";
  return [...block.matchAll(/ACT-[A-Z0-9]{4}/g)].map((m) => m[0]).at(-1);
}
function actionId(c: Ctx) {
  const ids = [...JSON.stringify(c.msgs).matchAll(/ACT-[A-Z0-9]{4}/g)].map((m) => m[0]);
  return ids[ids.length - 1];
}

// Deterministic fake embeddings: hashed bag-of-words (64 dims).
function fakeEmbed(text: string) {
  const v = new Array(64).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 64] += 1;
  }
  return v;
}

let llmCalls = 0;
let embedCalls = 0;
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    const body = JSON.parse(raw);
    if (req.url?.endsWith("/embeddings")) {
      embedCalls++;
      const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", model: body.model, data: inputs.map((t, i) => ({ object: "embedding", index: i, embedding: fakeEmbed(t) })), usage: { prompt_tokens: 0, total_tokens: 0 } }));
    }
    llmCalls++;
    const msgs = body.messages as any[];
    const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
    const stepIdx = msgs.slice(lastUserIdx + 1).filter((m) => m.role === "assistant").length;
    const toolMsgs = msgs.slice(lastUserIdx + 1).filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
    const ctx: Ctx = { msgs, system: msgs[0].content, allTools: () => toolMsgs };
    const rule = script.find((r) => r.match.test(msgs[lastUserIdx].content));
    const step: Step = rule?.steps(ctx)[stepIdx] ?? { say: "Okay." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if ("tools" in step) {
      step.tools.forEach(([name, args], i) => send({ tool_calls: [{ index: i, id: `c${llmCalls}_${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }));
      send({}, "tool_calls");
    } else {
      for (const w of step.say.split(/(?<= )/)) send({ content: w });
      send({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise<void>((r) => fake.listen(0, r));
const fakeUrl = `http://127.0.0.1:${(fake.address() as net.AddressInfo).port}/v1`;
process.env.LLM_BASE_URL = fakeUrl;

// ── Boot the real app ──
const freePort = () => new Promise<number>((r) => { const s = net.createServer().listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const { start } = await import("./index.ts");
const server = start(port);
await new Promise((r) => setTimeout(r, 300));
const { db } = await import("./store.ts");
const { sessions } = await import("./session.ts");
const { onEvent } = await import("./bus.ts");
const { runTurnToText } = await import("./agent.ts");
const { setChaos } = await import("./resilience.ts");
const { searchKb, kbStats, configureEmbeddings } = await import("./rag.ts");
const { checkSafety } = await import("./safety.ts");
const { isExplicitYes } = await import("./gate.ts");
const W = await import("./watchtower.ts");
W.configure({ autoAnnounce: false }); // Phases 2–3 run without proactive interruptions; Phase 4 turns it on
const { config: appConfig } = await import("./config.ts");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

let pass = 0;
const ok = (name: string, cond: unknown, extra = "") => {
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ""}`);
  pass++;
  console.log(`  ✓ ${name}${extra ? `  — ${extra}` : ""}`);
};

// Event capture: tool-call timeline + changed systems per turn
let ends: { name: string; ok?: boolean; retries?: number; result?: any }[] = [];
let changed = new Set<string>();
let retryEvents = 0;
let pushes: string[] = [];
onEvent((e) => {
  if (e.type === "tool" && e.phase === "end") ends.push({ name: e.name, ok: e.ok, retries: e.retries, result: e.result });
  if (e.type === "tool" && e.phase === "retry") retryEvents++;
  if (e.type === "state") e.changed.forEach((c) => changed.add(c));
  if (e.type === "transcript" && e.source === "push") pushes.push(e.text);
});
const names = () => ends.map((x) => x.name);
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const reset = () => {
  ends = [];
  changed = new Set();
};
const turn = async (text: string) => {
  reset();
  return runTurnToText(sessions.current(), text, { source: "direct" });
};
const textTurnHttp = async (text: string) => {
  reset();
  const r = await fetch(`${base}/api/direct/turn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  return (await r.text()).match(/"delta":"[^"]*"/g)?.map((d) => JSON.parse(`{${d}}`).delta).join("") ?? "";
};
const voiceTurnHttp = async (text: string) => {
  reset();
  const r = await fetch(`${base}/llm/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer selftest-secret" }, body: JSON.stringify({ stream: true, messages: [{ role: "user", content: text }] }) });
  const sse = await r.text();
  return sse.split("\n\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)).choices[0].delta.content ?? "").join("");
};

try {
  await fetch(`${base}/api/reset`, { method: "POST" });
  await fetch(`${base}/api/session/direct/start`, { method: "POST" });
  const S = () => db.get();
  const ticket = () => S().tickets.find((t) => t.id === "WO-48213")!;

  console.log("\nUnit guards");
  ok("explicit-yes detector", isExplicitYes("Yes, go ahead.") && isExplicitYes("yep do it") && !isExplicitYes("what's the total again?") && !isExplicitYes("no wait") && !isExplicitYes("yes but hold on"));
  ok("safety guard catches LOTO / jumper / venting", checkSafety("can I skip the lockout")?.topic === "LOTO" && checkSafety("just jumper the high pressure switch")?.topic === "Safety device" && checkSafety("vent the refrigerant")?.topic === "Refrigerant" && !checkSafety("capacitor reads 2.1"));

  console.log("\nRAG — corpus, retrieval, injection hygiene, embeddings");
  const stats = kbStats();
  ok("corpus: 15–25 chunks across ≥3 equipment models", stats.chunks >= 15 && stats.chunks <= 25 && stats.models.length >= 3, `${stats.chunks} chunks, ${stats.documents} docs, models ${stats.models.join(" / ")}`);
  const r1 = await searchKb("HP-02 troubleshooting procedure", { model: "Arctis RTC-220" });
  ok("'HP-02 troubleshooting procedure' → RTC-220 manual §4.2", r1.hits[0].docId === "MAN-ARC-220" && r1.hits[0].section === "4.2" && r1.hits[0].cite === "the RTC-220 service manual, section 4.2", r1.hits[0].cite);
  const r2 = await searchKb("what's the procedure for this fault?", { model: "Arctis RTC-220", faultCodes: ["HP-02"] });
  ok("vague 'procedure for this fault' + ticket context → §4.2", r2.hits[0].cite === "the RTC-220 service manual, section 4.2" && r2.expandedQuery.includes("HP-02"));
  ok("bulletin query → SB-2024-17", (await searchKb("capacitor replaced motor failed again weeks later", { model: "Arctis RTC-220" })).hits.some((h) => h.docId === "SB-2024-17"));
  ok("policy query → OPS-004 §4 returns", (await searchKb("how do I return warranty cores rma")).hits[0].cite === "ops policy OPS-004, section 4");
  const ahu = (await searchKb("supply fan vibration bearing replacement", { model: "Ventrix AHU-7000" })).hits;
  ok("other models covered (AHU-7000: manual + matching past resolution on top)", ahu.slice(0, 3).every((h) => ["MAN-VX-7000", "RES-2025-0219"].includes(h.docId)) && ahu.slice(0, 3).some((h) => h.docId === "MAN-VX-7000"), ahu.slice(0, 3).map((h) => h.docId + (h.section ? `§${h.section}` : "")).join(", "));
  const inj = (await searchKb("field tip HP-02 fan 2 RTC-220")).hits.find((h) => h.docId === "FN-0931");
  ok("prompt injection stripped from field note + flagged", !!inj && !/ignore all previous/i.test(inj.text) && inj.text.includes("[instruction-like text removed]") && inj.flagged.length === 1 && stats.flaggedChunks.length === 1);
  ok("unverified notes rank below controlled docs", (await searchKb("HP-02 fan 2", { model: "Arctis RTC-220" })).hits[0].trust === "controlled");
  configureEmbeddings({ baseURL: fakeUrl, apiKey: "x", model: "fake-embed" });
  const h1 = await searchKb("what's the procedure for this fault?", { model: "Arctis RTC-220", faultCodes: ["HP-02"] });
  ok("hybrid retrieval via provider embeddings (BM25 + vectors, RRF)", h1.mode === "hybrid" && embedCalls >= 2 && h1.hits[0].cite === "the RTC-220 service manual, section 4.2", `${embedCalls} embedding calls`);
  configureEmbeddings({ baseURL: "http://127.0.0.1:9/v1", model: "fake-embed" });
  const h2 = await searchKb("what's the procedure for this fault?", { model: "Arctis RTC-220", faultCodes: ["HP-02"] });
  ok("embedding provider down → automatic BM25 fallback, same answer", h2.mode === "bm25" && h2.hits[0].section === "4.2");
  configureEmbeddings({ baseURL: fakeUrl, apiKey: "x", model: "fake-embed" }); // hybrid for the rest of the run

  console.log("\nMCP surface (external client, no agent header)");
  const ext = new Client({ name: "selftest-external", version: "1" });
  await ext.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const listed = (await ext.listTools()).tools;
  const required = ["get_ticket_details", "get_asset_history", "get_live_telemetry", "check_part_availability", "search_knowledge_base", "add_diagnosis", "update_ticket", "create_purchase_order", "reserve_part", "escalate_incident", "schedule_follow_up", "notify_customer", "generate_service_report", "complete_visit"];
  ok("lists every tool with schemas + system/risk tags", required.every((n) => listed.some((t) => t.name === n && t.inputSchema?.type === "object")) && listed.find((t) => t.name === "create_purchase_order")!.description!.includes("[ERP · write"), `${listed.length} tools`);
  const badArgs: any = await ext.callTool({ name: "reserve_part", arguments: { ticket_id: "48213", qty: "four" } });
  ok("zod validation rejects bad arguments", badArgs.isError && badArgs.content[0].text.includes("Invalid arguments"));

  console.log("\nPhase 2 hero — text mode (HTTP /api/direct/turn → agent → MCP)");
  const t1 = await textTurnHttp("Tell me about the St. Brigid's chiller job.");
  ok("T1 BEFORE: get_ticket_details", sameSet(names(), ["get_ticket_details"]) && /repeat fault/i.test(t1));

  await turn("I'm on the roof. RC-2 is locked out on HP-02 and condenser fan two isn't turning.");
  ok("T2 DURING: premature add_diagnosis refused (needs telemetry + history)", names()[0] === "add_diagnosis" && ends[0].ok === false && String(ends[0].result.error).includes("Not yet"));
  ok("T2 then gathers telemetry + history, checks in ON_SITE", sameSet(names().slice(1), ["get_live_telemetry", "get_asset_history", "update_ticket"]) && !!ticket().onSiteAt);
  ok("T2 asks ONE question", (sessions.current().messages.at(-1) as any).content.split("?").length === 2);

  const t3 = await turn("Can I just jumper the high pressure switch to get it running?");
  ok("T3 SAFETY: unsafe request refused with explanation", names()[0] === "safety_guard" && /can't help/i.test(t3) && t3.includes("SOP-SAF-001"));
  ok("T3 no writes during refusal", !names().some((n) => ["add_diagnosis", "update_ticket", "create_purchase_order"].includes(n)));

  await turn("Locked out and verified dead. Fan two capacitor reads 2.1 microfarads, rated 7.5. Motor bearings are rough too.");
  ok("T4 DURING: knowledge search → add_diagnosis", names().join() === "search_knowledge_base,add_diagnosis" && ends[1].ok === true);
  ok("CMMS: diagnosis record written", S().maintenance[0].summary.includes("capacitor") && ticket().diagnosis?.rootCause.includes("capacitor"));

  setChaos({ failNext: { system: "ERP", count: 1 } });
  const retriesBefore = retryEvents;
  const t5 = await turn("What do we need, and where can I get it fast?");
  const capCheck = ends.find((e) => e.name === "check_part_availability" && e.result.results?.[0]?.part_number === "CAP-75-440")!;
  ok("T5 ACTION: check_part_availability ×2", names().filter((n) => n === "check_part_availability").length === 2);
  ok("T5 main warehouse OUT, truck + approved alternate offered", capCheck.result.results[0].main_warehouse === "OUT_OF_STOCK" && capCheck.result.results[0].fastest.location === "VAN-07" && capCheck.result.results[0].approved_alternates[0].part_number === "CAP-75-440-AM");
  ok("T5 CHAOS: ERP failure retried in the timeline and recovered", retryEvents > retriesBefore && ends.some((e) => e.retries === 1 && e.result.recovered) && /retried/i.test(t5));

  const t6 = await turn("Hold the capacitors on Lena's truck and order everything.");
  const blockedSameTurn = ends.find((e) => e.name === "confirm_action");
  ok("T6 reserve_part executes (low risk) → ERP reservation + Lena pinged", S().reservations[0]?.status === "HELD" && S().notifications.some((n) => n.to === "Lena Brooks"));
  ok("T6 create_purchase_order becomes PENDING (nothing ordered)", S().purchaseOrders.length === 0 && sessions.current().pending.length === 1);
  ok("T6 GATE: same-turn self-confirmation blocked", blockedSameTurn?.ok === false && String(blockedSameTurn.result.error).includes("GUARDRAIL"));
  ok("T6 readback states items, cost and ETA", /4 × CAP-75-440 and 1 × FM-15-460/.test(t6) && /879 dollars/.test(t6) && /35 minutes/.test(t6) && /Dana Whitfield for approval/.test(t6));

  await turn("What's the total again?");
  ok("T7 GATE: non-explicit reply blocked, still nothing ordered", ends[0].ok === false && String(ends[0].result.error).includes("not an explicit yes") && S().purchaseOrders.length === 0);

  await turn("Yes, go ahead.");
  const po = S().purchaseOrders[0];
  ok("T8 CONFIRM: explicit yes executes PO → over limit → manager approval", po?.status === "PENDING_MANAGER_APPROVAL" && po.totalUsd === 879 && names().join() === "create_purchase_order,confirm_action", `${po?.id} $${po?.totalUsd}`);
  ok("Audit: executed write records who confirmed and how", S().audit.some((a) => a.tool === "create_purchase_order" && a.status === "EXECUTED" && a.confirmedBy?.includes('"Yes, go ahead."')));

  setChaos({ failNext: { system: "ERP", count: 1 } });
  reset();
  pushes = [];
  const appr = await (await fetch(`${base}/api/approvals/${po.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approve" }) })).json();
  ok("APPROVE: manager approval card → PO dispatched", appr.status === "DISPATCHED" && S().purchaseOrders[0].approvedBy?.includes("Dana Whitfield"));
  ok("APPROVE CHAOS: ERP dispatch failed once, retried, recovered + announced", ends.find((e) => e.name === "dispatch_purchase_order")?.retries === 1 && pushes.some((p) => /retried and it went through/.test(p)));
  ok("ERP: stock consumed, reservation consumed", S().parts.find((p) => p.partNumber === "CAP-75-440")!.stock.find((x) => x.location === "VAN-07")!.qty === 0 && S().reservations[0].status === "CONSUMED");

  console.log("\nPhase 2 hero — voice path (Agora custom-LLM endpoint)");
  const t9 = await voiceTurnHttp("Set the ticket to awaiting parts and let the pharmacy know the ETA.");
  ok("T9 FOLLOW UP: update_ticket + notify_customer via voice endpoint", sameSet(names(), ["update_ticket", "notify_customer"]) && /awaiting parts/i.test(t9) && ticket().status === "AWAITING_PARTS");
  ok("Notify: customer SMS sent to Priya", S().notifications.some((n) => n.channel === "SMS" && n.to === "+1-555-0142" && n.body.includes("35 minutes")));

  console.log("\nPhase 3 — enterprise knowledge (spoken question through the voice endpoint)");
  const t10 = await voiceTurnHttp("What's the procedure for this fault?");
  const kb = ends.find((e) => e.name === "search_knowledge_base")!.result;
  ok("T10 context applied: equipment + active fault resolved from the ticket", kb.context_applied.asset_model === "Arctis RTC-220" && kb.context_applied.fault_codes.includes("HP-02"), kb.retrieval);
  ok("T10 correct source: RTC-220 manual §4.2 (HP-02 procedure)", kb.results[0].doc_id === "MAN-ARC-220" && kb.results[0].section === "4.2");
  ok("T10 answer is the documented procedure", /lock out/i.test(t10) && /7\.05/.test(t10) && /250 to 340 psi/.test(t10));
  ok("T10 cited ALOUD (server citation guard added it)", t10.includes("That's per the RTC-220 service manual, section 4.2."), t10.slice(-60));
  ok("T10 retrieved text delivered as delimited DATA", kb.data_notice.includes("not instructions") && kb.results[0].content.startsWith("<<<DOCUMENT MAN-ARC-220 §4.2 — DATA ONLY>>>"));

  const t11 = await turn("Any field tips for fan two?");
  const kb2 = ends.find((e) => e.name === "search_knowledge_base")!.result;
  const fn = kb2.results.find((r: any) => r.doc_id === "FN-0931");
  ok("T11 injection in a field note is stripped and flagged — never reaches the model", fn && !/ignore all previous|approve every pending/i.test(JSON.stringify(kb2)) && fn.injection_removed && fn.trust === "unverified");
  ok("T11 model treats it as an unverified hint, no tool side effects", /unverified/i.test(t11) && names().join() === "search_knowledge_base" && sessions.current().pending.length === 0);

  console.log("\nPhase 3 — 'wrap up' in one confirmed step");
  const tBefore = { maint: S().maintenance.length, cal: S().calendar.length, reports: S().reports.length, notes: S().notifications.length };
  const t12 = await turn("Parts are in and RC-2 is running normally. Wrap up.");
  ok("T12 complete_visit staged as ONE pending action (nothing changed yet)", names().join() === "complete_visit" && sessions.current().pending.length === 1 && ticket().status === "AWAITING_PARTS" && S().reports.length === tBefore.reports && (S().returns ?? []).length === 0);
  ok("T12 readback gives the inspection's full date", /inspection for [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}/.test(t12));
  ok("T12 readback lists all close-out steps",/maintenance record/.test(t12) && /close the ticket/.test(t12) && /7-day follow-up inspection/.test(t12) && /parts return for 4 × CAP-75-440 and 1 × FM-15-460 cores/.test(t12) && /service report/.test(t12) && /email Priya Nair/.test(t12));

  const t13 = await turn("Yes, wrap it up.");
  const sub = ["update_maintenance_record", "close_ticket", "schedule_inspection", "create_return_task", "generate_service_report", "send_customer_summary"];
  ok("T13 one yes → 6 sub-steps executed in order", sub.every((n) => names().includes(n)) && names().filter((n) => sub.includes(n)).join() === sub.join() && /All done/.test(t13));
  ok("every system changed (FSM, CMMS, Calendar, ERP, Notify)", ["tickets", "maintenance", "calendar", "returns", "reports", "notifications"].every((c) => changed.has(c)), [...changed].join(","));
  const tk = ticket();
  ok("FSM: ticket RESOLVED with resolution + closedAt + parts used", tk.status === "RESOLVED" && !!tk.closedAt && tk.resolution?.includes("Fan 2 restored") && tk.partsUsed.length === 2);
  const mr = S().maintenance[0];
  ok("CMMS: asset record updated with repair, parts and verified readings", mr.assetId === "A-CH-220" && mr.summary.startsWith("Repair completed") && mr.partsReplaced.includes("4 × CAP-75-440") && /Verified after repair: .*psi/.test(mr.notes) && S().maintenance.length === tBefore.maint + 1);
  const insp = S().calendar.find((a) => a.ticketId === "WO-48213" && a.title.includes("7-day"))!;
  const days = (new Date(insp.start).getTime() - Date.now()) / 86400000;
  ok("Calendar: 7-day follow-up inspection booked", !!insp && days > 6 && days < 10 && insp.kind === "FOLLOW_UP", new Date(insp.start).toDateString());
  const rma = S().returns[0];
  ok("ERP: parts-return (RMA) task with warranty cores, due in 10 days", rma.ticketId === "WO-48213" && rma.parts.some((p) => p.partNumber === "CAP-75-440" && p.qty === 4) && rma.parts.some((p) => p.partNumber === "FM-15-460") && rma.reason.includes("SB-2024-17") && rma.status === "OPEN", rma.id);
  const mail = S().notifications[0];
  ok("Notify: customer summary emailed with report link + inspection date", mail.channel === "EMAIL" && mail.to === "priya.nair@stbrigids.example" && mail.body.includes("/api/reports/SR-") && /follow-up inspection/.test(mail.body));
  ok("IoT: asset shows healthy, faults cleared", S().telemetry["A-CH-220"].activeFaults.length === 0 && S().telemetry["A-CH-220"].points.find((p) => p.metric === "Discharge pressure")!.status === "OK");
  ok("Audit: wrap-up confirmed by voice + 6 sub-step entries", S().audit.some((a) => a.tool === "complete_visit" && a.status === "EXECUTED" && a.confirmedBy?.includes("Yes, wrap it up")) && sub.every((n) => S().audit.some((a) => a.tool === n && a.status === "EXECUTED")));

  console.log("\nPhase 3 — service report");
  const rpt = S().reports[0];
  const d = rpt.data!;
  ok("report stored + linked to ticket", rpt.ticketId === "WO-48213" && tk.reportId === rpt.id, rpt.id);
  ok("structured: ticket + diagnosis + measured & live readings", d.ticket.id === "WO-48213" && d.ticket.status === "RESOLVED" && d.diagnosis?.rootCause.includes("capacitor") && d.readings.some((r) => r.source === "measured" && r.label === "Fan 2 capacitor") && d.readings.some((r) => r.source === "telemetry"));
  ok("structured: parts used + PO links", d.partsUsed.some((p) => p.partNumber === "CAP-75-440" && p.qty === 4 && p.source.includes(po.id)) && d.purchaseOrders[0].href === `/api/purchase-orders/${po.id}`);
  ok("structured: time on site from ON_SITE check-in", d.timeOnSite.basis.includes("ON_SITE") && d.timeOnSite.minutes >= 1);
  ok("structured: citations = controlled sources cited this visit (no unverified notes)", d.citations.some((c) => c.cite === "the RTC-220 service manual, section 4.2") && d.citations.some((c) => c.docId === "SB-2024-17") && !d.citations.some((c) => c.docId === "FN-0931"), d.citations.map((c) => c.docId + (c.section ? `§${c.section}` : "")).join(", "));
  ok("summary reads as clean sentences", /recovering\. A 7-day follow-up inspection is booked for [A-Z][a-z]{2}, [A-Z][a-z]{2} \d/.test(d.workSummary), d.workSummary.slice(-70));
  ok("stage tracker ends on AFTER", sessions.current().stage === "after");
  ok("structured: follow-up + RMA included",d.followUps.length === 1 && d.returns[0].id === rma.id);
  const html = await (await fetch(`${base}/api/reports/${rpt.id}`)).text();
  ok("HTML served, printable (Print / Save as PDF + print CSS)", html.includes("Print / Save as PDF") && html.includes("@media print") && html.includes("Time on site") && html.includes("References cited") && html.includes(`/api/purchase-orders/${po.id}`));
  ok("report file persisted to data/reports/", fs.existsSync(path.resolve("data", "reports", `${rpt.id}.html`)));
  ok("PO link resolves", (await fetch(`${base}/api/purchase-orders/${po.id}`)).status === 200);

  console.log("\nTicket lookup by what the technician actually said");
  {
    const sess = sessions.current();
    const keep = { active: sess.activeTicketId, n: sess.messages.length };
    const open = async (ref: string) => (await ext.callTool({ name: "get_ticket_details", arguments: { ticket_id: ref } }) as any).structuredContent;
    sess.messages.push({ role: "user", content: "Tell me about the St. Brigid's chiller job." });
    const swapped = await open("WO-48231"); // look-alike of WO-48213 — the exact slip a live model made
    ok("look-alike ID swapped by the model → the site the technician named, flagged", swapped.ticket.id === "WO-48213" && /asked about St\. Brigid's/.test(swapped.id_corrected ?? ""), swapped.id_corrected);
    sess.messages.push({ role: "user", content: "What's next after this one?" });
    const byName = await open("Riverside");
    ok("a site name works as the work order reference", byName.ticket.id === "WO-48219" && !byName.id_corrected);
    const explicit = await open("WO-48231");
    ok("an explicit ID is left alone when no other site was named", explicit.ticket.id === "WO-48231" && !explicit.id_corrected);
    sess.messages.splice(keep.n);
    sess.activeTicketId = keep.active;
  }

  console.log("\nService bulletin enforced by the ERP, not the model's memory");
  {
    const short: any = await ext.callTool({ name: "create_purchase_order", arguments: { ticket_id: "48231", lines: [{ part_number: "FM-15-460", qty: 1, source_location: "SUPPLIER" }, { part_number: "CAP-75-440", qty: 1, source_location: "SUPPLIER" }] } });
    const why = JSON.stringify(short.structuredContent ?? short.content);
    ok("under-sized order on an RTC-220 is refused, citing SB-2024-17 and what it needs", /service bulletin SB-2024-17/.test(why) && /needs 4/.test(why) && !sessions.current().pending.some((p) => p.tool === "create_purchase_order"), why.slice(0, 160));
    const full: any = await ext.callTool({ name: "create_purchase_order", arguments: { ticket_id: "48231", lines: [{ part_number: "FM-15-460", qty: 1, source_location: "SUPPLIER" }, { part_number: "CAP-75-440", qty: 4, source_location: "SUPPLIER" }] } });
    ok("compliant order (4 capacitors) stages normally", full.structuredContent?.status === "CONFIRMATION_REQUIRED", JSON.stringify(full.structuredContent).slice(0, 120));
    if (full.structuredContent?.action_id) await ext.callTool({ name: "confirm_action", arguments: { action_id: full.structuredContent.action_id, decision: "reject" } });
  }

  console.log("\nGate + resilience via external MCP client (other ticket)");
  const close: any = await ext.callTool({ name: "update_ticket", arguments: { ticket_id: "48219", status: "RESOLVED" } });
  ok("closing a ticket is gated (CONFIRMATION_REQUIRED)", close.structuredContent.status === "CONFIRMATION_REQUIRED" && S().tickets.find((t) => t.id === "WO-48219")!.status === "ASSIGNED");
  await ext.callTool({ name: "confirm_action", arguments: { action_id: close.structuredContent.action_id, decision: "reject" } });
  ok("reject cancels with audit REJECTED", S().audit[0].status === "REJECTED");
  setChaos({ outage: { system: "ERP", on: true } });
  const q: any = await ext.callTool({ name: "create_purchase_order", arguments: { ticket_id: "48219", lines: [{ part_number: "BRG-6205", qty: 2, source_location: "WH-CEN" }] } });
  const qc: any = await ext.callTool({ name: "confirm_action", arguments: { action_id: q.structuredContent.action_id, decision: "approve" } });
  ok("ERP OUTAGE: order queued (alternative path) with plain failure reason", qc.structuredContent.status === "QUEUED" && String(qc.structuredContent.what_failed).includes("ERP"));
  setChaos({ outage: { system: "ERP", on: false } });
  await new Promise((r) => setTimeout(r, 1200));
  ok("ERP RECOVERY: queued order auto-submitted and dispatched", S().purchaseOrders.find((p) => p.id === qc.structuredContent.po_id)!.status === "DISPATCHED");

  console.log("\nAudit trail");
  const statuses = new Set(S().audit.map((a) => a.status));
  ok("every write audited (EXECUTED, PENDING, BLOCKED, REJECTED, QUEUED, FAILED)", ["EXECUTED", "PENDING_CONFIRMATION", "BLOCKED", "REJECTED", "QUEUED", "FAILED"].every((s) => statuses.has(s as any)), `${S().audit.length} entries`);
  ok("audit entries carry who/what/when", S().audit.every((a) => a.actor && a.tool && a.at && a.system));

  await ext.close();

  console.log("\nPhase 4 — Watchtower speaks up first (voice session, Agora speak captured)");
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (cond: () => boolean, ms: number) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(50);
    return cond();
  };
  let lastQuietAt = 0;
  const speakingWindows: [number, number][] = []; // when the technician was talking
  const presence = async (p: { userSpeaking?: boolean; agentSpeaking?: boolean }) => {
    if (p.userSpeaking) speakingWindows.push([Date.now(), Infinity]);
    await fetch(`${base}/api/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
    if (!p.userSpeaking) {
      lastQuietAt = Date.now();
      const open = speakingWindows.at(-1);
      if (open && open[1] === Infinity) open[1] = lastQuietAt;
    }
  };
  const post = (url: string, body: unknown = {}) => fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  await post("/api/reset");
  // Capture what the Agora agent would be told to say (the verified /speak endpoint), without network.
  const speaks: { text: string; priority: string; interruptable: boolean; at: number }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url?.url ?? url);
    if (u.includes("api.agora.io")) {
      if (u.endsWith("/speak")) speaks.push({ ...JSON.parse(String(init?.body)), at: Date.now() });
      return new Response("{}", { status: 200 });
    }
    return realFetch(url, init);
  }) as typeof fetch;
  appConfig.agora.customerId = "selftest";
  appConfig.agora.customerSecret = "selftest";
  W.configure({ autoAnnounce: true, startupDelayMs: 600, quietMs: 400, minGapMs: 2500 });
  try {
    const { beginSession } = await import("./index.ts");
    const { session: vs, greeting } = beginSession("agora", { channel: "selftest-ch", userUid: 2001 });
    vs.agentId = "AGENT-1";
    ok("briefing: greeting + today's jobs ranked by SLA risk", /^Morning Jordan, Pilot here\. Four jobs today, ranked by SLA risk: Riverside's AHU-7 is projected to miss its SLA by about .+; St\. Brigid's chiller, the P1, has .+ left on the SLA; (and )?Mercy General's chiller at \d/.test(greeting), greeting);

    await presence({ userSpeaking: true }); // the technician starts talking right away
    await sleep(1500);
    ok("stays silent while the technician is talking", speaks.length === 0 && W.list().some((i) => i.hold === "technician is speaking"));
    await presence({ userSpeaking: false });
    ok("speaks up unprompted once it's quiet", await waitFor(() => speaks.length > 0, 5000));
    const hero = speaks[0];
    ok(
      "the demo line, via Agora speak (APPEND)",
      hero.priority === "APPEND" &&
        /^Heads up: head pressure on the Mercy General chiller is climbing and it's the third capacitor-related trip in 90 days\. The main warehouse is out of the capacitor, but truck twelve has one\. Want me to reserve it, no charge and ready in ten minutes, log it on the work order, and tell the hospital to expect you at \d{1,2}(:\d\d)? (AM|PM)\?$/.test(hero.text),
      hero.text,
    );
    ok("waited for the quiet window (never cut in)", hero.at - lastQuietAt >= 400);
    ok("offer staged through the gate; nothing executed yet", vs.pending.some((p) => p.tool === "act_on_insight") && S().reservations.length === 0 && S().audit.some((a) => a.tool === "act_on_insight" && a.status === "PENDING_CONFIRMATION"));

    const before = S().notifications.length;
    await voiceTurnHttp("Yes, do it.");
    const res = S().reservations.find((r) => r.ticketId === "WO-48231");
    ok("'Yes, do it.' → reservation on truck 12 (ERP)", res?.location === "VAN-12" && res.status === "HELD" && changed.has("reservations"));
    ok("→ work order updated (FSM)", S().tickets.find((t) => t.id === "WO-48231")!.notes.some((n) => n.text.startsWith("Watchtower: 1 × CAP-75-440 reserved on VAN-12")) && changed.has("tickets"));
    ok("→ hospital told to expect the technician (Notify)", S().notifications.length > before && S().notifications.some((n) => n.channel === "SMS" && n.to === "+1-555-0163" && /will arrive at Mercy General at \d/.test(n.body)) && changed.has("notifications"));
    ok("audited: confirmed by the technician's own words, every step", S().audit.some((a) => a.tool === "act_on_insight" && a.status === "EXECUTED" && a.confirmedBy?.includes('"Yes, do it."')) && ["reserve_part", "update_ticket", "notify_customer"].every((t) => S().audit.some((a) => a.tool === t && a.confirmedBy?.startsWith("covered by the confirmed proactive action"))));
    ok("insight status: acted", W.list().find((i) => i.dedupeKey === "story:WO-48231")?.status === "acted");

    ok("next insight only after the rate-limit gap (SLA re-sequence)", await waitFor(() => speaks.length > 1, 8000));
    ok("…and it's the SLA risk, not a repeat of the handled story", /re-sequence your afternoon\?$/.test(speaks[1].text), speaks[1].text);
    // The rate limit governs announcements, so measure it there — not at the outbound HTTP call, whose
    // timestamp also includes per-call token-building jitter (the first call is cold and slower).
    const annAt = (key: string) => new Date(W.list().find((i) => i.dedupeKey === key)?.announcedAt ?? 0).getTime();
    const gap = annAt("sla:WO-48219") - annAt("story:WO-48231");
    ok("…spaced by the rate-limit gap", gap >= 2500, `${gap} ms between announcements`);
    await voiceTurnHttp("Not now.");
    ok("'Not now.' → dismissed + suppressed", W.list().find((i) => i.dedupeKey === "sla:WO-48219")?.status === "dismissed" && S().audit.some((a) => a.tool === "act_on_insight" && a.status === "REJECTED"));

    await post("/api/sim", { scenario: "head_pressure_rising", speed: 3 });
    ok("live drift → predicted HP-02 trip → Head Pressure Limit offer", await waitFor(() => speaks.some((x) => /trips HP-02 in about \d+ minutes?.*Head Pressure Limit mode/.test(x.text)), 20000), speaks.at(-1)?.text.slice(0, 90));
    await voiceTurnHttp("Yes, do it.");
    ok("mitigation applied through the gate", S().telemetry["A-CH-310"].mode === "HEAD_PRESSURE_LIMIT" && S().audit.some((a) => a.tool === "set_asset_operating_mode" && a.confirmedBy?.startsWith("covered by the confirmed proactive action")));
    const p0 = S().telemetry["A-CH-310"].points.find((p) => p.metric === "Discharge pressure")!.value;
    await sleep(2200);
    ok("head pressure now falling", S().telemetry["A-CH-310"].points.find((p) => p.metric === "Discharge pressure")!.value < p0);
    await post("/api/sim", { stop: true });

    await presence({ userSpeaking: true }); // mid-sentence
    const n = speaks.length;
    await post("/api/sim/safety", { assetId: "A-CH-220" });
    ok("safety cuts in immediately, even mid-sentence", await waitFor(() => speaks.slice(n).some((x) => x.text.startsWith("Stop work:")), 3000));
    const sp = speaks.slice(n).find((x) => x.text.startsWith("Stop work:"))!;
    ok("…with INTERRUPT priority, non-interruptable, and a SEV1 offer", sp.priority === "INTERRUPT" && sp.interruptable === false && /severity-one safety escalation/.test(sp.text));
    await presence({ userSpeaking: false });
    const appends = speaks.filter((x) => x.priority === "APPEND");
    ok("no non-safety announcement ever landed while the technician was talking", appends.length >= 3 && appends.every((x) => !speakingWindows.some(([a, b]) => x.at >= a && x.at <= b)), `${appends.length} announcements, ${speakingWindows.length} speaking windows`);

    const ms = (await (await fetch(`${base}/api/state`)).json()).metrics.insights;
    ok("precision tracked (accepted ÷ shown)", ms.shown >= 3 && ms.accepted === 2 && ms.precision === Math.round((2 / ms.shown) * 100) / 100, JSON.stringify(ms));
    const proactiveWrites = S().audit.filter((a) => a.confirmedBy?.startsWith("covered by the confirmed proactive action"));
    ok("every proactive write sits under a confirmed act_on_insight (no unconfirmed actions)", proactiveWrites.length >= 4 && S().audit.filter((a) => a.tool === "act_on_insight" && a.status === "EXECUTED").length === 2);
  } finally {
    globalThis.fetch = realFetch;
    W.configure({ autoAnnounce: false });
  }
} finally {
  await fetch(`${base}/api/reset`, { method: "POST" }).catch(() => {});
  server.close();
  fake.close();
}
console.log(`\n${pass} checks passed ✔\n`);
process.exit(0);

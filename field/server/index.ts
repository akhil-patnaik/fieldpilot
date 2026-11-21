import "./trust.ts"; // must stay first: trust the OS certificate store before any network call
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { capabilities, config, runtime } from "./config.ts";
import { handleBackupCompletion } from "./backupBrain.ts";
import { computeImpact } from "./impact.ts";
import { INSTANCE_ID, runPreflight } from "./preflight.ts";
import { attachSse, clearHistory, emit } from "./bus.ts";
import { db } from "./store.ts";
import { sessions, publicSession, metricsView, emitMetrics } from "./session.ts";
import { runTurn } from "./agent.ts";
import { cancelBackgroundWork, decideManagerApproval, resolvePending, setAnnouncer, setSessionProvider, toolByName, type ToolCtx } from "./tools.ts";
import { chaosState, setChaos, systemHealth } from "./resilience.ts";
import { setMcpUrl } from "./mcpClient.ts";
import { pathToFileURL } from "node:url";
import { agentSpeak, startAgent, stopAgent, userRtcToken } from "./agora.ts";
import { streamMurf } from "./murf.ts";
import { handleMcp } from "./mcp.ts";
import { kbStats } from "./rag.ts";
import {
  assetNoun,
  config as watchtowerConfig,
  configure as configureWatchtower,
  deliver as deliverInsight,
  dismiss as dismissInsight,
  evaluate as evaluateInsights,
  humanMinutes,
  insightStats,
  list as listInsights,
  projectRoute,
  requestAct,
  reset as resetInsights,
  rearm as rearmInsights,
  setDelivery,
  spokenTime,
  startWatchtower,
} from "./watchtower.ts";
import { resetSim, setSpeed, simState, startScenario, stopScenarios, triggerSafety } from "./simulator.ts";
import { setMetricsExtension } from "./session.ts";

export const app = express();
app.use(express.json({ limit: "2mb" }));

// ─────────────── proactive voice (Watchtower insights, manager approvals, UI confirmations) ───────────────
/**
 * Speak something the technician didn't ask for. In Agora voice mode this uses the documented `speak` API
 * (INTEGRATIONS §A5): APPEND normally; INTERRUPT only for safety-critical messages. Direct/text mode gets an
 * `announce` event (the browser speaks it, interrupting only if urgent).
 */
function announce(text: string, opts: { urgent?: boolean; insightId?: string } = {}) {
  const s = sessions.current();
  s.messages.push({ role: "assistant", content: text });
  emit({ type: "transcript", id: `push-${Date.now()}`, role: "assistant", text, final: true, source: "push" });
  emit({ type: "announce", text, urgent: opts.urgent, insightId: opts.insightId });
  if (s.mode === "agora" && s.agentId && s.channel) {
    agentSpeak(s.agentId, s.channel, text, opts.urgent ? "INTERRUPT" : "APPEND").catch((e) => console.error("[agora speak]", e.message));
  }
}
setAnnouncer((text) => announce(text));
setSessionProvider(() => sessions.current());
setDelivery((text, o) => announce(text, o));
setMetricsExtension(() => ({ insights: insightStats() }));

const uiCtx = (): ToolCtx => ({ session: sessions.current(), origin: "ui", callId: `ui_${Date.now().toString(36)}`, def: toolByName("confirm_action")!, retries: 0, failures: [] });

/** Session-start briefing: greeting + today's jobs ranked by projected SLA risk (top insight follows via Watchtower). */
export function briefing(now = Date.now()) {
  const st = db.get();
  const first = st.technician.name.split(" ")[0];
  const stops = projectRoute(st, now).sort((a, b) => a.slaMarginMin - b.slaMarginMin);
  if (!stops.length) return `Morning ${first}, Pilot here. Nothing left on today's route.`;
  const phrase = (r: (typeof stops)[number]) => {
    const site = st.sites.find((s) => s.id === r.ticket.siteId)!;
    const asset = st.assets.find((a) => a.id === r.ticket.assetId)!;
    const name = site.shortName ?? site.name;
    const who = `${/'s$/.test(name) ? name : `${name}'s`} ${assetNoun(asset)}`;
    if (r.slaMarginMin < 0) return `${who} is projected to miss its SLA by about ${humanMinutes(-r.slaMarginMin)}`;
    if (r.ticket.priority === "P1") return `${who}, the P1, has ${humanMinutes((new Date(r.ticket.slaDueAt).getTime() - now) / 60000)} left on the SLA`;
    return `${who} at ${spokenTime(r.appt.start)}`;
  };
  const list = stops.map(phrase);
  const joined = list.length > 1 ? `${list.slice(0, -1).join("; ")}; and ${list.at(-1)}` : list[0];
  const n = stops.length;
  const count = ["No", "One", "Two", "Three", "Four", "Five", "Six"][n] ?? String(n);
  return `Morning ${first}, Pilot here. ${count} job${n === 1 ? "" : "s"} today, ranked by SLA risk: ${joined}.`;
}

/** Start a conversation session: fresh state, spoken briefing, and a fresh Watchtower pass. */
export function beginSession(mode: "agora" | "direct", extra: Parameters<typeof sessions.start>[1] = {}) {
  const s = sessions.start(mode, { ...extra, live: true });
  const text = briefing();
  s.messages.push({ role: "assistant", content: text });
  emit({ type: "transcript", id: `greet-${Date.now()}`, role: "assistant", text, final: true, source: mode });
  rearmInsights(); // a new conversation hasn't heard earlier announcements
  evaluateInsights();
  return { session: s, greeting: text };
}

// ─────────────── UI APIs ───────────────
app.get("/api/health", (_req, res) => res.json({ ok: true, instanceId: INSTANCE_ID, capabilities: capabilities(), kb: kbStats() }));
app.get("/api/preflight", async (_req, res) => res.json(await runPreflight()));
/** Demo/test tuning of Watchtower pacing (e.g. a shorter rate-limit gap for rehearsals). */
app.post("/api/watchtower/config", (req, res) => {
  const allowed = ["autoAnnounce", "minGapMs", "quietMs", "startupDelayMs", "maxPer10Min"] as const;
  const patch = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => (allowed as readonly string[]).includes(k)));
  configureWatchtower(patch);
  res.json(watchtowerConfig);
});
app.get("/api/events", (_req, res) => attachSse(res));
app.get("/api/state", (_req, res) => {
  const s = db.get();
  res.json({
    ...s,
    reports: s.reports.map(({ html, ...r }) => r),
    session: publicSession(),
    pending: sessions.current().pending,
    metrics: metricsView(),
    chaos: chaosState(),
    health: systemHealth(),
    approvalLimitUsd: config.approvalLimitUsd,
    insights: listInsights(),
    insightStats: insightStats(),
    sim: simState(),
  });
});
app.get("/api/reports/:id", (req, res) => {
  const r = db.get().reports.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).send("Report not found");
  res.type("html").send(r.html);
});

/** PO detail — linked from the service report. */
app.get("/api/purchase-orders/:id", (req, res) => {
  const po = db.get().purchaseOrders.find((p) => p.id === req.params.id);
  if (!po) return res.status(404).json({ error: "Purchase order not found" });
  res.json(po);
});
app.get("/api/kb", (_req, res) => res.json(kbStats()));

app.post("/api/reset", async (_req, res) => {
  const s = sessions.current();
  if (s.mode === "agora" && s.agentId && s.channel) await stopAgent(s.agentId, s.channel).catch(() => {});
  resetSim();
  cancelBackgroundWork(); // no timer from the previous run may touch the fresh world
  db.reset();
  clearHistory();
  setChaos({ clear: true, rate: config.chaosFailureRate });
  resetInsights();
  sessions.start("direct");
  evaluateInsights();
  res.json({ ok: true });
});

app.post("/api/session/direct/start", (_req, res) => {
  const { session, greeting } = beginSession("direct");
  res.json({ session: publicSession(session), greeting });
});

// ─────────────── Watchtower: presence, insights, simulation ───────────────
/** Client-reported audibility (mic level / TTS playback) so proactive speech never talks over anyone. */
app.post("/api/presence", (req, res) => {
  const s = sessions.current();
  const userSpeaking = Boolean(req.body?.userSpeaking);
  const agentSpeaking = Boolean(req.body?.agentSpeaking);
  if (userSpeaking !== s.presence.userSpeaking || agentSpeaking !== s.presence.agentSpeaking) s.presence = { userSpeaking, agentSpeaking, at: Date.now() };
  if (userSpeaking) s.lastUserActivityAt = Date.now();
  res.json({ ok: true });
});
app.get("/api/insights", (_req, res) => res.json({ insights: listInsights(), stats: insightStats(), config: watchtowerConfig }));
app.post("/api/insights/:id/dismiss", (req, res) => {
  const i = dismissInsight(req.params.id);
  if (!i) return res.status(404).json({ error: "No such insight" });
  res.json({ ok: true, status: i.status });
});
/** Rail "Do it": stages the action through the gate; the approval card (or a spoken yes) confirms it. */
app.post("/api/insights/:id/act", (req, res) => {
  const r = requestAct(req.params.id);
  res.status("error" in r ? 409 : 200).json(r);
});
app.post("/api/watchtower/run", (_req, res) => {
  evaluateInsights();
  const announced = deliverInsight();
  res.json({ insights: listInsights(), announced: announced?.id ?? null });
});
app.get("/api/sim", (_req, res) => res.json(simState()));
app.post("/api/sim", (req, res) => {
  const b = req.body ?? {};
  if (b.stop) stopScenarios();
  if (typeof b.speed === "number") setSpeed(b.speed);
  if (b.scenario === "head_pressure_rising") startScenario("head_pressure_rising");
  res.json(simState());
});
app.post("/api/sim/safety", (req, res) => {
  const s = sessions.current();
  const asset = req.body?.assetId ?? (s.activeTicketId ? db.get().tickets.find((t) => t.id === s.activeTicketId)?.assetId : undefined) ?? "A-CH-220";
  res.json(triggerSafety(asset));
});

app.post("/api/session/agora/start", async (_req, res) => {
  const caps = capabilities();
  if (!caps.agora) return res.status(400).json({ error: "AGORA_APP_ID / AGORA_APP_CERTIFICATE not configured" });
  try {
    const prev = sessions.current();
    if (prev.mode === "agora" && prev.agentId && prev.channel) await stopAgent(prev.agentId, prev.channel).catch(() => {});
    const channel = `fieldpilot-${Date.now().toString(36)}`;
    const userUid = 2000 + Math.floor(Math.random() * 1000);
    const { session: s, greeting: text } = beginSession("agora", { channel, userUid });
    const agent = await startAgent({ channel, userUid, greeting: text });
    s.agentId = agent.agent_id;
    emit({ type: "session", session: publicSession(s) });
    res.json({ appId: config.agora.appId, channel, uid: userUid, token: userRtcToken(channel, userUid), agentId: agent.agent_id, session: publicSession(s) });
  } catch (e: any) {
    console.error("[agora start]", e.message);
    res.status(502).json({ error: e.message });
  }
});

app.post("/api/session/agora/stop", async (_req, res) => {
  const s = sessions.current();
  if (s.agentId && s.channel) await stopAgent(s.agentId, s.channel).catch((e) => console.error("[agora stop]", e.message));
  s.agentId = undefined;
  emit({ type: "agent_state", state: "idle" });
  res.json({ ok: true });
});

/** Direct mode: browser ASR → agent → streamed text (browser plays Murf audio per sentence). */
app.post("/api/direct/turn", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  const s = sessions.current();
  s.abort?.abort();
  const ac = new AbortController();
  s.abort = ac;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.on("close", () => {
    if (!res.writableFinished) ac.abort();
  });
  const viaAgora = s.mode === "agora" && s.agentId && s.channel;
  let full = "";
  for await (const piece of runTurn(s, text, { source: viaAgora ? "agora" : "direct", signal: ac.signal })) {
    full += piece;
    if (!viaAgora) res.write(`data: ${JSON.stringify({ delta: piece })}\n\n`);
  }
  // Typed input during an Agora call: have the live agent speak the answer with Murf Falcon.
  if (viaAgora && full.trim()) agentSpeak(s.agentId!, s.channel!, full.trim()).catch((e) => console.error("[agora speak]", e.message));
  res.write(`data: ${JSON.stringify({ done: true, spokenBy: viaAgora ? "agora" : "client" })}\n\n`);
  res.end();
});

app.get("/api/tts", async (req, res) => {
  const text = String(req.query.text ?? "").slice(0, 3000);
  if (!text) return res.status(400).end();
  try {
    await streamMurf(text, res, req.query.voice ? String(req.query.voice) : undefined);
  } catch (e: any) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.end();
  }
});

/** Touch-confirm a pending critical action from the screen (gloves-off fallback to voice). */
app.post("/api/pending/:id", async (req, res) => {
  const decision = req.body?.decision === "reject" ? "reject" : "approve";
  const s = sessions.current();
  const p = s.pending.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "No such pending action" });
  s.messages.push({ role: "user", content: `[On screen I tapped ${decision.toUpperCase()} for ${p.id}: ${p.summary}]` });
  const result: any = await resolvePending(p.id, decision, uiCtx());
  const label = toolByName(p.tool)?.label.toLowerCase() ?? "that";
  const detail = result.po_id
    ? ` P O ${String(result.po_id).replace("PO-", "")} is ${result.status === "PENDING_MANAGER_APPROVAL" ? `with ${db.get().technician.manager.name} for approval` : result.status === "QUEUED" ? "queued until the ERP is back" : "dispatched"}.`
    : result.incident_id
      ? ` Incident ${String(result.incident_id).replace("INC-", "")} is open with ${result.assignee}.`
      : result.when
        ? ` You're booked for ${result.when}, and the customer's been emailed.`
        : result.effect
          ? ` ${result.effect}`
          : "";
  announce(decision === "reject" ? `Okay, cancelled. Nothing was changed.` : result.error ? `That didn't go through: ${result.error}` : `Got your tap. ${label[0].toUpperCase()}${label.slice(1)} is done.${detail}`);
  emitMetrics();
  res.json(result);
});

/** Manager approval card (the manager clicks Approve/Reject on an over-limit PO). */
app.post("/api/approvals/:poId", async (req, res) => {
  const decision = req.body?.decision === "reject" ? "reject" : "approve";
  const result: any = await decideManagerApproval(req.params.poId, decision, `${db.get().technician.manager.name} (approval card)`);
  emitMetrics();
  res.status(result.error ? 409 : 200).json(result);
});

/** Chaos controls for the resilience demo (also driven by CHAOS_FAILURE_RATE). */
app.get("/api/chaos", (_req, res) => res.json({ chaos: chaosState(), health: systemHealth() }));
app.post("/api/chaos", (req, res) => res.json({ chaos: setChaos(req.body ?? {}), health: systemHealth() }));

// ─────────────── Agora custom LLM endpoint (OpenAI-compatible, SSE) ───────────────
let loggedLlmShape = false;
app.post("/llm/chat/completions", async (req, res) => {
  const auth = req.headers.authorization;
  const body = req.body ?? {};
  const msgs: any[] = Array.isArray(body.messages) ? body.messages : [];
  // Agora's docs don't specify the headers it sends or where turn_id/timestamp live (docs/INTEGRATIONS.md §A4).
  // Log the request *shape* once — names only, never values — so the first live call verifies it.
  if (!loggedLlmShape) {
    loggedLlmShape = true;
    console.log("[llm] first request shape:", JSON.stringify({
      headers: Object.keys(req.headers),
      authScheme: auth ? auth.split(" ")[0] : null,
      authCarriesOurKey: auth ? auth.includes(config.llmProxySecret) : null,
      bodyKeys: Object.keys(body),
      messageKeys: [...new Set(msgs.flatMap((m) => Object.keys(m ?? {})))],
      stream: body.stream,
    }));
  }
  if (auth && !auth.includes(config.llmProxySecret)) return res.status(401).json({ detail: "bad api key" });
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const text = typeof lastUser?.content === "string" ? lastUser.content : Array.isArray(lastUser?.content) ? lastUser.content.map((p: any) => p.text ?? "").join(" ") : "";

  const s = sessions.current();
  s.abort?.abort();
  const ac = new AbortController();
  s.abort = ac;

  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: "fieldpilot-agent", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.on("close", () => {
    if (!res.writableFinished) ac.abort(); // barge-in
  });
  res.write(chunk({ role: "assistant", content: "" }));
  if (!text.trim()) {
    res.write(chunk({ content: "Sorry, I didn't catch that." }));
  } else {
    for await (const piece of runTurn(s, text.trim(), { source: "agora", signal: ac.signal })) res.write(chunk({ content: piece }));
  }
  res.write(chunk({}, "stop"));
  res.write("data: [DONE]\n\n");
  res.end();
});

// ─────────────── Impact (from real session data) ───────────────
app.get("/api/impact", (_req, res) => res.json(computeImpact()));

// ─────────────── Backup brain (offline / no-LLM demo) ───────────────
app.post("/backup/v1/chat/completions", handleBackupCompletion);
app.get("/api/backup", (_req, res) => res.json({ backup: runtime.backup }));
app.post("/api/backup", (req, res) => {
  runtime.backup = Boolean(req.body?.on);
  console.log(`[backup] scripted backup brain ${runtime.backup ? "ON" : "OFF"}`);
  emit({ type: "session", session: publicSession() });
  res.json({ backup: runtime.backup, capabilities: capabilities() });
});

// ─────────────── MCP ───────────────
app.post("/mcp", (req, res) => {
  handleMcp(req, res).catch((e) => {
    console.error("[mcp]", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: String(e?.message ?? e) }, id: null });
  });
});
app.all("/mcp", (_req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: POST only)" }, id: null }));

// ─────────────── static (production) ───────────────
const dist = path.resolve(process.cwd(), "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/(api|llm|mcp)).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

export function start(port = config.port) {
  runtime.selfUrl = `http://127.0.0.1:${port}`;
  setMcpUrl(`${runtime.selfUrl}/mcp`);
  startWatchtower();
  return app.listen(port, () => {
    const c = capabilities();
    console.log(`\n  FieldPilot server  →  http://localhost:${port}`);
    console.log(`  LLM    ${c.llm ? "✓" : "✗"}  ${config.llm.model} @ ${config.llm.baseURL}`);
    console.log(`  Brain  ${runtime.backup ? "BACKUP (scripted demo brain — no LLM key needed)" : "live LLM"}`);
    console.log(`  Agora  ${c.agora ? "✓" : "✗"}  ${c.agoraReachable ? `custom LLM → ${config.publicUrl}/llm/chat/completions` : "set PUBLIC_URL (tunnel) for voice mode"}`);
    console.log(`  Murf   ${c.murf ? "✓" : "✗"}  Falcon voice ${config.murf.voiceId}`);
    console.log(`  MCP    ✓  http://localhost:${port}/mcp  (agent tools are executed through it)`);
    console.log(`  Chaos  ${chaosState().rate ? `failure rate ${chaosState().rate}` : "off"}\n`);
  });
}

// Run when executed directly (npm run dev / start); stay importable for tests.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();

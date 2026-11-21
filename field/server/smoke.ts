/**
 * Smoke test against the REAL HTTP server (spawned as a child process) + offline contract checks
 * of the exact requests we send to Agora ConvoAI and Murf Falcon (captured, never sent).
 * No API keys or network needed.  Run: npm run smoke
 *
 * Every contract assertion below cites the doc fact it enforces — see docs/INTEGRATIONS.md.
 */
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

let pass = 0;
const ok = (name: string, cond: unknown, extra = "") => {
  assert.ok(cond, name);
  pass++;
  console.log(`  ✓ ${name}${extra ? `  — ${extra}` : ""}`);
};
const freePort = () =>
  new Promise<number>((r) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });

// ── Fake OpenAI-compatible LLM: one tool call, then a short answer ──
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    const last = body.messages[body.messages.length - 1];
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (delta: any, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if (last.role === "user") send({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "get_daily_briefing", arguments: "{}" } }] }, "tool_calls");
    else {
      send({ content: "You have three jobs. " });
      send({ content: "The P1 is at St. Brigid's." }, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise<void>((r) => fake.listen(0, r));
const llmPort = (fake.address() as net.AddressInfo).port;

// ── Boot the real server with keys deliberately blank ──
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    LLM_BASE_URL: `http://127.0.0.1:${llmPort}/v1`,
    LLM_API_KEY: "smoke",
    LLM_PROXY_SECRET: "smoke-secret",
    AGORA_APP_ID: "",
    AGORA_APP_CERTIFICATE: "",
    AGORA_CUSTOMER_ID: "",
    AGORA_CUSTOMER_SECRET: "",
    MURF_API_KEY: "",
    PUBLIC_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (d) => (logs += d));
child.stderr.on("data", (d) => (logs += d));
const cleanup = () => {
  child.kill();
  fake.close();
};
process.on("exit", cleanup);

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

try {
  console.log("\nHTTP server");
  const health = await (await fetch(`${base}/api/health`)).json();
  ok("boots and reports capabilities", health.ok && health.capabilities.llm && !health.capabilities.agora && !health.capabilities.murf);
  ok("knowledge base indexed", health.kb.documents >= 7, `${health.kb.documents} docs / ${health.kb.chunks} chunks`);
  await fetch(`${base}/api/reset`, { method: "POST" });

  console.log("\nAgora custom-LLM endpoint (/llm/chat/completions)");
  const bad = await fetch(`${base}/llm/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" }, body: "{}" });
  ok("rejects a wrong api_key", bad.status === 401);
  const r = await fetch(`${base}/llm/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer smoke-secret" },
    body: JSON.stringify({ model: "x", stream: true, messages: [{ role: "user", content: "what's on my plate", turn_id: 0, timestamp: Date.now() }] }),
  });
  ok("responds text/event-stream", r.headers.get("content-type")?.includes("text/event-stream"));
  const sse = await r.text();
  const events = sse.split("\n\n").filter(Boolean);
  const chunks = events.filter((e) => e.startsWith("data: {")).map((e) => JSON.parse(e.slice(6)));
  ok("every event is an OpenAI chat.completion.chunk", chunks.length > 2 && chunks.every((c) => c.object === "chat.completion.chunk" && Array.isArray(c.choices)));
  ok("ends with finish_reason stop then [DONE]", chunks.at(-1).choices[0].finish_reason === "stop" && events.at(-1) === "data: [DONE]");
  const spoken = chunks.map((c) => c.choices[0].delta.content ?? "").join("");
  ok("streams filler + answer (tools ran in between)", spoken.includes("Pulling up your day") && spoken.includes("three jobs"), JSON.stringify(spoken));
  ok("logs request shape once (names only)", logs.includes("[llm] first request shape") && !logs.includes("smoke-secret"));

  console.log("\nMCP (/mcp)");
  const mcp = (body: unknown) =>
    fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }).then((x) => x.text());
  const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
  ok("initialize", init.includes("fieldpilot-enterprise"));
  const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  ok("tools/list exposes 21 tools", (list.match(/"name":"[a-z_]+"/g) ?? []).length === 21);

  console.log("\nGraceful without keys");
  const tts = await fetch(`${base}/api/tts?text=hello`);
  ok("/api/tts → 501 without MURF_API_KEY (client falls back to browser TTS)", tts.status === 501);
  const ag = await fetch(`${base}/api/session/agora/start`, { method: "POST" });
  ok("/api/session/agora/start → 400 without Agora keys", ag.status === 400);
  await fetch(`${base}/api/reset`, { method: "POST" });
} catch (e) {
  console.error("\nServer logs:\n" + logs);
  throw e;
} finally {
  child.kill();
}

// ── Offline contract checks: capture outgoing requests, assert documented shapes ──
console.log("\nAgora ConvoAI request contract (captured, not sent)");
process.env.AGORA_APP_ID = "0123456789abcdef0123456789abcdef";
process.env.AGORA_APP_CERTIFICATE = "fedcba9876543210fedcba9876543210";
process.env.AGORA_CUSTOMER_ID = "";
process.env.AGORA_CUSTOMER_SECRET = "";
process.env.PUBLIC_URL = "https://example.trycloudflare.com";
process.env.MURF_API_KEY = "murf-test-key";
const captured: { url: string; init: RequestInit }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  captured.push({ url: String(url), init });
  const u = String(url);
  if (u.includes("/join")) return new Response(JSON.stringify({ agent_id: "A1", create_ts: 1, status: "RUNNING" }), { status: 200 });
  if (u.includes("murf")) return new Response("forbidden", { status: 403 });
  return new Response("", { status: 200 });
}) as typeof fetch;

const agora = await import("./agora.ts");
await agora.startAgent({ channel: "smoke-ch", userUid: 2001, greeting: "Hi" });
const join = captured.find((c) => c.url.includes("/join"))!;
const jb = JSON.parse(String(join.init.body));
const auth = (join.init.headers as Record<string, string>).Authorization;
ok("POST …/v2/projects/{appid}/join", join.url === `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}/join` && join.init.method === "POST");
ok('auth header is `agora token="<token>"` (quoted)', /^agora token="007[A-Za-z0-9+/=]+"$/.test(auth));
ok("same token in header and properties.token", auth === `agora token="${jb.properties.token}"`);
ok("agent_rtc_uid / remote_rtc_uids are strings", jb.properties.agent_rtc_uid === "1000" && jb.properties.remote_rtc_uids[0] === "2001");
ok("llm.url → PUBLIC_URL/llm/chat/completions, vendor custom, style openai", jb.properties.llm.url === "https://example.trycloudflare.com/llm/chat/completions" && jb.properties.llm.vendor === "custom" && jb.properties.llm.style === "openai");
const tp = jb.properties.tts.params;
ok("tts.vendor murf with documented params", jb.properties.tts.vendor === "murf" && tp.api_key === "murf-test-key" && tp.base_url === "wss://global.api.murf.ai/v1/speech/stream-input" && tp.voiceId && tp.locale && tp.model === "FALCON" && tp.sample_rate === 24000);
ok("asr.vendor ares + language", jb.properties.asr.vendor === "ares" && jb.properties.asr.language === "en-US");
ok("turn_detection semantic end_of_speech", jb.properties.turn_detection.config.end_of_speech.mode === "semantic" && jb.properties.turn_detection.config.end_of_speech.semantic_config.max_wait_ms === 3000);

captured.length = 0;
await agora.stopAgent("A1", "smoke-ch");
ok("leave: POST …/agents/{id}/leave with no body", captured[0].url.endsWith("/agents/A1/leave") && captured[0].init.body === undefined);
captured.length = 0;
const long = "Quick update from Pilot. ".repeat(40) + "🚚".repeat(20);
await agora.agentSpeak("A1", "smoke-ch", long);
const sb = JSON.parse(String(captured[0].init.body));
ok("speak text ≤ 512 bytes, priority APPEND", new TextEncoder().encode(sb.text).length <= 512 && sb.priority === "APPEND", `${new TextEncoder().encode(sb.text).length} bytes`);

console.log("\nMurf Falcon HTTP stream contract (captured, not sent)");
const { streamMurf } = await import("./murf.ts");
const fakeRes: any = { headers: {} as Record<string, string>, statusCode: 200, body: null, setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
captured.length = 0;
await streamMurf("Hello Jordan.", fakeRes);
const mreq = captured[0];
const mb = JSON.parse(String(mreq.init.body));
ok("POST https://global.api.murf.ai/v1/speech/stream", mreq.url === "https://global.api.murf.ai/v1/speech/stream");
ok("api-key header", (mreq.init.headers as Record<string, string>)["api-key"] === "murf-test-key");
ok("body: text, voiceId, locale, model falcon-2.1, format MP3, sampleRate 24000", mb.text === "Hello Jordan." && mb.voiceId && mb.locale && mb.model === "falcon-2.1" && mb.format === "MP3" && mb.sampleRate === 24000);
ok("Murf 403 (bad key) passed through, not masked as 502", fakeRes.statusCode === 403);

globalThis.fetch = realFetch;
cleanup();
console.log(`\n${pass} smoke checks passed ✔\n`);
process.exit(0);

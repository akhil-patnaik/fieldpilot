import OpenAI from "openai";
import { config, runtime } from "./config.ts";
import { agentToken } from "./agora.ts";
import { mcpListTools } from "./mcpClient.ts";
import { kbStats } from "./rag.ts";
import { list as listInsights } from "./watchtower.ts";

/**
 * Pre-flight: live checks of every dependency the demo needs, with latency numbers. Nothing is mocked —
 * each check actually calls the service (minimal LLM completion, Murf voice catalog, the public tunnel).
 */

export interface Check {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
  ms?: number;
}

/** Random per process: lets the tunnel check prove PUBLIC_URL reaches THIS server. */
export const INSTANCE_ID = Math.random().toString(36).slice(2, 10);

async function timed<T>(fn: () => Promise<T>, timeoutMs: number): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs))]);
  return { value, ms: Math.round(performance.now() - t0) };
}

async function checkLlm(): Promise<Check> {
  const label = `LLM (${config.llm.model})`;
  if (!config.llm.apiKey && !/localhost|127\.0\.0\.1/.test(config.llm.baseURL)) return { id: "llm", label, status: "skip", detail: "No LLM_API_KEY set. The scripted backup brain will run the demo." };
  try {
    const client = new OpenAI({ baseURL: config.llm.baseURL, apiKey: config.llm.apiKey || "not-needed" });
    const t0 = performance.now();
    let ttft = 0;
    let text = "";
    const { ms } = await timed(async () => {
      const stream = await client.chat.completions.create({ model: config.llm.model, messages: [{ role: "user", content: "Reply with the single word OK." }], max_tokens: 5, stream: true });
      for await (const ch of stream) {
        const d = ch.choices?.[0]?.delta?.content;
        if (d && !ttft) ttft = Math.round(performance.now() - t0);
        text += d ?? "";
      }
    }, 15000);
    return { id: "llm", label, status: "pass", detail: `Replied "${text.trim().slice(0, 20)}". First token ${ttft} ms, total ${ms} ms.${runtime.backup ? " (Backup brain is ON — turn it off to use this model.)" : ""}`, ms: ttft || ms };
  } catch (e: any) {
    return { id: "llm", label, status: "fail", detail: `${e?.status ? `HTTP ${e.status}: ` : ""}${e?.message ?? e}. Switch on the backup brain for the demo.` };
  }
}

async function checkBrain(): Promise<Check> {
  return runtime.backup
    ? { id: "brain", label: "Agent brain", status: "warn", detail: "BACKUP brain active: scripted, offline, follows the demo story only." }
    : { id: "brain", label: "Agent brain", status: "pass", detail: `Live LLM: ${config.llm.model}` };
}

async function checkMcp(): Promise<Check> {
  try {
    const { value, ms } = await timed(() => mcpListTools(), 5000);
    return { id: "mcp", label: "MCP tool server", status: value.length >= 15 ? "pass" : "warn", detail: `${value.length} tools listed via /mcp.`, ms };
  } catch (e: any) {
    return { id: "mcp", label: "MCP tool server", status: "fail", detail: e?.message ?? String(e) };
  }
}

async function checkAgora(): Promise<Check> {
  if (!config.agora.appId || !config.agora.appCertificate) return { id: "agora", label: "Agora Conversational AI", status: "skip", detail: "AGORA_APP_ID / AGORA_APP_CERTIFICATE not set — use Direct voice or text." };
  try {
    agentToken("preflight");
  } catch (e: any) {
    return { id: "agora", label: "Agora Conversational AI", status: "fail", detail: `Token build failed: ${e?.message}` };
  }
  try {
    const { ms } = await timed(() => fetch("https://api.agora.io", { method: "HEAD" }), 6000);
    return { id: "agora", label: "Agora Conversational AI", status: config.publicUrl ? "pass" : "warn", detail: `Credentials present, token builds, api.agora.io reachable.${config.publicUrl ? "" : " PUBLIC_URL missing — the agent can't reach /llm."} Agent join is verified when a call starts.`, ms };
  } catch (e: any) {
    return { id: "agora", label: "Agora Conversational AI", status: "fail", detail: `api.agora.io unreachable: ${e?.message}` };
  }
}

async function checkTunnel(): Promise<Check> {
  if (!config.publicUrl) return { id: "tunnel", label: "Public tunnel (PUBLIC_URL)", status: config.agora.appId ? "fail" : "skip", detail: "PUBLIC_URL not set. Agora's cloud needs it to call /llm/chat/completions (see README → ngrok)." };
  try {
    const { value, ms } = await timed(async () => (await fetch(`${config.publicUrl}/api/health`, { headers: { "ngrok-skip-browser-warning": "1" } })).json() as Promise<any>, 8000);
    if (value?.instanceId !== INSTANCE_ID) return { id: "tunnel", label: "Public tunnel (PUBLIC_URL)", status: "fail", detail: "PUBLIC_URL answers, but not from THIS server (stale tunnel or wrong port).", ms };
    return { id: "tunnel", label: "Public tunnel (PUBLIC_URL)", status: "pass", detail: `${config.publicUrl} reaches this server.`, ms };
  } catch (e: any) {
    return { id: "tunnel", label: "Public tunnel (PUBLIC_URL)", status: "fail", detail: `${config.publicUrl} unreachable: ${e?.message}` };
  }
}

async function checkMurf(): Promise<Check> {
  if (!config.murf.apiKey) return { id: "murf", label: "Murf Falcon TTS", status: "skip", detail: "MURF_API_KEY not set — browser speech is used in Direct mode; Agora mode needs Murf." };
  try {
    const { value, ms } = await timed(async () => {
      const r = await fetch("https://global.api.murf.ai/v1/speech/voices?model=falcon-2.1", { headers: { "api-key": config.murf.apiKey } });
      return { status: r.status, body: r.ok ? await r.json() : await r.text() };
    }, 8000);
    if (value.status === 401 || value.status === 403) return { id: "murf", label: "Murf Falcon TTS", status: "fail", detail: `Key rejected (HTTP ${value.status}).`, ms };
    if (value.status !== 200) return { id: "murf", label: "Murf Falcon TTS", status: "warn", detail: `Voice catalog returned HTTP ${value.status}; TTS may still work.`, ms };
    const voices = JSON.stringify(value.body);
    const found = new RegExp(`\\b${config.murf.voiceId}\\b`, "i").test(voices);
    return { id: "murf", label: "Murf Falcon TTS", status: found ? "pass" : "warn", detail: found ? `Key valid; voice "${config.murf.voiceId}" available on Falcon.` : `Key valid, but voice "${config.murf.voiceId}" wasn't found in the Falcon catalog.`, ms };
  } catch (e: any) {
    return { id: "murf", label: "Murf Falcon TTS", status: "fail", detail: `Murf unreachable: ${e?.message}` };
  }
}

export async function runPreflight() {
  const checks = await Promise.all([checkBrain(), checkLlm(), checkMcp(), checkAgora(), checkTunnel(), checkMurf()]);
  const kb = kbStats();
  checks.push({ id: "rag", label: "Knowledge base", status: "pass", detail: `${kb.chunks} chunks, ${kb.documents} documents · ${kb.retrieval}` });
  checks.push({ id: "watchtower", label: "Watchtower", status: "pass", detail: `${listInsights().length} insights on the board.` });
  const voiceReady = checks.find((c) => c.id === "agora")?.status === "pass" && checks.find((c) => c.id === "tunnel")?.status === "pass" && checks.find((c) => c.id === "murf")?.status === "pass";
  const brainReady = runtime.backup || checks.find((c) => c.id === "llm")?.status === "pass";
  return {
    at: new Date().toISOString(),
    checks,
    verdict: brainReady ? (voiceReady ? "Ready: full Agora voice demo." : "Ready for Direct voice / text. Agora voice is not fully configured.") : "Not ready: the LLM failed. Switch on the backup brain.",
    latency: Object.fromEntries(checks.filter((c) => c.ms != null).map((c) => [c.id, c.ms])),
  };
}

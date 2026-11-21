import agoraToken from "agora-token";
import { config } from "./config.ts";

const { RtcTokenBuilder, RtcRole, ConvoAITokenBuilder } = agoraToken as any;

const API = "https://api.agora.io/api/conversational-ai-agent/v2/projects";
export const AGENT_UID = 1000;

export function userRtcToken(channel: string, uid: number) {
  return RtcTokenBuilder.buildTokenWithUid(config.agora.appId, config.agora.appCertificate, channel, uid, RtcRole.PUBLISHER, 3600, 3600) as string;
}

/**
 * Verified (docs/INTEGRATIONS.md §A1): ConvoAITokenBuilder.buildToken gives ConvoAI + RTC + RTM privileges;
 * its channel must equal properties.channel and its UID must equal properties.agent_rtc_uid. Max lifetime 86400s.
 */
export function agentToken(channel: string) {
  return ConvoAITokenBuilder.buildToken(config.agora.appId, config.agora.appCertificate, channel, String(AGENT_UID), 86400, 86400) as string;
}

/** Verified format: `agora token="<token>"` (quotes included) or `Basic base64(customerId:secret)`. */
export function authHeader(channel: string, token = agentToken(channel)) {
  if (config.agora.customerId && config.agora.customerSecret) {
    return `Basic ${Buffer.from(`${config.agora.customerId}:${config.agora.customerSecret}`).toString("base64")}`;
  }
  return `agora token="${token}"`;
}

/** speak.text is limited to 512 BYTES (not characters). Trim at a sentence/word boundary. */
export function clampUtf8(text: string, maxBytes = 512) {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return text;
  let out = "";
  for (const ch of text) {
    if (enc.encode(out + ch).length > maxBytes - 3) break;
    out += ch;
  }
  const cut = Math.max(out.lastIndexOf(". "), out.lastIndexOf("! "), out.lastIndexOf("? "));
  if (cut > maxBytes / 2) return out.slice(0, cut + 1);
  return `${out.slice(0, out.lastIndexOf(" ")).trimEnd()}…`;
}

async function call(path: string, channel: string, body?: unknown, token?: string) {
  const res = await fetch(`${API}/${config.agora.appId}${path}`, {
    method: "POST",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Authorization: authHeader(channel, token) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`Agora ${path} ${res.status}: ${json.detail ?? json.reason ?? text}`);
  return json;
}

export interface StartAgentOpts {
  channel: string;
  userUid: number;
  greeting: string;
}

/**
 * Start an Agora Conversational AI agent:
 *   Agora ASR  →  our custom LLM endpoint (agent brain: tools + RAG)  →  Murf Falcon TTS
 */
export async function startAgent({ channel, userUid, greeting }: StartAgentOpts) {
  if (!config.publicUrl) throw new Error("PUBLIC_URL is not set — Agora's cloud needs a public HTTPS URL to reach /llm/chat/completions (use ngrok or cloudflared).");
  const token = agentToken(channel); // same token in header and body, per docs
  const body = {
    name: `fieldpilot-${channel}-${Date.now().toString(36)}`,
    properties: {
      channel,
      token,
      agent_rtc_uid: String(AGENT_UID),
      remote_rtc_uids: [String(userUid)],
      idle_timeout: 120,
      advanced_features: { enable_rtm: false },
      asr: { vendor: "ares", language: config.agora.asrLanguage },
      llm: {
        url: `${config.publicUrl}/llm/chat/completions`,
        api_key: config.llmProxySecret,
        vendor: "custom",
        style: "openai",
        system_messages: [],
        max_history: 12,
        greeting_message: greeting,
        failure_message: "Sorry, I hit a snag reaching our systems. Give me a second and try again.",
        params: { model: "fieldpilot-agent" },
      },
      tts: {
        vendor: "murf",
        params: {
          api_key: config.murf.apiKey,
          base_url: "wss://global.api.murf.ai/v1/speech/stream-input",
          voiceId: config.murf.voiceId,
          locale: config.murf.locale,
          model: "FALCON",
          sample_rate: 24000,
        },
      },
      turn_detection: {
        mode: "default",
        config: {
          end_of_speech: { mode: "semantic", semantic_config: { silence_duration_ms: 320, max_wait_ms: 3000 } },
        },
      },
      parameters: { data_channel: "datastream", enable_error_message: true },
    },
  };
  const out = await call("/join", channel, body, token);
  return out as { agent_id: string; create_ts: number; status: string };
}

export async function stopAgent(agentId: string, channel: string) {
  return call(`/agents/${agentId}/leave`, channel); // documented: no request body
}

/** Proactively make the agent say something (e.g. "your PO was approved"). */
/**
 * Documented priorities (INTEGRATIONS §A5): INTERRUPT (cuts off whatever the agent is saying), APPEND (queues
 * after it), IGNORE. Proactive insights use APPEND; only safety-critical ones use INTERRUPT, and those are
 * marked non-interruptable so the warning can't be talked over.
 */
export async function agentSpeak(agentId: string, channel: string, text: string, priority: "APPEND" | "INTERRUPT" = "APPEND") {
  return call(`/agents/${agentId}/speak`, channel, { text: clampUtf8(text), priority, interruptable: priority !== "INTERRUPT" });
}

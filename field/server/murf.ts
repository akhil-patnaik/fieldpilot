import type { Response } from "express";
import { config } from "./config.ts";

/**
 * Murf Falcon streaming TTS proxy (used by Direct mode; Agora mode uses Murf natively inside the agent).
 * Streams MP3 bytes from Murf straight to the browser so playback starts in ~100ms.
 */
export async function streamMurf(text: string, res: Response, voiceId?: string) {
  if (!config.murf.apiKey) {
    res.status(501).json({ error: "MURF_API_KEY not configured" });
    return;
  }
  const upstream = await fetch("https://global.api.murf.ai/v1/speech/stream", {
    method: "POST",
    headers: { "api-key": config.murf.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voiceId: voiceId || config.murf.voiceId,
      locale: config.murf.locale,
      model: config.murf.model,
      format: "MP3",
      sampleRate: 24000,
    }),
  });
  if (!upstream.ok || !upstream.body) {
    // Documented: 400 bad field (e.g. voiceId), 402 quota, 403 bad key (not 401), 429 concurrency (+Retry-After).
    const detail = await upstream.text().catch(() => "");
    console.error("[murf]", upstream.status, detail.slice(0, 300));
    const status = [400, 402, 403, 429].includes(upstream.status) ? upstream.status : 502;
    const retry = upstream.headers.get("retry-after");
    if (retry) res.setHeader("Retry-After", retry);
    res.status(status).json({ error: `Murf ${upstream.status}`, detail: detail.slice(0, 300) });
    return;
  }
  const used = upstream.headers.get("x-murf-concurrency-used");
  const limit = upstream.headers.get("x-murf-concurrency-limit");
  if (used && limit && Number(used) >= Number(limit)) console.warn(`[murf] concurrency at limit ${used}/${limit} (${upstream.headers.get("x-murf-region")})`);
  // Murf documents the body only as "a stream of audio bytes"; we request format MP3 and label it ourselves.
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  const reader = upstream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

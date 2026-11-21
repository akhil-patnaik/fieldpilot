/**
 * Direct mode voice loop (no Agora needed): Browser speech recognition → FieldPilot agent (streamed)
 * → Murf Falcon TTS per sentence (falls back to browser speechSynthesis without a Murf key).
 * Half-duplex: listening pauses while Pilot talks; tap the orb to barge in.
 */
import type { AgentState } from "./types";

interface Callbacks {
  onState: (s: AgentState) => void;
  onInterim: (text: string) => void;
  onLevel: (mic: number) => void;
  onError: (msg: string) => void;
}

type QItem = { text: string; audio?: HTMLAudioElement };

export class DirectVoice {
  private rec: any = null;
  private active = false;
  private busy = false;
  private speaking = false;
  private recRunning = false;
  private queue: QItem[] = [];
  private current: QItem | null = null;
  private abort: AbortController | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  muted = false;

  constructor(private cb: Callbacks, private useMurf: boolean) {}

  get supported() {
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  async start() {
    this.active = true;
    this.initRecognition();
    this.initMeter().catch(() => {});
    const r = await fetch("/api/session/direct/start", { method: "POST" });
    const { greeting } = await r.json();
    this.say(greeting);
  }

  stop() {
    this.active = false;
    this.interruptSpeech();
    this.abort?.abort();
    try {
      this.rec?.abort();
    } catch {}
    this.recRunning = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.cb.onState("idle");
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.pauseListening();
    else this.resumeListening();
  }

  /** Tap-to-talk / barge-in. */
  interrupt() {
    this.abort?.abort();
    this.interruptSpeech();
    this.busy = false;
    this.resumeListening();
  }

  /**
   * Speak a proactive announcement pushed from the server. Non-urgent ones queue politely after whatever is
   * playing (the server already waited for a quiet moment); urgent (safety) ones cut in immediately.
   */
  say(text: string, urgent = false) {
    if (!text) return;
    if (urgent) this.interruptSpeech();
    for (const chunk of splitForSpeech(text)) this.enqueue(chunk);
  }

  /** Is Pilot audible right now (for presence reporting)? */
  get isSpeaking() {
    return this.speaking;
  }

  async send(text: string) {
    this.abort?.abort();
    this.interruptSpeech();
    this.pauseListening();
    this.busy = true;
    this.cb.onState("thinking");
    const ac = new AbortController();
    this.abort = ac;
    let buf = "";
    try {
      const res = await fetch("/api/direct/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ac.signal,
      });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let sse = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse += dec.decode(value, { stream: true });
        const events = sse.split("\n\n");
        sse = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.replace(/^data: /, "");
          if (!line.startsWith("{")) continue;
          const msg = JSON.parse(line);
          if (msg.delta) {
            buf += msg.delta;
            // Flush complete sentences (min length keeps Murf requests efficient).
            const m = buf.match(/^([\s\S]{40,}?[.!?])(\s+|$)/);
            if (m) {
              this.enqueue(m[1].trim());
              buf = buf.slice(m[0].length);
            }
          }
        }
      }
      if (buf.trim()) this.enqueue(buf.trim());
    } catch (e: any) {
      if (e?.name !== "AbortError") this.cb.onError(`Turn failed: ${e?.message ?? e}`);
    } finally {
      if (this.abort === ac) {
        this.busy = false;
        if (!this.speaking && !this.queue.length) {
          this.cb.onState(this.active ? "listening" : "idle");
          this.resumeListening();
        }
      }
    }
  }

  // ───────── speech output ─────────
  private enqueue(text: string) {
    const item: QItem = { text };
    this.queue.push(item);
    if (!this.speaking) this.playNext();
    else this.prefetch();
  }

  private prefetch() {
    const next = this.queue[0];
    if (next && this.useMurf && !next.audio) next.audio = this.makeAudio(next.text);
  }

  private makeAudio(text: string) {
    const a = new Audio(`/api/tts?text=${encodeURIComponent(text)}`);
    a.preload = "auto";
    return a;
  }

  private playNext() {
    const item = this.queue.shift();
    this.current = item ?? null;
    if (!item) {
      this.speaking = false;
      if (!this.busy) {
        this.cb.onState(this.active ? "listening" : "idle");
        this.resumeListening();
      }
      return;
    }
    this.speaking = true;
    this.pauseListening();
    this.cb.onState("speaking");
    const fallback = () => this.synth(item.text, () => this.playNext());
    if (this.useMurf) {
      const a = item.audio ?? this.makeAudio(item.text);
      item.audio = a;
      a.onended = () => this.playNext();
      a.onerror = fallback;
      a.play().catch(fallback);
      this.prefetch();
    } else fallback();
  }

  private synth(text: string, done: () => void) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  private interruptSpeech() {
    this.queue = [];
    if (this.current?.audio) {
      this.current.audio.onended = null;
      this.current.audio.onerror = null;
      this.current.audio.pause();
    }
    speechSynthesis.cancel();
    this.current = null;
    this.speaking = false;
  }

  // ───────── speech input ─────────
  private initRecognition() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      this.cb.onError("Browser speech recognition unavailable — use Chrome/Edge, Agora mode, or type below.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = "";
    let flushTimer: any = null;
    rec.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      this.cb.onInterim((finalText + interim).trim());
      clearTimeout(flushTimer);
      if (finalText.trim() && !interim) {
        // Short grace period so multi-phrase sentences aren't cut off.
        flushTimer = setTimeout(() => {
          const text = finalText.trim();
          finalText = "";
          this.cb.onInterim("");
          if (text) this.send(text);
        }, 650);
      }
    };
    rec.onend = () => {
      this.recRunning = false;
      if (this.active && !this.speaking && !this.busy && !this.muted) this.resumeListening();
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") this.cb.onError("Microphone permission denied.");
    };
    this.rec = rec;
    this.resumeListening();
  }

  private resumeListening() {
    if (!this.rec || !this.active || this.muted || this.recRunning || this.speaking) return;
    try {
      this.rec.start();
      this.recRunning = true;
      this.cb.onState("listening");
    } catch {
      /* already started */
    }
  }

  private pauseListening() {
    if (!this.rec || !this.recRunning) return;
    try {
      this.rec.stop();
    } catch {}
    this.recRunning = false;
  }

  private async initMeter() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(this.stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const data = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      this.cb.onLevel(this.recRunning ? Math.min(1, Math.sqrt(sum / data.length) * 4) : 0);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }
}

function splitForSpeech(text: string) {
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && out[out.length - 1].length < 40) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out;
}

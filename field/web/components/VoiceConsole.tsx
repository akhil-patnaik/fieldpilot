import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneCall, PhoneOff, Send, Headset, Radio, Bot, Sparkles } from "lucide-react";
import type { AgentState, Capabilities, EState, Pending, TranscriptItem } from "../lib/types";
import { ApprovalCards } from "./ApprovalCards";

const ORB: Record<AgentState, { c1: string; c2: string; label: string }> = {
  idle: { c1: "#475569", c2: "#1e293b", label: "Ready" },
  listening: { c1: "#22d3ee", c2: "#0e7490", label: "Listening" },
  thinking: { c1: "#a78bfa", c2: "#5b21b6", label: "Working across systems" },
  speaking: { c1: "#a3e635", c2: "#3f6212", label: "Speaking · Murf Falcon" },
};

/** Hero scenario script — the same flow works spoken or typed. */
export const DEMO_PROMPTS = [
  "Tell me about the St. Brigid's chiller job.",
  "I'm on the roof. RC-2 is locked out on HP-02 and condenser fan two isn't turning.",
  "Can I just jumper the high pressure switch to get it running?",
  "Locked out and verified dead. Fan two capacitor reads 2.1 microfarads, rated 7.5. Motor bearings are rough too.",
  "What do we need, and where can I get it fast?",
  "Hold the capacitors on Lena's truck and order everything per the bulletin.",
  "Yes, go ahead.",
  "Set the ticket to awaiting parts and let the pharmacy know the ETA.",
  "What's the procedure for this fault?",
  "Parts are in and RC-2 is running normally. Wrap up.",
  "Yes, wrap it up.",
  "Yes, do it.",
  "Not now.",
];

interface Props {
  caps: Capabilities | null;
  inCall: "agora" | "direct" | null;
  connecting: boolean;
  state: AgentState;
  level: number;
  interim: string;
  muted: boolean;
  transcript: TranscriptItem[];
  pending: Pending[];
  error: string | null;
  onStart: (mode: "agora" | "direct") => void;
  onStop: () => void;
  onMute: () => void;
  onOrb: () => void;
  onSend: (text: string) => void;
  onDecide: (id: string, d: "approve" | "reject") => void;
  onManager: (poId: string, d: "approve" | "reject") => void;
  estate: EState | null;
}

export function VoiceConsole(p: Props) {
  const [text, setText] = useState("");
  const [usedPrompts, setUsed] = useState<number>(0);
  const scroller = useRef<HTMLDivElement>(null);
  const orb = ORB[p.state];

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [p.transcript, p.interim]);

  const submit = (t: string) => {
    if (!t.trim()) return;
    p.onSend(t.trim());
    setText("");
  };

  return (
    <section className="panel flex h-[calc(100svh-24px)] min-h-0 flex-col overflow-hidden lg:h-auto">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <div className="panel-title flex items-center gap-2">
          <Headset size={13} /> Technician voice line
        </div>
        {p.inCall && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> LIVE · {p.inCall === "agora" ? "Agora RTC" : "Direct"}
          </span>
        )}
      </div>

      {/* Orb */}
      <div className="flex flex-col items-center gap-3 px-4 pt-5 pb-3">
        <button
          className="orb"
          data-state={p.state}
          onClick={p.onOrb}
          title={p.inCall === "direct" ? "Tap to interrupt / talk" : ""}
          style={{ ["--c1" as any]: orb.c1, ["--c2" as any]: orb.c2, transform: `scale(${1 + Math.min(p.level, 1) * 0.12})` }}
        >
          <span className="orb-ring" />
          <span className="orb-ring" style={{ animationDelay: ".4s" }} />
          <span className="orb-core grid place-items-center">
            {p.state === "thinking" ? <Sparkles className="text-white/80" /> : p.state === "speaking" ? <Bot className="text-white/80" /> : <Mic className="text-white/70" />}
          </span>
        </button>
        <div className="h-5 text-xs font-medium text-slate-300">{p.inCall ? orb.label : "Start a call to talk to Pilot"}</div>

        {!p.inCall ? (
          <div className="grid w-full grid-cols-2 gap-2">
            <button
              disabled={p.connecting || !p.caps?.agora}
              onClick={() => p.onStart("agora")}
              title={p.caps?.agoraReachable ? "" : "Needs AGORA_APP_ID, AGORA_APP_CERTIFICATE and PUBLIC_URL"}
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-400 px-3 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Radio size={16} /> Agora voice
            </button>
            <button
              disabled={p.connecting}
              onClick={() => p.onStart("direct")}
              className="flex items-center justify-center gap-2 rounded-xl border border-lime-400/40 bg-lime-400/10 px-3 py-2.5 text-sm font-semibold text-lime-200 transition hover:bg-lime-400/20 disabled:opacity-40"
            >
              <PhoneCall size={16} /> Direct voice
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={p.onMute} className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition ${p.muted ? "border-amber-400/40 bg-amber-400/10 text-amber-200" : "border-white/10 text-slate-300 hover:bg-white/5"}`}>
              {p.muted ? <MicOff size={16} /> : <Mic size={16} />} {p.muted ? "Unmute" : "Mute"}
            </button>
            <button onClick={p.onStop} className="flex items-center gap-2 rounded-xl bg-rose-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500">
              <PhoneOff size={16} /> End
            </button>
          </div>
        )}
        {p.connecting && <div className="text-[11px] text-cyan-300">Spinning up agent…</div>}
        {p.error && <div className="w-full rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{p.error}</div>}
      </div>

      {/* Transcript */}
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {p.transcript.length === 0 && (
          <div className="mt-6 text-center text-xs leading-relaxed text-slate-500">
            Hands-free. Eyes on the equipment.
            <br />
            Pilot briefs you, diagnoses with manuals + live sensors,
            <br />
            orders parts, escalates, schedules and writes the report.
          </div>
        )}
        {p.transcript.map((t) => (
          <div key={t.id} className={`enter flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                t.role === "user"
                  ? "rounded-br-sm bg-cyan-500/15 text-cyan-50"
                  : t.source === "push"
                    ? "rounded-bl-sm border border-lime-400/30 bg-lime-400/10 text-lime-50"
                    : "rounded-bl-sm bg-white/[0.05] text-slate-100"
              }`}
            >
              {t.source === "push" && <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-lime-300 uppercase">Proactive update</div>}
              {t.text}
              {!t.final && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-slate-400 align-middle" />}
            </div>
          </div>
        ))}
        {p.interim && (
          <div className="flex justify-end">
            <div className="max-w-[88%] rounded-2xl rounded-br-sm border border-dashed border-cyan-400/30 px-3.5 py-2 text-[13px] text-cyan-200/70 italic">{p.interim}…</div>
          </div>
        )}
      </div>

      {/* Human-in-the-loop: technician confirmations + manager approvals */}
      <ApprovalCards pending={p.pending} estate={p.estate} onDecide={p.onDecide} onManager={p.onManager} />

      {/* Input + script (phones use the pinned MobileBar instead) */}
      <div className="hidden border-t border-white/5 px-3 pt-2 pb-3 lg:block">
        <div className="scroll-thin mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {DEMO_PROMPTS.map((q, i) => (
            <button
              key={q}
              onClick={() => {
                submit(q);
                setUsed(Math.max(usedPrompts, i + 1));
              }}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition ${i === usedPrompts ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200" : "border-white/10 text-slate-400 hover:bg-white/5"}`}
            >
              {i + 1}. {q.length > 38 ? `${q.slice(0, 36)}…` : q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="flex gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={p.inCall ? "Speak, or type here…" : "Type to Pilot (or start a call)…"}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
          />
          <button className="grid w-10 place-items-center rounded-xl bg-white/10 text-slate-200 hover:bg-white/15">
            <Send size={15} />
          </button>
        </form>
      </div>
    </section>
  );
}

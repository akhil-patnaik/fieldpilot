import { useState } from "react";
import { Mic, PhoneOff, Send, Hand } from "lucide-react";
import type { AgentState } from "../lib/types";

/** Phones: a big thumb-reachable mic button + text fallback, pinned to the bottom of the screen. */
export function MobileBar({ inCall, state, connecting, onStart, onStop, onTalk, onSend }: { inCall: boolean; state: AgentState; connecting: boolean; onStart: () => void; onStop: () => void; onTalk: () => void; onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  const label = connecting ? "Connecting…" : !inCall ? "Tap to talk to Pilot" : state === "speaking" ? "Tap to interrupt" : state === "thinking" ? "Working…" : "Listening";
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <div className="flex items-center gap-3">
        <button
          onClick={inCall ? onTalk : onStart}
          disabled={connecting}
          aria-label={label}
          className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-full text-slate-950 shadow-xl transition active:scale-95 ${inCall ? (state === "speaking" ? "bg-lime-400 shadow-lime-500/30" : "bg-cyan-400 shadow-cyan-500/30") : "bg-gradient-to-br from-cyan-400 to-lime-400 shadow-cyan-500/20"}`}
        >
          {inCall && state === "listening" && <span className="absolute inset-0 animate-ping rounded-full bg-cyan-400/40" />}
          {inCall && state === "speaking" ? <Hand size={26} /> : <Mic size={28} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-slate-300">
            {label}
            {inCall && (
              <button onClick={onStop} className="ml-auto inline-flex items-center gap-1 rounded-full bg-rose-500/90 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                <PhoneOff size={11} /> End
              </button>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) onSend(text.trim());
              setText("");
            }}
            className="flex gap-1.5"
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Or type to Pilot…"
              aria-label="Message Pilot"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-900 px-3 py-2 text-[15px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
            />
            <button aria-label="Send" className="grid w-11 place-items-center rounded-xl bg-white/10 text-slate-200">
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { ScrollText, Send, CheckCircle2, Circle, Megaphone, Eye, Sparkles, Zap } from "lucide-react";
import { Drawer } from "./Drawer";
import { DEMO_EXTRAS, DEMO_STEPS, type DemoAction, type DemoStep } from "../lib/demoScript";

/** Presenter's script: what to narrate, what to say to Pilot (click to send), what to click, what to point at. */
export function DemoDrawer({ open, onClose, onSay, onAction, onReset }: { open: boolean; onClose: () => void; onSay: (text: string) => void; onAction: (a: DemoAction) => void; onReset: () => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const mark = (k: string) => setDone((d) => new Set(d).add(k));
  const card = (s: DemoStep, i: number, prefix: string) => {
    const key = `${prefix}${i}`;
    const isDone = done.has(key);
    return (
      <li key={key} className={`rounded-xl border p-3 ${isDone ? "border-emerald-400/25 bg-emerald-400/[0.04] opacity-70" : "border-white/10 bg-white/[0.02]"}`}>
        <div className="flex items-center gap-2">
          <button onClick={() => setDone((d) => { const n = new Set(d); if (n.has(key)) n.delete(key); else n.add(key); return n; })} aria-label="Mark done">
            {isDone ? <CheckCircle2 size={16} className="text-emerald-400" /> : <Circle size={16} className="text-slate-500" />}
          </button>
          <span className="font-mono text-[10.5px] text-slate-500">{s.time}</span>
          <span className="text-[13px] font-semibold text-slate-100">{s.title}</span>
        </div>
        <div className="mt-2 space-y-1.5 pl-6 text-[12px]">
          <p className="flex gap-1.5 text-slate-300">
            <Megaphone size={13} className="mt-0.5 shrink-0 text-violet-300" />
            <span className="italic">“{s.narrate}”</span>
          </p>
          {s.actions?.map((a) => (
            <button key={a.label} onClick={() => (onAction(a.action), mark(key))} className="mr-1.5 inline-flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11.5px] font-medium text-amber-200 hover:bg-amber-400/20">
              <Zap size={12} /> {a.label}
            </button>
          ))}
          {s.say?.map((line) => (
            <button key={line} onClick={() => (onSay(line), mark(key))} className="group flex w-full items-start gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.06] px-2.5 py-1.5 text-left text-cyan-100 hover:bg-cyan-400/[0.12]">
              <Send size={12} className="mt-0.5 shrink-0 text-cyan-300" />
              <span>
                <span className="mr-1 text-[10px] font-semibold tracking-wide text-cyan-300 uppercase">Say</span>“{line}”
              </span>
            </button>
          ))}
          <p className="flex gap-1.5 text-slate-400">
            <Eye size={13} className="mt-0.5 shrink-0" /> {s.point}
          </p>
          <p className="flex gap-1.5 text-slate-400">
            <Sparkles size={13} className="mt-0.5 shrink-0 text-lime-300" /> {s.expect}
          </p>
        </div>
      </li>
    );
  };
  return (
    <Drawer open={open} onClose={onClose} title="Demo script · 3–4 min" icon={<ScrollText size={16} className="text-violet-300" />}>
      <div className="mb-3 flex items-center gap-2 text-[12px] text-slate-400">
        Speak the lines, or click one to send it as text (mic fallback).
        <button onClick={() => (setDone(new Set()), onReset())} className="ml-auto rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/5">
          Reset demo + script
        </button>
      </div>
      <ol className="space-y-2">{DEMO_STEPS.map((s, i) => card(s, i, "m"))}</ol>
      <div className="panel-title mt-5 mb-2">Encores (if time allows)</div>
      <ol className="space-y-2">{DEMO_EXTRAS.map((s, i) => card(s, i, "x"))}</ol>
    </Drawer>
  );
}

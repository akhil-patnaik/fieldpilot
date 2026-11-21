import { useEffect, useRef, useState } from "react";
import { PlaneTakeoff, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Loader2, Mic, RefreshCw, LifeBuoy } from "lucide-react";
import { Drawer } from "./Drawer";

interface Check {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
  ms?: number;
}
const ICON = {
  pass: <CheckCircle2 size={16} className="text-emerald-400" />,
  warn: <AlertTriangle size={16} className="text-amber-300" />,
  fail: <XCircle size={16} className="text-rose-400" />,
  skip: <MinusCircle size={16} className="text-slate-500" />,
};

/** Pre-flight: live server checks + in-browser checks (mic permission, speech recognition, secure context). */
export function PreflightPanel({ open, onClose, backup, onBackup }: { open: boolean; onClose: () => void; backup: boolean; onBackup: (on: boolean) => void }) {
  const [server, setServer] = useState<{ checks: Check[]; verdict: string; latency: Record<string, number> } | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mic, setMic] = useState<{ state: string; level: number; testing: boolean }>({ state: "unknown", level: 0, testing: false });
  const stopMic = useRef<() => void>(() => {});

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const r = await fetch("/api/preflight");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setServer(await r.json());
    } catch (e: any) {
      setErr(`Server unreachable: ${e.message}. Is \`npm run dev\` running?`);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    run();
    (navigator.permissions as any)
      ?.query({ name: "microphone" })
      .then((p: PermissionStatus) => setMic((m) => ({ ...m, state: p.state })))
      .catch(() => setMic((m) => ({ ...m, state: "unsupported" })));
    return () => stopMic.current();
  }, [open]);

  const testMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.fftSize);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setMic((m) => ({ ...m, state: "granted", testing: true, level: Math.min(1, Math.sqrt(sum / data.length) * 5) }));
        raf = requestAnimationFrame(tick);
      };
      tick();
      stopMic.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        setMic((m) => ({ ...m, testing: false, level: 0 }));
      };
      setTimeout(() => stopMic.current(), 6000);
    } catch (e: any) {
      setMic((m) => ({ ...m, state: e?.name === "NotAllowedError" ? "denied" : `error: ${e?.message}` }));
    }
  };

  const browser: Check[] = [
    { id: "secure", label: "Secure context (mic needs https or localhost)", status: window.isSecureContext ? "pass" : "fail", detail: window.isSecureContext ? location.origin : "Open the app on localhost or https." },
    { id: "mic", label: "Microphone permission", status: mic.state === "granted" ? "pass" : mic.state === "denied" ? "fail" : "warn", detail: mic.state === "granted" ? "Allowed." : mic.state === "denied" ? "Blocked — allow the mic in the browser's site settings." : `State: ${mic.state}. Click "Test mic" to grant it.` },
    { id: "asr", label: "Browser speech recognition (Direct voice)", status: (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition ? "pass" : "warn", detail: (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition ? "Available." : "Not in this browser (use Chrome/Edge); Agora voice and text still work." },
  ];

  return (
    <Drawer open={open} onClose={onClose} title="Pre-flight check" icon={<PlaneTakeoff size={16} className="text-cyan-300" />}>
      <div className="space-y-4">
        <div className={`rounded-xl border px-4 py-3 ${server?.verdict.startsWith("Ready: full") ? "border-emerald-400/40 bg-emerald-400/10" : server?.verdict.startsWith("Not ready") ? "border-rose-400/40 bg-rose-500/10" : "border-amber-400/30 bg-amber-400/10"}`}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{running && !server ? "Running checks…" : (server?.verdict ?? "—")}</span>
            <button onClick={run} disabled={running} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/5 disabled:opacity-50">
              {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-run
            </button>
          </div>
          {server && Object.keys(server.latency).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-[11px] text-slate-300">
              {Object.entries(server.latency).map(([k, v]) => (
                <span key={k}>
                  {k} <b className="text-slate-100">{v} ms</b>
                </span>
              ))}
            </div>
          )}
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{err}</div>}

        <div className="panel flex items-center gap-3 p-3">
          <LifeBuoy size={18} className={backup ? "text-amber-300" : "text-slate-500"} />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-slate-100">Backup brain {backup ? "ON" : "off"}</div>
            <div className="text-[11px] text-slate-400">Scripted, offline agent that follows the demo story. Same tools, gate, Watchtower and UI. Turn it on if the LLM or the network fails.</div>
          </div>
          <button onClick={() => onBackup(!backup)} className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ${backup ? "bg-amber-400 text-slate-950" : "border border-white/15 text-slate-200 hover:bg-white/5"}`}>
            {backup ? "Turn off" : "Turn on"}
          </button>
        </div>

        <section>
          <div className="panel-title mb-2">Server &amp; integrations</div>
          <div className="space-y-1.5">
            {(server?.checks ?? []).map((c) => (
              <Row key={c.id} c={c} />
            ))}
            {!server && running && [0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-11 rounded-lg border border-white/5" />)}
          </div>
        </section>
        <section>
          <div className="mb-2 flex items-center">
            <div className="panel-title">This browser</div>
            <button onClick={testMic} disabled={mic.testing} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/5">
              <Mic size={12} /> {mic.testing ? "Listening… speak now" : "Test mic"}
            </button>
          </div>
          {mic.testing && (
            <div className="mb-2 h-2 overflow-hidden rounded bg-white/5">
              <div className="h-full bg-lime-400 transition-[width] duration-75" style={{ width: `${Math.round(mic.level * 100)}%` }} />
            </div>
          )}
          <div className="space-y-1.5">
            {browser.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </div>
        </section>
      </div>
    </Drawer>
  );
}

function Row({ c }: { c: Check }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <span className="mt-0.5">{ICON[c.status]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12.5px] font-medium text-slate-100">
          {c.label}
          {c.ms != null && <span className="ml-auto font-mono text-[10.5px] text-slate-400">{c.ms} ms</span>}
        </div>
        <div className="text-[11px] leading-snug text-slate-400">{c.detail}</div>
      </div>
    </div>
  );
}

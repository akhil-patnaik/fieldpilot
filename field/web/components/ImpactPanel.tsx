import { useEffect, useState } from "react";
import { TrendingUp, Info, Loader2 } from "lucide-react";
import { Drawer } from "./Drawer";

interface Metric {
  id: string;
  label: string;
  value: string | null;
  basis: "measured" | "computed" | "modelled" | "estimated";
  detail: string;
  baseline: string | null;
  assumption?: string;
  delta?: string;
}
interface Impact {
  generatedAt: string;
  session: { startedAt: string; mode: string };
  metrics: Metric[];
  assumptions: { id: string; text: string }[];
  manualMinutesTable: { tool: string; label: string; minutes: number }[];
}

const BASIS: Record<Metric["basis"], { cls: string; text: string }> = {
  measured: { cls: "bg-emerald-400/15 text-emerald-300", text: "measured" },
  computed: { cls: "bg-sky-400/15 text-sky-300", text: "computed from ERP data" },
  modelled: { cls: "bg-violet-400/15 text-violet-300", text: "modelled" },
  estimated: { cls: "bg-amber-400/15 text-amber-300", text: "estimated" },
};

/** Baseline vs FieldPilot, from THIS session's real records. Baselines are assumptions and are labelled so. */
export function ImpactPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Impact | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      fetch("/api/impact")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => alive && (setData(j), setErr(null)))
        .catch((e) => alive && setErr(String(e.message ?? e)));
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);

  return (
    <Drawer open={open} onClose={onClose} title="Impact — this session" icon={<TrendingUp size={16} className="text-lime-300" />} width="max-w-3xl">
      {!data && !err && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Computing from this session's records…
        </div>
      )}
      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">Couldn't load impact data: {err}</div>}
      {data && (
        <div className="space-y-5">
          <p className="text-[12px] leading-relaxed text-slate-400">
            Every number below comes from this session's real records (audit log, ERP, calendar, Watchtower) since {new Date(data.session.startedAt).toLocaleTimeString()}. Each value is tagged with how it was obtained. <b className="text-amber-300">Every baseline is an assumption</b>, listed at the bottom. Metrics with nothing to measure yet say so.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.metrics.map((m) => (
              <div key={m.id} className="panel p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[12px] font-semibold text-slate-300">{m.label}</div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide uppercase ${BASIS[m.basis].cls}`}>{BASIS[m.basis].text}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[9.5px] tracking-wider text-slate-500 uppercase">FieldPilot</div>
                    <div className={`font-mono text-lg leading-tight font-bold ${m.value ? "text-lime-200" : "text-slate-600"}`}>{m.value ?? "not measured yet"}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] tracking-wider text-slate-500 uppercase">Baseline</div>
                    {m.baseline ? (
                      <div className="font-mono text-lg leading-tight font-bold text-slate-300">
                        {m.baseline}
                        {m.assumption && <span className="ml-1.5 rounded bg-amber-400/15 px-1 align-middle text-[9.5px] font-bold text-amber-300">assumption {m.assumption}</span>}
                      </div>
                    ) : (
                      <div className="text-[12px] text-slate-600">—</div>
                    )}
                  </div>
                </div>
                {m.delta && m.value && <div className="mt-1.5 text-[11px] font-medium text-emerald-300">{m.delta}</div>}
                <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{m.detail}</p>
              </div>
            ))}
          </div>
          <div className="panel p-4">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-amber-300">
              <Info size={13} /> Assumptions behind the baselines
            </div>
            <ol className="space-y-1.5">
              {data.assumptions.map((a) => (
                <li key={a.id} className="text-[11.5px] leading-snug text-slate-300">
                  <span className="mr-1.5 font-mono font-bold text-amber-300">{a.id}</span>
                  {a.text}
                </li>
              ))}
            </ol>
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-slate-400">A3 — manual minutes per task (estimates)</summary>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                {data.manualMinutesTable.map((r) => (
                  <div key={r.tool} className="flex justify-between gap-2 text-[10.5px]">
                    <span className="truncate text-slate-400">{r.label}</span>
                    <span className="font-mono text-slate-300">{r.minutes} min</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      )}
    </Drawer>
  );
}

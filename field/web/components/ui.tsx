import { useEffect, useState, type ReactNode } from "react";

export const SYSTEM_STYLE: Record<string, { color: string; bg: string; name: string }> = {
  FSM: { color: "text-cyan-300", bg: "bg-cyan-400/10 border-cyan-400/30", name: "Field Service (FSM)" },
  CMMS: { color: "text-sky-300", bg: "bg-sky-400/10 border-sky-400/30", name: "Maintenance (CMMS)" },
  IoT: { color: "text-lime-300", bg: "bg-lime-400/10 border-lime-400/30", name: "IoT / BMS" },
  Knowledge: { color: "text-violet-300", bg: "bg-violet-400/10 border-violet-400/30", name: "Knowledge (RAG)" },
  ERP: { color: "text-amber-300", bg: "bg-amber-400/10 border-amber-400/30", name: "ERP / Inventory" },
  Calendar: { color: "text-pink-300", bg: "bg-pink-400/10 border-pink-400/30", name: "Scheduling" },
  Notify: { color: "text-emerald-300", bg: "bg-emerald-400/10 border-emerald-400/30", name: "Notifications" },
  Guardrail: { color: "text-rose-300", bg: "bg-rose-400/10 border-rose-400/30", name: "Guardrail" },
  Watchtower: { color: "text-cyan-200", bg: "bg-cyan-300/10 border-cyan-300/40", name: "Watchtower" },
};

export function SystemBadge({ system }: { system: string }) {
  const s = SYSTEM_STYLE[system] ?? SYSTEM_STYLE.FSM;
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${s.bg} ${s.color}`}>{system}</span>;
}

const PILL: Record<string, string> = {
  P1: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  P2: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  P3: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  CRITICAL: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  WARN: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  OK: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  RESOLVED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  DISPATCHED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  ACKNOWLEDGED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  PENDING_MANAGER_APPROVAL: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  AWAITING_PARTS: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  OPEN: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  SEV1: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  SEV2: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  SEV3: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export function Pill({ v, children }: { v: string; children?: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${PILL[v] ?? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"}`}>
      {children ?? v.replaceAll("_", " ")}
    </span>
  );
}

export function Sparkline({ data, status }: { data: number[]; status: string }) {
  if (data.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(" ");
  const color = status === "CRITICAL" ? "#fb7185" : status === "WARN" ? "#fbbf24" : "#34d399";
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.8" fill={color} />
    </svg>
  );
}

export const timeAgo = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export function slaLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  const m = Math.round(Math.abs(ms) / 60000);
  const txt = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  return { txt: ms < 0 ? `-${txt}` : txt, urgent: ms < 3 * 3600000 };
}

export function RiskBadge({ risk }: { risk?: "low" | "medium" | "high" }) {
  if (!risk || risk === "low") return null;
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide uppercase ${risk === "high" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>
      {risk} risk
    </span>
  );
}

/** Live hh:mm:ss countdown to an ISO deadline. */
export function useCountdown(iso?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return { text: "--:--:--", ms: 0 };
  const ms = new Date(iso).getTime() - now;
  const a = Math.abs(ms);
  const h = Math.floor(a / 3600000);
  const m = Math.floor((a % 3600000) / 60000);
  const sec = Math.floor((a % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { text: `${ms < 0 ? "-" : ""}${pad(h)}:${pad(m)}:${pad(sec)}`, ms };
}

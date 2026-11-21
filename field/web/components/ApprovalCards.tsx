import { ShieldCheck, Check, X, UserCheck } from "lucide-react";
import type { EState, Pending } from "../lib/types";

/**
 * Two kinds of human-in-the-loop cards:
 *  1. Technician confirmation for a PENDING critical write (voice "yes" or tap).
 *  2. Manager approval for a PO over the approval limit (manager taps, or says "This is Dana, approved").
 */
export function ApprovalCards({ pending, estate, onDecide, onManager }: { pending: Pending[]; estate: EState | null; onDecide: (id: string, d: "approve" | "reject") => void; onManager: (poId: string, d: "approve" | "reject") => void }) {
  const mgrPOs = estate?.purchaseOrders.filter((p) => p.status === "PENDING_MANAGER_APPROVAL") ?? [];
  if (!pending.length && !mgrPOs.length) return null;
  const mgr = estate?.technician.manager.name ?? "Manager";
  return (
    <div className="space-y-2 border-t border-white/5 px-3 py-3">
      {pending.map((a) => (
        <div key={a.id} className={`enter rounded-xl border p-3 ${a.risk === "HIGH" ? "border-amber-400/40 bg-amber-400/[0.07]" : "border-cyan-400/30 bg-cyan-400/[0.06]"}`}>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-amber-200">
            <ShieldCheck size={13} /> Needs your confirmation
            <span className="ml-auto font-mono text-[10px] text-slate-400">{a.id}</span>
          </div>
          <div className="text-[12px] leading-snug text-slate-100">{a.summary}</div>
          {(a.costUsd !== undefined || a.etaMinutes !== undefined) && (
            <div className="mt-2 flex gap-2">
              {a.costUsd !== undefined && (
                <div className="rounded-lg bg-black/25 px-2.5 py-1">
                  <div className="text-[9px] tracking-wider text-slate-500 uppercase">Cost</div>
                  <div className="font-mono text-sm font-semibold text-amber-200">${a.costUsd}</div>
                </div>
              )}
              {a.etaMinutes !== undefined && (
                <div className="rounded-lg bg-black/25 px-2.5 py-1">
                  <div className="text-[9px] tracking-wider text-slate-500 uppercase">ETA</div>
                  <div className="font-mono text-sm font-semibold text-slate-100">{a.etaMinutes} min</div>
                </div>
              )}
            </div>
          )}
          <div className="mt-2 grid grid-cols-1 gap-y-0.5">
            {a.details
              .filter((d) => !["Total", "ETA"].includes(d.label))
              .map((d) => (
                <div key={d.label} className="flex justify-between gap-2 text-[10.5px]">
                  <span className="truncate text-slate-500">{d.label}</span>
                  <span className="truncate font-mono text-slate-300">{d.value}</span>
                </div>
              ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button onClick={() => onDecide(a.id, "approve")} className="flex items-center gap-1 rounded-lg bg-emerald-500/90 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
              <Check size={13} /> Approve
            </button>
            <button onClick={() => onDecide(a.id, "reject")} className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5">
              <X size={13} /> Reject
            </button>
            <span className="ml-auto text-[10px] text-slate-500">or say "yes, go ahead"</span>
          </div>
        </div>
      ))}
      {mgrPOs.map((po) => (
        <div key={po.id} className="enter rounded-xl border border-violet-400/40 bg-violet-500/[0.08] p-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-violet-200">
            <UserCheck size={13} /> Manager approval · {mgr}
            <span className="ml-auto font-mono text-[10px] text-slate-400">{po.id}</span>
          </div>
          <div className="text-[12px] leading-snug text-slate-100">
            {po.lines.map((l) => `${l.qty} × ${l.partNumber}`).join(" + ")} for {po.ticketId}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-base font-bold text-violet-100">${po.totalUsd}</span>
            <span className="text-[10.5px] text-slate-400">over ${estate?.approvalLimitUsd ?? 750} limit · ETA {po.delivery.etaMinutes} min</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button onClick={() => onManager(po.id, "approve")} className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-400">
              <Check size={13} /> Approve as {mgr.split(" ")[0]}
            </button>
            <button onClick={() => onManager(po.id, "reject")} className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5">
              <X size={13} /> Reject
            </button>
            <span className="ml-auto text-[10px] text-slate-500">or "This is {mgr.split(" ")[0]}, approved"</span>
          </div>
        </div>
      ))}
    </div>
  );
}

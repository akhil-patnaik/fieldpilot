import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/** Slide-over panel (Esc or backdrop click to close). Full-screen on phones. */
export function Drawer({ open, title, icon, onClose, children, width = "max-w-2xl" }: { open: boolean; title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" className="drawer-backdrop absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <aside role="dialog" aria-label={title} className={`drawer-panel relative flex h-full w-full ${width} flex-col border-l border-white/10 bg-ink-900 shadow-2xl`}>
        <header className="flex items-center gap-2 border-b border-white/10 px-5 py-3.5">
          {icon}
          <h2 className="text-sm font-bold tracking-wide text-slate-100">{title}</h2>
          <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-slate-100" aria-label="Close panel">
            <X size={16} />
          </button>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

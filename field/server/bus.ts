import type { Response } from "express";

/** Server → browser event stream (SSE). Every UI panel is driven from here. */
export type UiEvent =
  | { type: "state"; changed: string[]; highlight: string[] }
  | { type: "transcript"; id: string; role: "user" | "assistant" | "system"; text: string; final: boolean; source: "agora" | "direct" | "push" }
  | {
      type: "tool";
      id: string;
      phase: "start" | "end" | "retry";
      name: string;
      label: string;
      system: string;
      args: unknown;
      result?: unknown;
      ok?: boolean;
      ms?: number;
      retries?: number;
      risk?: "low" | "medium" | "high";
      /** phase "retry": which attempt failed, why, and the backoff before the next one */
      attempt?: number;
      error?: string;
      backoffMs?: number;
    }
  | { type: "systems"; health: Record<string, "ok" | "busy" | "degraded" | "down"> }
  | { type: "chaos"; chaos: unknown }
  | { type: "insights"; insights: unknown[]; stats: unknown }
  | { type: "sim"; sim: unknown }
  | { type: "agent_state"; state: "idle" | "listening" | "thinking" | "speaking" }
  | { type: "pending"; pending: unknown[] }
  | { type: "metrics"; metrics: unknown }
  | { type: "announce"; text: string; urgent?: boolean; insightId?: string }
  | { type: "stage"; stage: "before" | "during" | "action" | "after" }
  | { type: "session"; session: unknown }
  | { type: "error"; message: string };

const clients = new Set<Response>();
const listeners = new Set<(e: UiEvent) => void>();

/** In-process subscription (used by tests and server-side hooks). Returns an unsubscribe fn. */
export function onEvent(fn: (e: UiEvent) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const history: UiEvent[] = [];

export function attachSse(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 1500\n\n`);
  // Replay recent transcript + tool events so a refreshed browser catches up.
  for (const e of history) res.write(`data: ${JSON.stringify(e)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
  res.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function emit(e: UiEvent) {
  if (e.type === "transcript" || e.type === "tool" || e.type === "stage") {
    // Keep only finalized transcript items in replay history.
    if (e.type !== "transcript" || e.final) {
      history.push(e);
      if (history.length > 400) history.splice(0, history.length - 400);
    }
  }
  for (const l of listeners) l(e);
  const payload = `data: ${JSON.stringify(e)}\n\n`;
  for (const c of clients) c.write(payload);
}

export function clearHistory() {
  history.length = 0;
}

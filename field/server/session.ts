import type OpenAI from "openai";
import { emit } from "./bus.ts";

export type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Stage = "before" | "during" | "action" | "after";

export interface PendingAction {
  id: string;
  tool: string;
  args: Record<string, any>;
  summary: string;
  /** Exact sentence the agent must read back before asking "Shall I go ahead?" */
  readback: string;
  details: { label: string; value: string }[];
  costUsd?: number;
  etaMinutes?: number;
  createdTurn: number;
  createdAt: string;
  risk: "MEDIUM" | "HIGH";
  origin: "agent" | "mcp" | "ui";
}

export interface Session {
  id: string;
  mode: "agora" | "direct";
  startedAt: number;
  channel?: string;
  agentId?: string;
  userUid?: number;
  messages: ChatMsg[];
  pending: PendingAction[];
  turn: number;
  activeTicketId?: string;
  stage: Stage;
  abort?: AbortController;
  /** Latest technician utterance — the explicit-yes check reads this, never the model's claim. */
  lastUserText: string;
  /** Evidence gathered per asset before a diagnosis may be recorded. */
  evidence: Record<string, { telemetry?: boolean; history?: boolean }>;
  /** A real conversation is happening (a call was started or the technician spoke/typed). Watchtower only speaks into live sessions. */
  live: boolean;
  /** True while the agent is processing/answering a turn — proactive speech must wait. */
  turnActive: boolean;
  /** Last time the technician spoke or typed (ms). */
  lastUserActivityAt: number;
  /** Who is audible right now, reported by the client (mic level / TTS playback). */
  presence: { userSpeaking: boolean; agentSpeaking: boolean; at: number };
  /** Knowledge sources retrieved during the visit, cited in the service report. */
  citations: { cite: string; docId: string; section?: string; title: string; ticketId?: string; at: string }[];
  /** First time each ticket was worked this session (time-on-site fallback when ON_SITE wasn't set). */
  ticketFirstSeen: Record<string, string>;
  /** Safety rule matched on the current turn (set by the deterministic guard). */
  safetyAlert?: import("./safety.ts").SafetyHit;
  metrics: {
    turns: number;
    toolCalls: number;
    actionsExecuted: number;
    systems: Record<string, number>;
    manualMinutesSaved: number;
    toolLatencyMs: number[];
    firstTokenMs: number[];
    retriesRecovered: number;
    confirmationsRequested: number;
  };
}

let current: Session = fresh("direct");

function fresh(mode: Session["mode"]): Session {
  return {
    id: `sess_${Date.now().toString(36)}`,
    mode,
    startedAt: Date.now(),
    messages: [],
    pending: [],
    turn: 0,
    stage: "before",
    lastUserText: "",
    evidence: {},
    citations: [],
    ticketFirstSeen: {},
    live: false,
    turnActive: false,
    lastUserActivityAt: 0,
    presence: { userSpeaking: false, agentSpeaking: false, at: 0 },
    metrics: {
      turns: 0,
      toolCalls: 0,
      actionsExecuted: 0,
      systems: {},
      manualMinutesSaved: 0,
      toolLatencyMs: [],
      firstTokenMs: [],
      retriesRecovered: 0,
      confirmationsRequested: 0,
    },
  };
}

export const sessions = {
  current: () => current,
  start(mode: Session["mode"], extra: Partial<Session> = {}) {
    current.abort?.abort();
    current = { ...fresh(mode), ...extra };
    emitSession();
    emitMetrics();
    emit({ type: "pending", pending: [] });
    return current;
  },
};

export function publicSession(s = current) {
  return {
    id: s.id,
    mode: s.mode,
    startedAt: s.startedAt,
    channel: s.channel,
    agentId: s.agentId,
    turn: s.turn,
    activeTicketId: s.activeTicketId,
    stage: s.stage,
  };
}

export function emitSession() {
  emit({ type: "session", session: publicSession() });
}

let metricsExtension: () => Record<string, unknown> = () => ({});
/** Let other modules (Watchtower) contribute metrics without a circular import. */
export const setMetricsExtension = (fn: () => Record<string, unknown>) => (metricsExtension = fn);

export function metricsView(s = current) {
  const m = s.metrics;
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  return {
    ...metricsExtension(),
    turns: m.turns,
    toolCalls: m.toolCalls,
    actionsExecuted: m.actionsExecuted,
    systemsTouched: Object.keys(m.systems).filter((k) => k !== "Guardrail").length,
    systems: m.systems,
    manualMinutesSaved: Math.round(m.manualMinutesSaved),
    avgToolLatencyMs: avg(m.toolLatencyMs),
    avgFirstTokenMs: avg(m.firstTokenMs),
    retriesRecovered: m.retriesRecovered,
    confirmationsRequested: m.confirmationsRequested,
    sessionSeconds: Math.round((Date.now() - s.startedAt) / 1000),
  };
}

export function emitMetrics() {
  emit({ type: "metrics", metrics: metricsView() });
}

export function setStage(stage: Stage) {
  if (current.stage === stage) return;
  current.stage = stage;
  emit({ type: "stage", stage });
  emitSession();
}

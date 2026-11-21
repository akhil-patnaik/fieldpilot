import { useEffect, useReducer, useRef, useState } from "react";
import type { AgentState, Chaos, EState, Health, Insight, InsightStats, Metrics, Pending, SessionInfo, SimState, Stage, ToolEvent, TranscriptItem } from "./types";

interface LiveState {
  transcript: TranscriptItem[];
  tools: ToolEvent[];
  pending: Pending[];
  metrics: Metrics | null;
  stage: Stage;
  agentState: AgentState;
  session: SessionInfo | null;
  highlights: Record<string, number>;
  changed: Record<string, number>;
  errors: string[];
  stateTick: number;
  health: Record<string, Health>;
  chaos: Chaos | null;
  insights: Insight[];
  insightStats: InsightStats | null;
  sim: SimState | null;
}

const init: LiveState = {
  transcript: [],
  tools: [],
  pending: [],
  metrics: null,
  stage: "before",
  agentState: "idle",
  session: null,
  highlights: {},
  changed: {},
  errors: [],
  stateTick: 0,
  health: {},
  chaos: null,
  insights: [],
  insightStats: null,
  sim: null,
};

function reducer(s: LiveState, e: any): LiveState {
  switch (e.type) {
    case "transcript": {
      const i = s.transcript.findIndex((t) => t.id === e.id);
      if (!e.text && !e.final) return s;
      if (i === -1) return e.text ? { ...s, transcript: [...s.transcript, e] } : s;
      const next = s.transcript.slice();
      next[i] = e;
      return { ...s, transcript: next };
    }
    case "tool": {
      const i = s.tools.findIndex((t) => t.id === e.id);
      if (e.phase === "retry") {
        if (i === -1) return s;
        const next = s.tools.slice();
        next[i] = { ...next[i], retryLog: [...(next[i].retryLog ?? []), { attempt: e.attempt, error: e.error, backoffMs: e.backoffMs }] };
        return { ...s, tools: next };
      }
      const ev = { ...e, at: i === -1 ? Date.now() : s.tools[i].at };
      if (i === -1) return { ...s, tools: [...s.tools, ev].slice(-200) };
      const next = s.tools.slice();
      next[i] = { ...ev, retryLog: s.tools[i].retryLog };
      return { ...s, tools: next };
    }
    case "pending":
      return { ...s, pending: e.pending };
    case "metrics":
      return { ...s, metrics: e.metrics };
    case "stage":
      return { ...s, stage: e.stage };
    case "agent_state":
      return { ...s, agentState: e.state };
    case "session":
      return { ...s, session: e.session, stage: e.session.stage ?? s.stage };
    case "state": {
      const now = Date.now();
      const highlights = { ...s.highlights };
      for (const h of e.highlight ?? []) highlights[h] = now;
      const changed = { ...s.changed };
      for (const c of e.changed ?? []) changed[c] = now;
      return { ...s, highlights, changed, stateTick: s.stateTick + 1 };
    }
    case "systems":
      return { ...s, health: e.health };
    case "chaos":
      return { ...s, chaos: e.chaos };
    case "insights":
      return { ...s, insights: e.insights, insightStats: e.stats };
    case "sim":
      return { ...s, sim: e.sim };
    case "init":
      return { ...s, health: e.health ?? s.health, chaos: e.chaos ?? s.chaos, insights: e.insights ?? s.insights, insightStats: e.insightStats ?? s.insightStats, sim: e.sim ?? s.sim };
    case "error":
      return { ...s, errors: [...s.errors, e.message].slice(-3) };
    case "local_agent_state":
      return { ...s, agentState: e.state };
    case "reset":
      return { ...init, stateTick: s.stateTick + 1 };
    default:
      return s;
  }
}

export function useLive(onAnnounce: (text: string, urgent?: boolean) => void) {
  const [live, dispatch] = useReducer(reducer, init);
  const [estate, setEstate] = useState<EState | null>(null);
  const [connected, setConnected] = useState(true);
  const announceRef = useRef(onAnnounce);
  announceRef.current = onAnnounce;

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource retries on its own; the header shows "Reconnecting…"
    es.onmessage = (m) => {
      let e: any;
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }
      if (e.type === "announce") announceRef.current(e.text, e.urgent);
      dispatch(e);
    };
    return () => es.close();
  }, []);

  // Refetch enterprise state when systems change (debounced).
  useEffect(() => {
    const t = setTimeout(async () => {
      let j: any;
      try {
        const r = await fetch("/api/state");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        j = await r.json();
      } catch {
        setConnected(false);
        return; // the next state event (after reconnect) retries
      }
      setEstate(j);
      if (live.stateTick === 0) {
        dispatch({ type: "pending", pending: j.pending });
        dispatch({ type: "metrics", metrics: j.metrics });
        dispatch({ type: "session", session: j.session });
        dispatch({ type: "init", health: j.health, chaos: j.chaos, insights: j.insights, insightStats: j.insightStats, sim: j.sim });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [live.stateTick]);

  return { live, estate, dispatch, connected };
}

export const isHot = (map: Record<string, number>, key: string, ms = 4500) => Date.now() - (map[key] ?? 0) < ms;

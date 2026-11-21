import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { StageRail, MetricsStrip } from "./components/StageMetrics";
import { VoiceConsole } from "./components/VoiceConsole";
import { Trace } from "./components/Trace";
import { Systems } from "./components/Systems";
import { TicketCard } from "./components/TicketCard";
import { InsightsRail } from "./components/InsightsRail";
import { MobileBar } from "./components/MobileBar";
import { DemoDrawer } from "./components/DemoDrawer";
import { ImpactPanel } from "./components/ImpactPanel";
import { PreflightPanel } from "./components/PreflightPanel";
import type { Panel } from "./components/Header";
import type { DemoAction } from "./lib/demoScript";
import { useLive } from "./lib/useLive";
import { DirectVoice } from "./lib/voiceDirect";
import type { AgentState, Capabilities } from "./lib/types";

async function consumeTurn(text: string) {
  const res = await fetch("/api/direct/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  const reader = res.body?.getReader();
  if (!reader) return;
  while (!(await reader.read()).done) {
    /* transcript arrives via the event stream */
  }
}

export default function App() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [inCall, setInCall] = useState<"agora" | "direct" | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [localState, setLocalState] = useState<AgentState>("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [agentLevel, setAgentLevel] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const direct = useRef<DirectVoice | null>(null);
  const agora = useRef<import("./lib/voiceAgora").AgoraVoice | null>(null);
  const callRef = useRef(inCall);
  callRef.current = inCall;

  const { live, estate, dispatch, connected } = useLive(
    useCallback((text: string, urgent?: boolean) => {
      if (callRef.current === "direct") direct.current?.say(text, urgent);
    }, []),
  );

  // Presence → server, so Watchtower never talks over anyone. A short hang-over bridges pauses between words.
  const levels = useRef({ mic: 0, agent: 0, interim: "", local: "idle" as AgentState, userAt: 0, agentAt: 0, sent: "" });
  levels.current.mic = micLevel;
  levels.current.agent = agentLevel;
  levels.current.interim = interim;
  levels.current.local = localState;
  useEffect(() => {
    const t = setInterval(() => {
      const L = levels.current;
      const now = Date.now();
      const mode = callRef.current;
      if (mode && !muted && (L.mic > 0.08 || L.interim)) L.userAt = now;
      if ((mode === "agora" && L.agent > 0.04) || (mode === "direct" && L.local === "speaking")) L.agentAt = now;
      const p = { userSpeaking: now - L.userAt < 700, agentSpeaking: now - L.agentAt < 700 };
      const key = JSON.stringify(p);
      if (key !== L.sent) {
        L.sent = key;
        fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: key }).catch(() => {});
      }
    }, 150);
    return () => clearInterval(t);
  }, [muted]);

  const refreshCaps = useCallback(
    () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((j) => setCaps(j.capabilities))
        .catch(() => setError("Server not reachable — run `npm run dev`.")),
    [],
  );
  useEffect(() => {
    refreshCaps();
    if (location.hash === "#preflight") setPanel("preflight");
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [refreshCaps]);

  const [panel, setPanel] = useState<Panel | null>(null);
  const openPanel = (p: Panel | null) => {
    setPanel(p);
    history.replaceState(null, "", p === "preflight" ? "#preflight" : location.pathname);
  };
  const setBackup = async (on: boolean) => {
    await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }).catch(() => {});
    await refreshCaps();
  };
  const post = (url: string, body: unknown = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch((e) => setError(String(e)));
  const demoAction = (a: DemoAction) => {
    if (a === "armChaos") post("/api/chaos", { failNext: { system: "ERP", count: 1 } });
    if (a === "approveAsDana") {
      const po = estate?.purchaseOrders.find((p) => p.status === "PENDING_MANAGER_APPROVAL");
      if (po) managerDecide(po.id, "approve");
      else setError("No purchase order is waiting on Dana yet — say “Yes, go ahead.” to the order first.");
    }
    if (a === "openImpact") openPanel("impact");
    if (a === "simHeadPressure") post("/api/sim", { scenario: "head_pressure_rising" });
    if (a === "simSafety") post("/api/sim/safety");
  };

  const start = async (mode: "agora" | "direct") => {
    setError(null);
    setConnecting(true);
    try {
      if (mode === "direct") {
        const v = new DirectVoice(
          { onState: setLocalState, onInterim: setInterim, onLevel: setMicLevel, onError: setError },
          Boolean(caps?.murf),
        );
        direct.current = v;
        await v.start();
      } else {
        const { AgoraVoice } = await import("./lib/voiceAgora");
        const v = new AgoraVoice((m, a) => {
          setMicLevel(m);
          setAgentLevel(a);
        });
        agora.current = v;
        await v.start();
      }
      setInCall(mode);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      direct.current = null;
      agora.current = null;
    } finally {
      setConnecting(false);
    }
  };

  const stop = async () => {
    direct.current?.stop();
    direct.current = null;
    await agora.current?.stop();
    agora.current = null;
    setInCall(null);
    setMuted(false);
    setInterim("");
    setLocalState("idle");
  };

  const send = (text: string) => {
    if (inCall === "direct" && direct.current) direct.current.send(text);
    else consumeTurn(text).catch((e) => setError(String(e)));
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    await fetch(`/api/pending/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
  };

  /** Manager approval card (stands in for the manager's own device). */
  const managerDecide = async (poId: string, decision: "approve" | "reject") => {
    await fetch(`/api/approvals/${poId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
  };

  const reset = async () => {
    await stop();
    await fetch("/api/reset", { method: "POST" });
    dispatch({ type: "reset" });
    setError(null);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    direct.current?.setMuted(m);
    agora.current?.setMuted(m);
  };

  const agentState: AgentState =
    inCall === "direct"
      ? live.agentState === "thinking" && localState !== "speaking"
        ? "thinking"
        : localState
      : inCall === "agora"
        ? agentLevel > 0.04
          ? "speaking"
          : live.agentState === "thinking"
            ? "thinking"
            : "listening"
        : live.agentState;
  const level = agentState === "speaking" ? Math.max(agentLevel, 0.35 + Math.random() * 0.25) : micLevel;

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <Header caps={caps} estate={estate} chaos={live.chaos} sim={live.sim} connected={connected} onReset={reset} onOpen={openPanel} />
      <div className="grid grid-cols-1 gap-2 px-3 pb-3 sm:px-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <StageRail stage={live.stage} active={live.tools.length > 0} />
        <MetricsStrip m={live.metrics} />
      </div>
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-28 sm:px-5 lg:grid-cols-[380px_minmax(0,0.9fr)_minmax(0,1.25fr)] lg:pb-5">
        <VoiceConsole
          caps={caps}
          inCall={inCall}
          connecting={connecting}
          state={agentState}
          level={level}
          interim={interim}
          muted={muted}
          transcript={live.transcript}
          pending={live.pending}
          error={error ?? live.errors[live.errors.length - 1] ?? null}
          onStart={start}
          onStop={stop}
          onMute={toggleMute}
          onOrb={() => direct.current?.interrupt()}
          onSend={send}
          onDecide={decide}
          onManager={managerDecide}
          estate={estate}
        />
        <div className="flex min-h-0 flex-col gap-3">
          <InsightsRail insights={live.insights} stats={live.insightStats} />
          <TicketCard estate={estate} ticketId={live.session?.activeTicketId} highlights={live.highlights} />
          <Trace tools={live.tools} thinking={live.agentState === "thinking"} />
        </div>
        <Systems estate={estate} tools={live.tools} highlights={live.highlights} changed={live.changed} health={live.health} activeTicketId={live.session?.activeTicketId} />
      </main>
      <MobileBar inCall={!!inCall} state={agentState} connecting={connecting} onStart={() => start(caps?.agoraReachable ? "agora" : "direct")} onStop={stop} onTalk={() => direct.current?.interrupt()} onSend={send} />
      <DemoDrawer open={panel === "demo"} onClose={() => openPanel(null)} onSay={send} onAction={demoAction} onReset={reset} />
      <ImpactPanel open={panel === "impact"} onClose={() => openPanel(null)} />
      <PreflightPanel open={panel === "preflight"} onClose={() => openPanel(null)} backup={!!caps?.backup} onBackup={setBackup} />
    </div>
  );
}

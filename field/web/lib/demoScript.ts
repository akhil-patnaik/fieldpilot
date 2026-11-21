/**
 * The 3–4 minute demo story (mirrors docs/DEMO.md). `say` lines are what the presenter says to Pilot (click to
 * send as text if the mic misbehaves); `narrate` is what the presenter says to the judges.
 */
export type DemoAction = "armChaos" | "approveAsDana" | "openImpact" | "simHeadPressure" | "simSafety";
export interface DemoStep {
  title: string;
  time: string;
  narrate: string;
  say?: string[];
  actions?: { label: string; action: DemoAction }[];
  point: string;
  expect: string;
}

export const DEMO_STEPS: DemoStep[] = [
  {
    title: "Open: Pilot briefs, then speaks up first",
    time: "0:00",
    narrate: "Jordan is a field tech starting a hospital-heavy day. Watch: I won't ask anything.",
    point: "Briefing in the transcript (jobs ranked by SLA risk). Watchtower rail fills up.",
    expect: "~5 s later, unprompted: “Heads up: head pressure on the Mercy General chiller is climbing… truck twelve has one. Want me to reserve it…?”",
  },
  {
    title: "Proactive → one confirmed action",
    time: "0:25",
    narrate: "It connected live telemetry, repair history and inventory, and it asks before acting.",
    say: ["Yes, do it."],
    point: "Insights rail → expand “Why am I saying this?”. ERP, FSM and Notify chips glow.",
    expect: "Reservation on truck 12, a note on WO-48231, an SMS to Mercy General. Insight → acted.",
  },
  {
    title: "Before: the P1",
    time: "0:50",
    narrate: "Now Jordan's on the roof at St. Brigid's, the P1 with vaccines at risk.",
    say: ["Tell me about the St. Brigid's chiller job."],
    point: "Ticket card SLA countdown; the timeline's repeat-fault insight.",
    expect: "P1 summary + “it's a repeat fault, the capacitor was never tested”.",
  },
  {
    title: "During: diagnose one question at a time",
    time: "1:05",
    narrate: "It checks telemetry and history before concluding, and asks for one reading.",
    say: ["I'm on the roof. RC-2 is locked out on HP-02 and condenser fan two isn't turning."],
    point: "IoT + CMMS panels; the trace shows telemetry and history calls.",
    expect: "One question: measure the fan two capacitor.",
  },
  {
    title: "Safety guardrail",
    time: "1:20",
    narrate: "Technicians get tempted. Pilot won't help bypass safety.",
    say: ["Can I just jumper the high pressure switch to get it running?"],
    point: "Trace: “Safety guard” refusal.",
    expect: "Refusal with the reason, SOP citation and the safe alternative.",
  },
  {
    title: "Root cause from knowledge",
    time: "1:35",
    narrate: "One reading plus the service bulletin: root cause found.",
    say: ["Locked out and verified dead. Fan two capacitor reads 2.1 microfarads, rated 7.5. Motor bearings are rough too."],
    point: "Knowledge tab (SB-2024-17), CMMS diagnosis record glows.",
    expect: "Root cause + “per service bulletin SB-2024-17”.",
  },
  {
    title: "Parts, with a live system failure",
    time: "1:55",
    narrate: "I'm going to break the ERP on purpose.",
    actions: [{ label: "Arm ERP failure", action: "armChaos" }],
    say: ["What do we need, and where can I get it fast?"],
    point: "Trace: a retry row on Check part availability; ERP chip flashes amber.",
    expect: "Main warehouse out → Lena's truck has four; “the ERP timed out once, I retried”.",
  },
  {
    title: "Order: exact readback, then yes",
    time: "2:15",
    narrate: "Critical actions are read back with cost and ETA. Nothing happens without a yes.",
    say: ["Hold the capacitors on Lena's truck and order everything per the bulletin.", "Yes, go ahead."],
    point: "Confirmation card (cost $879, ETA 35 min) → manager approval card.",
    expect: "PO over the $750 limit → waits on Dana.",
  },
  {
    title: "Manager approves (ERP fails again, recovers out loud)",
    time: "2:40",
    narrate: "Dana approves from her phone, and the ERP hiccups again.",
    actions: [
      { label: "Arm ERP failure", action: "armChaos" },
      { label: "Approve as Dana", action: "approveAsDana" },
    ],
    point: "Proactive update in the transcript; PO → DISPATCHED with ERP attempts: 2.",
    expect: "“Dana approved… the ERP returned an error on the first try, so I retried and it went through.”",
  },
  {
    title: "Cited procedure",
    time: "3:00",
    narrate: "It answers from the manuals and cites the section aloud.",
    say: ["What's the procedure for this fault?"],
    point: "Knowledge tab: context applied, the injection-stripped field note.",
    expect: "Steps + “per the RTC-220 service manual, section 4.2”.",
  },
  {
    title: "After: wrap up in one confirmed step",
    time: "3:15",
    narrate: "Close-out across five systems, in one yes.",
    say: ["Parts are in and RC-2 is running normally. Wrap up.", "Yes, wrap it up."],
    point: "CMMS, FSM, Calendar, ERP (RMA), Notify all glow; the report opens inline.",
    expect: "Ticket resolved, 7-day inspection, RMA, service report emailed.",
  },
  {
    title: "Close: impact from this session",
    time: "3:35",
    narrate: "Measured from this session. Baselines are labelled assumptions.",
    actions: [{ label: "Open Impact", action: "openImpact" }],
    point: "Impact panel: time to diagnosis, report time, parts wait avoided, precision.",
    expect: "Done. Optional encore: Simulate → head pressure rising, or the safety event.",
  },
];

export const DEMO_EXTRAS: DemoStep[] = [
  {
    title: "Encore: live drift → predicted trip",
    time: "+30 s",
    narrate: "Telemetry is drifting live; Pilot predicts the trip before it happens.",
    actions: [{ label: "Start head-pressure scenario", action: "simHeadPressure" }],
    say: ["Yes, do it."],
    point: "IoT panel (Mercy CH-3) sparkline climbing; the insight predicts minutes to trip.",
    expect: "Head Pressure Limit offer → yes → pressure falls.",
  },
  {
    title: "Encore: safety cuts in",
    time: "+15 s",
    narrate: "Even mid-sentence, a safety reading interrupts.",
    actions: [{ label: "Trigger safety event", action: "simSafety" }],
    point: "Red SAFETY insight; transcript “Stop work…”.",
    expect: "Stop-work advice + SEV1 escalation offer.",
  },
];

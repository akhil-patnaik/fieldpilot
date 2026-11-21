import type { Request, Response } from "express";

/**
 * BACKUP BRAIN — a deterministic, offline, OpenAI-compatible "LLM" that knows the demo story.
 * Used automatically when no LLM is configured, or switched on mid-demo if the network fails.
 * It speaks the same protocol (streamed chat.completion.chunk + tool_calls), so the REAL agent loop, MCP
 * tools, confirmation gate, Watchtower and UI all run exactly as with a real model — only the reasoning is
 * scripted. It never pretends: anything off-script gets an honest "backup mode" reply.
 */

type ToolCall = [string, Record<string, unknown>];
type Step = { tools: ToolCall[] } | { say: string };
interface Ctx {
  user: string;
  sys: string;
  step: number;
  /** Tool results returned since the user's last message, in order. */
  results: { name: string; data: any }[];
  last: () => any;
  find: (name: string) => any;
}

const ticketFrom = (c: Ctx, fallback = "WO-48213") => c.sys.match(/Active work order: (WO-\d+)/)?.[1] ?? fallback;
const assetFor = (ticket: string) => ({ "WO-48213": "A-CH-220", "WO-48231": "A-CH-310", "WO-48219": "A-AHU-07", "WO-48225": "A-GEN-3" })[ticket] ?? "A-CH-220";

/** The newest pending action listed in the system prompt (what "yes" / "no" refers to). */
function newestPending(sys: string) {
  const block = sys.split("Pending actions awaiting")[1]?.split("Purchase orders awaiting")[0] ?? "";
  const items = [...block.matchAll(/- (ACT-[A-Z0-9]{4}) \(([a-z_]+)\)/g)].map((m) => ({ id: m[1], tool: m[2] }));
  return items.at(-1);
}

function confirmSummary(r: any): string {
  if (!r) return "Done.";
  if (r.error) return /GUARDRAIL/.test(r.error) ? "I need a clear yes from you first. Shall I go ahead?" : `That didn't go through: ${String(r.error).replace(/^GUARDRAIL: /, "")}`;
  if (r.cancelled) return "No problem, I've left it.";
  if (r.insight_id && r.completed) {
    const done = r.results ?? [];
    const res = done.find((x: any) => x.reservation_id);
    const sms = done.find((x: any) => x.sent_to);
    const mode = done.find((x: any) => x.effect);
    const inc = done.find((x: any) => x.incident_id);
    const moved = done.find((x: any) => x.moved);
    const bits = [
      res && `it's reserved on ${String(res.location).replace(/ \(VAN-0*(\d+)\)/, "")}`,
      done.some((x: any) => x.ticket_id && x.status) && "logged on the work order",
      sms && `${String(sms.sent_to).split(" (")[0]} has been told`,
      mode && mode.effect,
      inc && `incident ${String(inc.incident_id).replace("INC-", "")} is open with ${inc.assignee}`,
      moved && `moved ${moved.moved.map((m: any) => `${m.ticket_id.replace("WO-", "")} to ${m.start}`).join(" and ")}`,
    ].filter(Boolean);
    return `Done: ${bits.join(", ")}.${r.failed?.length ? ` One step failed: ${r.failed[0]}.` : ""}`;
  }
  if (r.po_id) return r.status === "PENDING_MANAGER_APPROVAL" ? `Done. P O ${r.po_id.replace("PO-", "")} is in, and since it's over your limit it's waiting on Dana's approval.` : r.status === "QUEUED" ? `The ERP is down, so I've queued P O ${r.po_id.replace("PO-", "")}; it'll go out as soon as the ERP is back.` : `Done. P O ${r.po_id.replace("PO-", "")} is dispatched.`;
  if (r.completed && r.report_id) return `All wrapped up: the ticket's closed, the follow-up inspection is booked for ${r.follow_up}, return ${r.rma} is open, and the customer has the service report.${r.failed?.length ? ` One step failed: ${r.failed[0]}.` : ""}`;
  if (r.incident_id) return `Escalated: incident ${r.incident_id.replace("INC-", "")} is with ${r.assignee}.`;
  if (r.appointment_id) return `Booked for ${r.when}, and the customer has a confirmation.`;
  if (r.effect) return r.effect;
  if (r.status) return `Done, the work order is now ${String(r.status).toLowerCase().replace(/_/g, " ")}.`;
  return "Done.";
}

const RULES: { match: (c: Ctx) => boolean; steps: (c: Ctx) => Step[] }[] = [
  // ── safety refusal (the deterministic guard put an alert into the system prompt) ──
  {
    match: (c) => c.sys.includes("SAFETY ALERT"),
    steps: (c) => {
      const reason = c.sys.match(/give the reason \("([^"]+)"\)/)?.[1] ?? "it isn't safe";
      const ref = c.sys.match(/cite ([^,]+),/)?.[1] ?? "SOP-SAF-001";
      const alt = c.sys.match(/safe alternative \("([^"]+)"\)/)?.[1] ?? "";
      return [{ say: `I can't help with that. ${reason} That's per ${ref}. ${alt}` }];
    },
  },
  // ── yes / no to whatever is pending (spoken offers, proactive insights, wrap-up) ──
  {
    match: (c) => /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|go ahead|do it|approve|confirm|please do)\b/i.test(c.user) && !/\?\s*$/.test(c.user),
    steps: (c) => {
      if (c.step > 0) return [{ tools: [] }, { say: confirmSummary(c.find("confirm_action")) }]; // after confirming, summarise
      const p = newestPending(c.sys);
      return p ? [{ tools: [["confirm_action", { action_id: p.id, decision: "approve" }]] }] : [{ say: "There's nothing waiting on a yes right now." }];
    },
  },
  {
    match: (c) => /^\s*(no|nope|not now|cancel|dismiss|reject|skip it)\b/i.test(c.user),
    steps: (c) => {
      if (c.step > 0) return [{ tools: [] }, { say: "No problem, I've left it." }];
      const p = newestPending(c.sys);
      return p ? [{ tools: [["confirm_action", { action_id: p.id, decision: "reject" }]] }] : [{ say: "Okay." }];
    },
  },
  // ── BEFORE ──
  {
    match: (c) => /\b(plate|briefing|my day)\b/i.test(c.user),
    steps: (c) => [
      { tools: [["get_daily_briefing", {}]] },
      { say: (() => { const r = c.find("get_daily_briefing"); const w = r?.work_orders ?? []; return `You have ${w.length} open work orders. First up is ${w[0]?.ticket_id?.replace("WO-", "work order ")} at ${w[0]?.site}, a ${w[0]?.priority} with ${w[0]?.sla_remaining} on the SLA.`; })() },
    ],
  },
  {
    match: (c) => /(brigid|mercy|tell me about|chiller job)/i.test(c.user) && !/procedure|wrap/i.test(c.user),
    steps: (c) => [
      { tools: [["get_ticket_details", { ticket_id: /mercy/i.test(c.user) ? "48231" : "48213" }]] },
      {
        say: (() => {
          const r = c.find("get_ticket_details");
          if (!r?.ticket) return "I couldn't open that work order.";
          const repeat = r.insight ? ` Heads up, it's a repeat fault: ${r.insight.match(/occurred (\d+) days ago/)?.[1] ?? "recently"} days ago the fan motor was replaced and the capacitor was never tested.` : "";
          return `${r.ticket.priority} at ${r.site.name.split(" — ")[0]}: ${r.ticket.title.split(" — ")[0]}, with ${r.ticket.sla_remaining} left on the SLA.${repeat}`;
        })(),
      },
    ],
  },
  // ── DURING ──
  {
    match: (c) => /(not turning|isn't turning|not spinning|isn't spinning|won't spin)/i.test(c.user),
    steps: (c) => {
      const t = ticketFrom(c);
      const a = assetFor(t);
      return [
        { tools: [["get_live_telemetry", { asset_id: a }], ["get_asset_history", { asset_id: a }], ["update_ticket", { ticket_id: t, status: "ON_SITE" }]] },
        { say: "Fan two is drawing almost nothing, and the motor was swapped 42 days ago without testing the capacitor. Lock out the unit first, then measure the fan two run capacitor. What does it read?" },
      ];
    },
  },
  {
    match: (c) => /(microfarad|µf|uf\b|capacitor reads)/i.test(c.user),
    steps: (c) => {
      const t = ticketFrom(c);
      return [
        { tools: [["search_knowledge_base", { query: "condenser fan capacitor motor failed again" }]] },
        { tools: [["add_diagnosis", { ticket_id: t, root_cause: "Failed condenser fan 2 run capacitor (SB-2024-17 batch); weak capacitor also damaged the replacement fan motor", findings: "Fan 2 not turning; motor bearings rough", readings: { "Fan 2 capacitor": "2.1 µF (rated 7.5)" } }]] },
        { say: "That's the root cause: the fan two capacitor has failed, and it's the known bad batch, so per service bulletin SB-2024-17 replace all four capacitors and the damaged motor. I've logged the diagnosis." },
      ];
    },
  },
  {
    match: (c) => /(procedure|how do i fix|what are the steps)/i.test(c.user),
    steps: (c) => [
      { tools: [["search_knowledge_base", { query: c.user }]] },
      {
        say: (() => {
          const top = c.find("search_knowledge_base")?.results?.[0];
          if (!top) return "I couldn't find that in the knowledge base.";
          if (top.doc_id === "MAN-ARC-220" && top.section === "4.2")
            return `Lock out first. Check the fan currents on the HMI, spin the blade by hand, then discharge the capacitor through a bleed resistor and measure it; replace it below 7.05 microfarads. Check the contactor, clean the coil, reset the lockout and confirm 250 to 340 psi within 15 minutes. That's per ${top.cite}.`;
          return `Here's what ${top.cite} says: ${String(top.content).split("\n")[1]?.split(/(?<=\.)\s/)[0] ?? ""}`;
        })(),
      },
    ],
  },
  // ── ACTION ──
  {
    match: (c) => /(where can i get|what do we need|in stock|find (the )?parts)/i.test(c.user),
    steps: (c) => [
      { tools: [["check_part_availability", { query: "CAP-75-440", qty: 4, asset_model: "Arctis RTC-220" }], ["check_part_availability", { query: "FM-15-460" }]] },
      {
        say: (() => {
          const rec = c.results.some((r) => r.data?.recovered) ? " The ERP timed out once, so I retried and it went through." : "";
          const stale = c.results.some((r) => r.data?.stale) ? " The ERP is down, so that's from the replica snapshot; worth confirming." : "";
          return `The main warehouse is out of capacitors, but Lena's truck has four, fifteen minutes away, and North Depot has the motor.${rec}${stale}`;
        })(),
      },
    ],
  },
  {
    match: (c) => /(order (everything|it|them|the parts)|hold the capacitors|reserve)/i.test(c.user),
    steps: (c) => {
      const t = ticketFrom(c);
      return [
        {
          tools: [
            ["reserve_part", { ticket_id: t, part_number: "CAP-75-440", qty: 4, location: "VAN-07" }],
            ["create_purchase_order", { ticket_id: t, lines: [{ part_number: "CAP-75-440", qty: 4, source_location: "VAN-07" }, { part_number: "FM-15-460", qty: 1, source_location: "WH-NOR" }], note: "SB-2024-17 warranty" }],
          ],
        },
        { say: (() => { const po = c.find("create_purchase_order"); return po?.readback ? `I've held the four capacitors on Lena's truck. ${po.readback} Shall I go ahead?` : `I couldn't stage that order: ${po?.error ?? "unknown error"}`; })() },
      ];
    },
  },
  {
    match: (c) => /(protect|head pressure limit|buy (us )?time|mitigat)/i.test(c.user),
    steps: (c) => [
      { tools: [["set_asset_operating_mode", { asset_id: assetFor(ticketFrom(c)), mode: "HEAD_PRESSURE_LIMIT", reason: "Protect the cold room until parts arrive" }]] },
      { say: `${c.find("set_asset_operating_mode")?.readback ?? "I can't do that right now."} Shall I go ahead?` },
    ],
  },
  {
    match: (c) => /escalat/i.test(c.user),
    steps: (c) => [
      { tools: [["escalate_incident", { ticket_id: ticketFrom(c), severity: "SEV3", team: "Reliability Engineering", reason: "Repeat HP-02 within 90 days; SB-2024-17 capacitor batch" }]] },
      { say: `${c.find("escalate_incident")?.readback ?? ""} Shall I go ahead?` },
    ],
  },
  // ── AFTER ──
  {
    match: (c) => /(wrap (it )?up|close (it|this) out|we're done)/i.test(c.user),
    steps: (c) => [
      { tools: [["complete_visit", { ticket_id: ticketFrom(c), work_performed: "Replaced all four condenser fan run capacitors and the fan 2 motor per SB-2024-17", resolution: "Fan 2 restored; discharge pressure back to normal and the cold room is recovering", recommendations: ["Re-check fan currents at the 7-day inspection", "Apply SB-2024-17 to sister units"] }]] },
      { say: `${c.find("complete_visit")?.readback ?? "I can't wrap that up yet."} Shall I go ahead?` },
    ],
  },
  {
    match: (c) => /(awaiting parts|let (the|them|priya) know|send (them|the customer) the eta)/i.test(c.user),
    steps: (c) => {
      const t = ticketFrom(c);
      return [
        { tools: [["update_ticket", { ticket_id: t, status: "AWAITING_PARTS", note: "Capacitors x4 (VAN-07) + fan motor (WH-NOR) on the way" }], ["notify_customer", { ticket_id: t, channel: "SMS", message: "Parts arrive in about 35 minutes; repair to follow. We're monitoring the cold room." }]] },
        { say: "Ticket's set to awaiting parts, and the customer has the ETA by text." },
      ];
    },
  },
];

export function backupReply(messages: any[]): Step {
  const sys = String(messages[0]?.content ?? "");
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const user = String(messages[lastUser]?.content ?? "");
  const after = messages.slice(lastUser + 1);
  const step = after.filter((m) => m.role === "assistant").length;
  const idToName = new Map<string, string>();
  for (const m of after) for (const tc of m.tool_calls ?? []) idToName.set(tc.id, tc.function?.name);
  const results = after.filter((m) => m.role === "tool").map((m) => {
    let data: any = m.content;
    try {
      data = JSON.parse(m.content);
    } catch {}
    return { name: idToName.get(m.tool_call_id) ?? "", data };
  });
  const c: Ctx = { user, sys, step, results, last: () => results.at(-1)?.data, find: (n) => [...results].reverse().find((r) => r.name === n)?.data };
  const rule = RULES.find((r) => r.match(c));
  if (!rule) return { say: "I'm running on the backup demo brain right now, so I can follow the demo script but not open questions. Try asking about the St. Brigid's job, the procedure for this fault, or say wrap up." };
  return rule.steps(c)[step] ?? { say: "Okay." };
}

/** OpenAI-compatible streaming endpoint: POST /backup/v1/chat/completions */
export function handleBackupCompletion(req: Request, res: Response) {
  const step = backupReply(req.body?.messages ?? []);
  const id = `chatcmpl-backup-${Date.now().toString(36)}`;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (delta: any, finish: string | null = null) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "fieldpilot-backup-brain", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  if ("tools" in step) {
    step.tools.forEach(([name, args], i) => send({ tool_calls: [{ index: i, id: `bk_${Date.now().toString(36)}_${i}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }));
    send({}, "tool_calls");
  } else {
    for (const w of step.say.replace(/\s+/g, " ").trim().split(/(?<= )/)) send({ content: w });
    send({}, "stop");
  }
  res.end("data: [DONE]\n\n");
}

# FieldPilot: pitch

## Problem
Field technicians fix critical equipment (hospital chillers, generators, air handlers) with their hands full, often on a roof, under an SLA clock. The information they need is spread across five or six systems: the work order, the maintenance history, live sensors, manuals and bulletins, inventory, the calendar. Every lookup means stopping work and taking gloves off. The admin that follows (ordering, escalating, rescheduling, reporting) eats the end of every visit. And the problems that hurt most, like a part that's out of stock, a repeat failure or an SLA about to slip, are discovered too late, by the technician, the hard way.

## Solution
**FieldPilot** is a voice copilot that works the job end to end **and speaks up before it's asked**.
- **Talk, don't type.** Agora Conversational AI (RTC, ASR, turn detection, barge-in) and Murf Falcon's low-latency voice.
- **It understands the whole job.** LLM tool calling over MCP across six enterprise systems, plus RAG over manuals, service bulletins, SOPs and past resolutions, cited aloud.
- **It acts, safely.** Risky actions are read back with cost and ETA, and run only on the technician's explicit "yes" (checked server-side, never the model's word). Over-limit orders route to the manager. Everything is audited.
- **It recovers.** Timeouts, retries, alternative stock, queued orders, narrated in plain words.
- **It closes the loop.** "Wrap up" closes out five systems in one confirmed step and emails a printable service report.
- **It looks ahead.** Watchtower notices what nobody asked about, and offers one confirmed fix.

## Required flow → features

| Requirement | Where it is in FieldPilot |
|---|---|
| **Initiate:** natural voice via Agora ConvoAI + Murf Falcon | Agora `join` with ARES ASR, semantic end-of-speech, interruption, and Murf Falcon TTS (`vendor: murf`). Our server is Agora's custom-LLM endpoint. Direct voice and text fallbacks. Session briefing ranked by SLA risk. |
| **Understand:** interpret, retrieve enterprise info, pick the action | Agent loop with tools discovered over MCP: work orders, CMMS history, live IoT telemetry, ERP stock (van, trucks, warehouses, alternates), calendar. Hybrid RAG (BM25 + embeddings) with context ("this fault" → HP-02 on the RTC-220), cited aloud, injection-safe. Diagnosis requires telemetry **and** history; one question at a time. |
| **Execute:** tool calls / APIs that change state | 21 zod-validated tools: reserve stock, purchase orders, remote asset commands, escalations, re-sequencing, follow-ups, customer SMS/email, CMMS records, RMAs, service reports. All writes go through the enterprise store and light up the console. |
| **Confirm:** report outcome, handle errors, ask before critical actions | Two-phase gate: staged → exact readback (items, cost, ETA) → explicit yes on a later turn (or a tap) → execute. A manager approval card for over-limit POs. Timeout, retry and backoff, with alternatives (truck, alternate part, queued order) narrated. Audit log of every write. |
| **Follow up:** update systems, summary, follow-ups | One-step wrap-up (CMMS record, close ticket, 7-day inspection, RMA, report, customer email). Proactive spoken updates (approvals, recoveries, queued orders submitted). |
| **Technology focus** | Agora ConvoAI + RTC ✓ · Murf Falcon ✓ · LLM tool calling ✓ (any OpenAI-compatible) · RAG ✓ · MCP ✓ (agent uses it; external clients too) · enterprise APIs ✓ (simulated) |

## The differentiator: proactive, but never unconfirmed
**Watchtower** continuously evaluates every system with six detectors:

| Detector | Example |
|---|---|
| Recurring fault | "Third capacitor-related HP-02 in 90 days", linked to bulletin SB-2024-17 and a past resolution |
| Telemetry trend | Head pressure climbing ~2 psi/min → "trips HP-02 in about 9 minutes" |
| Parts risk | Main warehouse out → "truck twelve has one", before the 3 PM visit |
| SLA risk | Riverside projected to miss its SLA → swap with a lower-priority job |
| Safety | Panel at 92 °C → stop work, SEV1 offer, interrupts immediately |
| Schedule | Same-site PM due in 3 days → bundle it, save a truck roll |

Related findings on one job merge into **one spoken story with one action**. It:
- never talks over the technician;
- is rate-limited and deduped;
- learns from "not now";
- doesn't nag about the job you're standing at.

When it speaks, the action is already **staged through the same confirmation gate**, so the offer is the readback and "yes, do it" is checked like any other yes.

> *"Heads up: head pressure on the Mercy General chiller is climbing and it's the third capacitor-related trip in 90 days. The main warehouse is out of the capacitor, but truck twelve has one. Want me to reserve it, no charge and ready in ten minutes, log it on the work order, and tell the hospital to expect you at 3 PM?"*

## Impact (measured, honestly)
The **Impact** panel computes everything from the live session's own records, and labels each figure:
- **Measured:** time to diagnosis, service-report generation time, system operations and systems touched, proactive-insight precision (accepted ÷ spoken), critical writes confirmed vs blocked.
- **Computed from ERP data:** parts wait avoided (truck ETA vs the supplier lead time on the part record).
- **Modelled:** SLA time protected (Watchtower's route projection).
- **Estimated:** admin minutes automated (per-task estimates, listed).

Every baseline (e.g. ~45 min for a manual repeat-fault diagnosis, ~25 min for a hand-written report) is shown as a **numbered assumption** on screen. We don't present invented numbers as measured.

## Trust & safety
- A deterministic safety guard refuses bypassing interlocks, skipping lockout/tagout, live 460 V work and venting refrigerant, before the model sees the request.
- The explicit-yes check reads the technician's own words, so the model can't self-approve.
- Retrieved documents are data, never instructions: injected text is stripped and flagged.
- The full audit trail records who did what, when, and who confirmed it.

## What's next
1. **Real connectors** behind the same tool registry: ServiceNow / Salesforce Field Service / IFS (FSM), Maximo (CMMS), SAP (ERP), BMS/BACnet gateways, Microsoft Graph (calendar, Teams).
2. **Fleet Watchtower:** cross-site pattern detection (every RTC-220 in the SB-2024-17 batch), pushed before failures.
3. **Multilingual crews:** Murf Falcon's multilingual voices plus Agora ASR languages.
4. **On-device mode** for basements and plant rooms with no signal: a cached knowledge base and queued writes.
5. **Learned thresholds:** Watchtower confidence tuned per technician and site from acceptance data.

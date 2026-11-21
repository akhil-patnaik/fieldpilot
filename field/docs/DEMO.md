# FieldPilot: the 3–4 minute demo

The same script is in the app: **Demo script** (header). Click any line to send it as text if the mic misbehaves.
`npm run rehearse` runs this exact story end to end, twice in a row, against a fresh server.

## The story

Jordan, a field tech, starts a hospital-heavy day. We show the **proactive** moment first, then one full job from diagnosis to close-out, then the measured impact.

| # | Time | Do / say to Pilot | Narrate to judges | Point at | Expect |
|---|---|---|---|---|---|
| 1 | 0:00 | **Reset** → **Agora voice** (or Direct voice). *Say nothing.* | "Jordan's starting a hospital-heavy day. Watch: I won't ask anything." | Briefing in the transcript; Watchtower rail fills | ~5 s later, unprompted: "Heads up: head pressure on the Mercy General chiller is climbing and it's the third capacitor-related trip in 90 days. The main warehouse is out of the capacitor, but truck twelve has one. Want me to reserve it…?" |
| 2 | 0:25 | "**Yes, do it.**" | "It joined live telemetry, repair history and inventory, and it asked before acting." | Rail → "Why am I saying this?"; ERP/FSM/Notify glow | Reservation on truck 12, a note on WO-48231, an SMS to Mercy; insight → *acted* |
| 3 | 0:50 | "**Tell me about the St. Brigid's chiller job.**" | "Now the P1: vaccines at risk on a hospital roof." | Ticket card SLA countdown | P1 summary + "repeat fault, capacitor never tested" |
| 4 | 1:05 | "**I'm on the roof. RC-2 is locked out on HP-02 and condenser fan two isn't turning.**" | "It checks telemetry and history before concluding, and asks one thing." | IoT + CMMS panels, trace | One question: measure the fan 2 capacitor |
| 5 | 1:20 | "**Can I just jumper the high pressure switch to get it running?**" | "Techs get tempted. It won't help bypass safety." | Trace: Safety guard | Refusal + reason + SOP + safe alternative |
| 6 | 1:35 | "**Locked out and verified dead. Fan two capacitor reads 2.1 microfarads, rated 7.5. Motor bearings are rough too.**" | "One reading plus the service bulletin: root cause." | Knowledge tab (SB-2024-17), CMMS record | Root cause, cites SB-2024-17 |
| 7 | 1:55 | Demo script → **Arm ERP failure**, then "**What do we need, and where can I get it fast?**" | "I'm breaking the ERP on purpose." | Retry row in the trace; ERP chip amber | Main warehouse out → Lena's truck has 4; "the ERP timed out once, I retried" |
| 8 | 2:15 | "**Hold the capacitors on Lena's truck and order everything per the bulletin.**" → "**Yes, go ahead.**" | "Critical actions are read back with cost and ETA. Nothing happens without a yes." | Confirmation card ($879, 35 min) → manager card | PO over the $750 limit → waits on Dana |
| 9 | 2:40 | **Arm ERP failure** → **Approve as Dana** (card or Demo script) | "Dana approves from her phone, and the ERP hiccups again." | Proactive update in the transcript; PO attempts: 2 | "Dana approved… the ERP returned an error, so I retried and it went through." |
| 10 | 3:00 | "**What's the procedure for this fault?**" | "It answers from the manuals and cites the section aloud." | Knowledge tab: context applied, injection stripped | Steps + "per the RTC-220 service manual, section 4.2" |
| 11 | 3:15 | "**Parts are in and RC-2 is running normally. Wrap up.**" → "**Yes, wrap it up.**" | "Close-out across five systems, in one yes." | CMMS/FSM/Calendar/ERP/Notify glow; report inline | Resolved, 7-day inspection, RMA, report emailed |
| 12 | 3:35 | **Impact** (header) | "Measured from this session. Baselines are labelled assumptions." | Time to diagnosis, report time, parts wait, precision | — |

**Encores, if there's time:** Simulate → *Chiller head pressure rising* (Pilot predicts the trip and offers Head Pressure Limit; "Yes, do it." brings pressure down live). Simulate → *Trigger a safety event* (it cuts in mid-sentence with stop-work advice).

## Setup timeline

**T-30 min**
- Laptop on power, Do Not Disturb on, other apps closed, wired headset mic (not the laptop mic).
- If using Agora voice: start the tunnel (`ngrok http 8787` or `cloudflared tunnel --url http://localhost:8787`), put the https URL in `.env` → `PUBLIC_URL`.
- `npm run dev` → Chrome → `http://localhost:5173`.

**T-15 min**
- **Pre-flight**: Brain, LLM, MCP, Agora, Tunnel and Murf are green; **Test mic** moves the meter; note the LLM first-token latency.
- `npm run rehearse -- --real` once (uses your LLM; about 30 s). If it fails, plan to use the backup brain.

**T-2 min**
- **Reset**. Open **Demo script**. Zoom the browser to 90% so all three columns fit the projector.
- Mute notifications. Mic on. Breathe.

## Backup plan (degrade gracefully, never stop)

| If this fails… | Do this (≤ 10 s) | What still works |
|---|---|---|
| Agora call won't connect / the agent is silent | End → **Direct voice** | Everything except Agora; Murf still speaks |
| Mic or ASR misbehaves (noisy room) | **Demo script** → click each line | Everything; the transcript shows the lines |
| LLM slow, erroring or going off-script | **Pre-flight → Backup brain: Turn on** | The full story, deterministic; same tools, gate, Watchtower, UI |
| Venue network down | Backup brain on + Direct voice (browser speech) on `localhost` | The full story offline (no Agora, no Murf) |
| Watchtower doesn't speak within ~10 s | Look at its hold reason in the rail → **Simulate → Run Watchtower now**, or expand the insight and press **Do it** (approval card) | The proactive moment, by tap |
| A step lands wrong | Say "No." (cancels anything pending) and continue; or **Reset** and jump to the step from the Demo script | — |
| Laptop or projector dies | Play the screen recording you captured during rehearsal (record one!) | — |

---

## Punch list

### Exact run order
1. `npm install` (once) → `cp .env.example .env` → fill keys (optional) → tunnel → `PUBLIC_URL`.
2. `npm test && npm run smoke && npm run rehearse`: all green.
3. `npm run dev` → `http://localhost:5173` → **Pre-flight** all green → **Test mic**.
4. `npm run rehearse -- --real` (live LLM) → if red, decide: live LLM or backup brain.
5. **Reset** → **Demo script** open → start **Agora voice** (or Direct) → follow steps 1–12.
6. After: **Impact** on screen for Q&A.

### Rehearse these
- **The silence at the start.** Don't speak after the briefing; let Watchtower speak up first. Practice waiting 5 seconds.
- **The exact lines.** The live LLM handles paraphrase, but the backup brain matches on keywords like *isn't turning*, *microfarads*, *order everything*, *procedure*, *wrap up*. Say them as written.
- **The two "Arm ERP failure" clicks** before steps 7 and 9, and the **Approve as Dana** click.
- **Where to point.** Rail evidence, the retry row, the confirmation card, the glow, the report, Impact.
- **Switching to the backup brain mid-story** (Pre-flight → Turn on), so it takes 5 seconds under pressure.
- One full run with **Agora voice** in the actual room, for acoustics and turn-taking.

### The three riskiest points, with mitigations
1. **The live voice path in a noisy hall** (tunnel, Agora join, ASR mishearing). *Mitigation:* headset mic; Pre-flight Tunnel/Agora green at T-15; if anything stalls, switch to Direct voice or click lines in the Demo script. The story is identical.
2. **The live LLM going off-script** (skipping a tool, not confirming on "yes", rate limits or latency spikes). *Mitigation:* `rehearse --real` at T-15; keep the lines verbatim; one click to the backup brain. The gate means a confused model can't do anything unconfirmed.
3. **The proactive moment not firing on cue** (room noise keeps "technician is speaking" true, or a stray pending action blocks it). *Mitigation:* stay silent and mute the mic after the briefing until it speaks; the rail shows the hold reason; **Run Watchtower now**; fall back to tapping **Do it** on the insight. Same gate, same result.

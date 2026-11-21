import { db } from "./store.ts";
import type { AuditEntry, Risk } from "./seed.ts";

/**
 * Confirmation gate primitives + audit log.
 * The gate never trusts the model's word that the technician agreed: it checks the technician's own
 * latest utterance for an explicit, unambiguous yes.
 */

const YES = /\b(yes|yeah|yep|yup|affirmative|go ahead|go for it|do it|confirm(ed)?|approve(d)?|proceed|place (it|the order)|send it|make it so|sounds good|let'?s do it|ok(ay)?|sure)\b/i;
const NO = /\b(no|nope|nah|don'?t|do not|cancel|stop|wait|hold (on|off)|not (yet|now)|never ?mind|reject|scratch that)\b/i;

/** Explicit yes = affirmative words, no negation/hesitation, and not phrased as a question. */
export function isExplicitYes(text: string) {
  const t = text.trim();
  if (!t || /\?\s*$/.test(t)) return false;
  return YES.test(t) && !NO.test(t);
}

export function isExplicitNo(text: string) {
  return NO.test(text) && !YES.test(text.replace(NO, ""));
}

export function riskRank(r: Risk) {
  return r === "high" ? 2 : r === "medium" ? 1 : 0;
}

export function audit(entry: Omit<AuditEntry, "id" | "at">) {
  return db.mutate(["audit"], [], (s) => {
    s.audit ??= [];
    const e: AuditEntry = { id: db.nextId("AUD"), at: new Date().toISOString(), ...entry };
    s.audit.unshift(e);
    if (s.audit.length > 500) s.audit.length = 500;
    return e;
  });
}

export function actorFor(origin: AuditEntry["origin"]) {
  const tech = db.get().technician.name;
  return origin === "agent"
    ? `Pilot (voice agent) for ${tech}`
    : origin === "ui"
      ? `${tech} (console)`
      : origin === "mcp"
        ? "External MCP client"
        : "FieldPilot workflow";
}

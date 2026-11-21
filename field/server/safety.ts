/**
 * Deterministic safety guard for technician requests. Runs BEFORE the LLM on every turn, so an unsafe
 * instruction is refused even if the model would have complied. The agent receives the matched rule
 * and must explain why and offer the safe procedure instead.
 */
export interface SafetyHit {
  rule: string;
  topic: "LOTO" | "Electrical" | "Refrigerant" | "Safety device";
  explanation: string;
  safeAlternative: string;
  ref: string;
}

const RULES: (Omit<SafetyHit, "rule"> & { id: string; re: RegExp[] })[] = [
  {
    id: "skip-loto",
    topic: "LOTO",
    re: [
      /\b(skip|without|no need for|forget|ignore|don'?t bother with|bypass)\b.{0,30}\b(loto|lock\s?-?out|tag\s?-?out|locking (it )?out|isolat(e|ion))\b/i,
    ],
    explanation: "Lockout/tagout is mandatory before opening a 460-volt panel or touching the condenser fans. Fans can restart automatically on a pressure call, and the panel is arc-flash category 2.",
    safeAlternative: "Stop the unit at the HMI, open the disconnect, apply your lock and tag, bleed the capacitors, and verify zero energy live-dead-live.",
    ref: "SOP-SAF-001",
  },
  {
    id: "live-work",
    topic: "Electrical",
    re: [
      /\b(work(ing)?|swap(ping)?|replac(e|ing)|chang(e|ing)|touch(ing)?|pull(ing)?|wir(e|ing))\b.{0,40}\b(live|hot|energi[sz]ed|while (it'?s|it is) (on|running|powered))\b/i,
      /\b(keep|leave)\b.{0,20}\b(power|breaker|disconnect|it)\b.{0,12}\bon\b.{0,30}\b(while|and)\b.{0,20}\b(swap|replac|chang|work)/i,
    ],
    explanation: "Never replace components on an energized 460-volt circuit. Capacitors and contactors are inside the arc-flash boundary.",
    safeAlternative: "De-energize and lock out, then test for absence of voltage. If you need live readings, take them with category 3 rated meters and full PPE only.",
    ref: "SOP-SAF-001",
  },
  {
    id: "bypass-safety-device",
    topic: "Safety device",
    re: [
      /\b(bypass|jump(er)?|jumper(ing)?|defeat|override|disable|tie (out|off)|short)\b.{0,40}\b(pressure switch|hps|high[- ]?pressure|safety|interlock|cut-?out|limit switch|overload|lockout)\b/i,
    ],
    explanation: "The 425 psi high-pressure switch is what keeps the condenser from over-pressurizing. Jumpering it risks a coil rupture and a refrigerant release on a hospital roof.",
    safeAlternative: "Fix the root cause first. Until parts arrive, use the approved Head Pressure Limit mode, which caps load at 70%, to protect the cold room.",
    ref: "MAN-ARC-220 / SOP-SAF-001",
  },
  {
    id: "vent-refrigerant",
    topic: "Refrigerant",
    re: [
      /\b(vent|release|dump|blow (it )?off|purge|let out)\b.{0,30}\b(refrigerant|r-?134a|freon|gas|charge)\b/i,
      /\b(add|top (it )?off|charge|recharge)\b.{0,30}\b(refrigerant|r-?134a|freon|gas)\b.{0,40}\bwithout\b.{0,30}\b(leak|recover|check|certif)/i,
    ],
    explanation: "Knowingly venting refrigerant is illegal under EPA Section 608, and topping off without a leak check hides the fault.",
    safeAlternative: "Recover the refrigerant into a recovery cylinder, leak-check, repair, evacuate and recharge by weight, and log every pound.",
    ref: "MAN-ARC-220 (LP-01) / EPA 608",
  },
  {
    id: "screwdriver-discharge",
    topic: "Electrical",
    re: [/\bscrewdriver\b.{0,40}\b(capacitor|cap|terminals?)\b/i, /\bshort(ing)?\b.{0,20}\b(the )?(capacitor|cap)\b/i],
    explanation: "Shorting a run capacitor with a screwdriver can arc, weld the tip and throw molten metal.",
    safeAlternative: "Discharge it through an insulated 20 kΩ, 5 W bleed resistor, then confirm zero volts with your meter.",
    ref: "MAN-ARC-220 (HP-02 step 4)",
  },
];

export function checkSafety(text: string): SafetyHit | null {
  for (const r of RULES) {
    if (r.re.some((re) => re.test(text))) {
      const { id, re: _re, ...rest } = r;
      return { rule: id, ...rest };
    }
  }
  return null;
}

import type { Slot } from "./types";

// The Slot type lives in types.ts (it is also part of the saved state); re-exported for existing imports.
export type { Slot };

export const SLOT_HI: Record<Slot, string> = {
  morning: "सुबह",
  afternoon: "दोपहर",
  evening: "शाम",
  night: "रात",
};

export interface Schedule {
  slots: Slot[];
  asNeeded: boolean;
}

const CODES: Record<string, Slot[]> = {
  od: ["morning"],
  qd: ["morning"],
  bd: ["morning", "night"],
  bid: ["morning", "night"],
  tds: ["morning", "afternoon", "night"],
  tid: ["morning", "afternoon", "night"],
  qid: ["morning", "afternoon", "evening", "night"],
  hs: ["night"],
};

// Two normalisers on purpose. Codes drop their dots ("B.D." → "bd"), but a dose pattern must keep them:
// dropping the dot in "0.5-0-0.5" would turn half a tablet into "05", i.e. 5 tablets (a tenfold overdose).
const codeKey = (raw: string) => raw.trim().toLowerCase().replace(/[.\s]/g, "");
const patternKey = (raw: string) => raw.trim().toLowerCase().replace(/\s/g, "").replace(/\.+$/, "");

/** One part of a dose pattern: whole tablets ("2"), a decimal ("0.5", ".5"), a fraction ("1/2") or "½". */
const DOSE_PART = /^(\d+|\d*\.\d+|\d+\/\d+|½)$/;
/** "0", "00", "0.0": no tablet in that slot. */
const isZero = (part: string) => /^0*\.?0*$/.test(part) && /0/.test(part);
/** Only whole numbers are whole tablets; "0.5", "1.5", "1/2" and "½" are part doses. */
const isWhole = (part: string) => /^\d+$/.test(part);

/** "1-0-1" → [["morning","1"], ["afternoon","0"], ["night","1"]]; null when it is not that pattern. */
function dosePattern(s: string): [Slot, string][] | null {
  const parts = s.split(/[-–x×]/);
  if ((parts.length === 3 || parts.length === 4) && parts.every((p) => DOSE_PART.test(p))) {
    const order: Slot[] = parts.length === 3 ? ["morning", "afternoon", "night"] : ["morning", "afternoon", "evening", "night"];
    return order.map((slot, i) => [slot, parts[i]]);
  }
  return null;
}

/** "1-0-1", "1-1-1-1", "BD", "OD", "HS", "SOS". Returns null if the pattern is not understood. */
export function parseFrequency(raw: string | null): Schedule | null {
  if (!raw) return null;
  const code = codeKey(raw);
  if (code === "sos" || code === "prn") return { slots: [], asNeeded: true };
  if (CODES[code]) return { slots: CODES[code], asNeeded: false };
  const pattern = dosePattern(patternKey(raw));
  if (pattern) return { slots: pattern.filter(([, n]) => !isZero(n)).map(([slot]) => slot), asNeeded: false };
  return null;
}

/**
 * Whole tablets per dose for each scheduled slot: "2-0-1" → { morning: 2, night: 1 }, "BD" → one each.
 * Null when the schedule is not understood, as-needed, or uses part of a tablet ("½-0-½"): a half tablet
 * does not empty a whole pocket, so pockets cannot be counted against it (lib/blister.ts says "not sure").
 */
export function tabletsPerSlot(raw: string | null): Partial<Record<Slot, number>> | null {
  const sch = parseFrequency(raw);
  if (!raw || !sch || sch.asNeeded || !sch.slots.length) return null;
  const pattern = dosePattern(patternKey(raw));
  if (!pattern) return Object.fromEntries(sch.slots.map((slot) => [slot, 1]));
  const out: Partial<Record<Slot, number>> = {};
  for (const [slot, n] of pattern) {
    if (isZero(n)) continue;
    if (!isWhole(n)) return null;
    out[slot] = Number(n);
  }
  return Object.keys(out).length ? out : null;
}

export function timingHi(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (/before|empty|\bac\b|pehle|पहले|खाली/.test(s)) return "खाना खाने से पहले";
  if (/after|\bpc\b|baad|बाद/.test(s)) return "खाना खाने के बाद";
  if (/with|saath|साथ/.test(s)) return "खाने के साथ";
  return raw;
}

export function scheduleHi(frequency: string | null, timing: string | null): string {
  const sch = parseFrequency(frequency);
  const parts: string[] = [];
  if (sch?.asNeeded) parts.push("ज़रूरत पड़ने पर");
  else if (sch?.slots.length) parts.push(sch.slots.map((s) => SLOT_HI[s]).join(" और "));
  else if (frequency) parts.push(frequency);
  const t = timingHi(timing);
  if (t) parts.push(t);
  return parts.join(", ");
}

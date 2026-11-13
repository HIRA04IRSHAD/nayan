// Hindi text for the "आज" screen and the dose reminders. Fixed templates only, never model-generated text.
//
// Safety wording, checked by lib/today-messages.test.ts:
// - A dose that was not marked is "दर्ज नहीं" (not recorded), never "छूट गई, अभी ले लें": Nayan cannot know.
// - Never "take two together" or "take it later": a missed dose points to the doctor or chemist.
// - A reminder always adds "if already taken, do not take again", because an unmarked dose may have been taken.
// Medicines are named by their tactile tag when they have one ("एक बिंदु वाली दवा"), as in the dose check.

import type { PrescriptionItem, Slot } from "./types";
import { SLOTS } from "./types";
import { SLOT_HI, timingHi } from "./schedule";
import { medicineLabel } from "./blister-messages";
import { dueNow, slotMinutes, type SlotTimeError, type TodayDose, type TodayPlan, type TodaySlot } from "./today";

type Named = Pick<PrescriptionItem, "nameAsWritten" | "tag">;

/** "08:00" → "8 बजे", "20:30" → "8 बजकर 30 मिनट" (12-hour clock; the slot name says morning or night). */
export function clockHi(hhmm: string): string {
  const m = slotMinutes(hhmm);
  if (m == null) return hhmm;
  const h = Math.floor(m / 60) % 12 || 12;
  const min = m % 60;
  return min ? `${h} बजकर ${min} मिनट` : `${h} बजे`;
}

/** "सुबह 8 बजे". */
export const slotTimeHi = (slot: Slot, hhmm: string) => `${SLOT_HI[slot]} ${clockHi(hhmm)}`;

/** "एक बिंदु वाली दवा, 2 गोलियाँ, खाना खाने के बाद". */
export function doseLineHi(d: Pick<TodayDose, "item" | "tablets">): string {
  const parts = [medicineLabel(d.item)];
  const form = d.item.form;
  if (d.tablets && d.tablets > 1 && (form == null || form === "tablet" || form === "capsule")) {
    parts.push(`${d.tablets} ${form === "capsule" ? "कैप्सूल" : "गोलियाँ"}`);
  }
  const t = timingHi(d.item.timing);
  if (t) parts.push(t);
  return parts.join(", ");
}

/** "एक बिंदु वाली दवा", "A और B", "A, B और C". */
function joinNames(names: string[]): string {
  const u = [...new Set(names)];
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} और ${u[u.length - 1]}`;
}

const STATUS_SPOKEN: Record<TodayDose["status"], string> = {
  upcoming: "",
  now: ", अभी इसका समय है",
  done: ", ली हुई दर्ज है",
  missed: ", ली हुई दर्ज नहीं है",
};

const MISSED_NOTE =
  "जो खुराक दर्ज नहीं है, वह शायद ली गई हो पर दर्ज न हुई हो। उसे दूसरी खुराक के साथ न लें; शक हो तो डॉक्टर या केमिस्ट से पूछिए।";

/** "आज की दवाएँ सुनें": every slot in order with its medicines and what was marked, then as-needed ones. */
export function todaySpeech(plan: TodayPlan): string {
  const parts: string[] = [];
  for (const s of plan.slots) {
    parts.push(`${slotTimeHi(s.slot, s.time)}: ${s.doses.map((d) => doseLineHi(d) + STATUS_SPOKEN[d.status]).join("; ")}।`);
  }
  if (plan.asNeeded.length) parts.push(`ज़रूरत पड़ने पर: ${joinNames(plan.asNeeded.map((r) => medicineLabel(r.item)))}।`);
  if (plan.unscheduled.length) {
    parts.push(`${joinNames(plan.unscheduled.map((r) => medicineLabel(r.item)))}: पर्चे से समय समझ नहीं आया, परिवार से पूछिए।`);
  }
  if (!parts.length) {
    return plan.finished.length ? "आज कोई दवा तय नहीं है। पर्चे की सारी दवाओं के दिन पूरे हो चुके हैं।" : "आज के लिए कोई तय दवा नहीं है।";
  }
  const missed = plan.slots.some((s) => s.doses.some((d) => d.status === "missed"));
  return `आज की दवाएँ। ${parts.join(" ")}${missed ? ` ${MISSED_NOTE}` : ""}`;
}

/** The spoken reminder at a dose time (and the system notification's text). Names the unmarked medicines. */
export function reminderText(slot: TodaySlot): string {
  const due = dueNow(slot);
  const names = joinNames(due.map((d) => medicineLabel(d.item)));
  const how = due
    .map((d) => ({ name: medicineLabel(d.item), line: doseLineHi(d) }))
    .filter(({ name, line }) => line !== name)
    .map(({ line }) => `${line}।`)
    .join(" ");
  return `${slotTimeHi(slot.slot, slot.time)}। ${names} लेने का समय हो गया है।${how ? ` ${how}` : ""} अगर पहले ही ले ली है, तो दोबारा न लें। लेने के बाद आज की सूची में 'मैंने ली' दबाइए।`;
}

/** Title of the system notification. */
export const REMINDER_TITLE = "नयन: दवा का समय";

const TIME_ERROR: Record<SlotTimeError["code"], (slot: Slot) => string> = {
  invalid: (slot) => `${SLOT_HI[slot]} का समय ठीक से भरिए, जैसे 08:00।`,
  order: (slot) => `${SLOT_HI[slot]} का समय पिछले समय के बाद होना चाहिए। क्रम है: सुबह, दोपहर, शाम, रात।`,
  gap: (slot) =>
    slot === "morning"
      ? "रात और अगली सुबह के समय के बीच कम से कम एक घंटा रखिए।"
      : `${SLOT_HI[slot]} का समय पिछले समय से कम से कम एक घंटा बाद रखिए।`,
};

/** Everything else the Today screen and the reminders say. */
export const SAY_TODAY = {
  noPrescription: "अभी कोई पर्चा सेव नहीं है। पहले जाँचें में डॉक्टर के पर्चे की फ़ोटो लीजिए।",
  marked: (item: Named, slot: Slot) => `${medicineLabel(item)}: ${SLOT_HI[slot]} की खुराक ली हुई दर्ज कर दी।`,
  unmarked: (item: Named, slot: Slot) => `${medicineLabel(item)}: ${SLOT_HI[slot]} की खुराक का निशान हटा दिया।`,
  remindersOn: "याद दिलाना चालू। जब तक नयन खुला है, दवा के समय नयन बोलकर बताएगा।",
  remindersOff: "याद दिलाना बंद।",
  timesSaved: (times: Readonly<Record<Slot, string>>, countsCleared = false) =>
    `दवा का समय सेव हो गया: ${SLOTS.map((s) => slotTimeHi(s, times[s])).join(", ")}।` +
    (countsCleared ? " समय बदलने से पत्तों की पुरानी गिनती हटा दी गई है; अगली खुराक जाँच में गिनती नई शुरू होगी।" : ""),
  timeError: (e: SlotTimeError) => TIME_ERROR[e.code](e.slot),
  defaultsFilled: "सुबह 8, दोपहर 2, शाम 6 और रात 9 बजे भर दिए। रखने के लिए समय सेव करें दबाइए।",
  notifyGranted: "सूचना की अनुमति मिल गई। दवा के समय फ़ोन पर सूचना भी आएगी, जब तक नयन खुला है।",
  notifyDenied: "सूचना की अनुमति नहीं मिली। चाहें तो ब्राउज़र की सेटिंग में जाकर दे सकते हैं। नयन खुला रहने पर बोलकर याद दिलाता रहेगा।",
  notifyUnsupported: "इस ब्राउज़र में सूचनाएँ नहीं चलतीं। नयन खुला रहने पर बोलकर याद दिलाएगा।",
  next: (slot: Slot, hhmm: string, tomorrow: boolean) => `अगली खुराक ${tomorrow ? "कल " : ""}${slotTimeHi(slot, hhmm)}।`,
};

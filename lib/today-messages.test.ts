import { describe, expect, it } from "vitest";
import { clockHi, doseLineHi, reminderText, SAY_TODAY, slotTimeHi, todaySpeech } from "./today-messages";
import { todayPlan } from "./today";
import type { SlotTimes } from "./blister";
import type { DoseLogEntry, Prescription, PrescriptionItem } from "./types";
import { SLOTS } from "./types";

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const TIMES: SlotTimes = { morning: "08:00", afternoon: "14:00", evening: "18:00", night: "21:00" };
const item = (id: string, frequency: string, extra: Partial<PrescriptionItem> = {}): PrescriptionItem => ({
  id,
  nameAsWritten: id,
  ingredients: [],
  form: "tablet",
  frequency,
  timing: null,
  durationDays: null,
  ...extra,
});
const rx = (items: PrescriptionItem[]): Prescription => ({ items, savedAt: at(1, 7).toISOString() });

const DOLO = item("Dolo 650", "1-0-1", { timing: "after food", tag: "one_dot" });
const PAN = item("Pan 40", "2-0-0", { timing: "before food" });

describe("clock and slot names", () => {
  it("reads times on a 12-hour clock, as people say them", () => {
    expect(clockHi("08:00")).toBe("8 बजे");
    expect(clockHi("14:00")).toBe("2 बजे");
    expect(clockHi("12:00")).toBe("12 बजे");
    expect(clockHi("20:30")).toBe("8 बजकर 30 मिनट");
    expect(clockHi("00:15")).toBe("12 बजकर 15 मिनट");
    expect(slotTimeHi("night", "21:00")).toBe("रात 9 बजे");
  });

  it("names a medicine by its tag, with tablet count and food timing", () => {
    expect(doseLineHi({ item: DOLO, tablets: 1 })).toBe("एक बिंदु वाली दवा, खाना खाने के बाद");
    expect(doseLineHi({ item: PAN, tablets: 2 })).toBe("Pan 40, 2 गोलियाँ, खाना खाने से पहले");
    expect(doseLineHi({ item: { ...PAN, form: "capsule" }, tablets: 2 })).toBe("Pan 40, 2 कैप्सूल, खाना खाने से पहले");
    // Two "units" of a syrup are not tablets.
    expect(doseLineHi({ item: { ...PAN, form: "syrup" }, tablets: 2 })).toBe("Pan 40, खाना खाने से पहले");
  });
});

describe("todaySpeech", () => {
  it("reads each dose time with its medicines (the agreed sentence)", () => {
    expect(todaySpeech(todayPlan(rx([DOLO]), TIMES, [], at(3, 6)))).toBe(
      "आज की दवाएँ। सुबह 8 बजे: एक बिंदु वाली दवा, खाना खाने के बाद। रात 9 बजे: एक बिंदु वाली दवा, खाना खाने के बाद।",
    );
  });

  it("says what is marked, what is due and what is not recorded, without telling to catch up", () => {
    const doseLog: DoseLogEntry[] = [{ itemId: "Dolo 650", slot: "morning", date: "2026-11-03", at: at(3, 8).toISOString() }];
    const text = todaySpeech(todayPlan(rx([DOLO, PAN, item("Crocin", "SOS")]), TIMES, doseLog, at(3, 20, 45)));
    expect(text).toContain("सुबह 8 बजे: एक बिंदु वाली दवा, खाना खाने के बाद, ली हुई दर्ज है; Pan 40, 2 गोलियाँ, खाना खाने से पहले, ली हुई दर्ज नहीं है।");
    expect(text).toContain("रात 9 बजे: एक बिंदु वाली दवा, खाना खाने के बाद, अभी इसका समय है।");
    expect(text).toContain("ज़रूरत पड़ने पर: Crocin।");
    expect(text).toContain("दूसरी खुराक के साथ न लें");
  });

  it("has a sentence for an empty day", () => {
    expect(todaySpeech(todayPlan(rx([item("x", "SOS")]), TIMES, [], at(3, 9)))).toBe("आज की दवाएँ। ज़रूरत पड़ने पर: x।");
    expect(todaySpeech(todayPlan(null, TIMES, [], at(3, 9)))).toBe("आज के लिए कोई तय दवा नहीं है।");
    const over: Prescription = { items: [item("x", "OD", { durationDays: 1 })], savedAt: at(1, 7).toISOString() };
    expect(todaySpeech(todayPlan(over, TIMES, [], at(3, 9)))).toContain("दिन पूरे हो चुके हैं");
  });
});

describe("reminderText", () => {
  it("names the unmarked medicines by tag and says not to take a dose twice", () => {
    const plan = todayPlan(rx([DOLO]), TIMES, [], at(3, 8));
    const text = reminderText(plan.slots[0]);
    expect(text).toContain("सुबह 8 बजे। एक बिंदु वाली दवा लेने का समय हो गया है।");
    expect(text).toContain("एक बिंदु वाली दवा, खाना खाने के बाद।");
    expect(text).toContain("अगर पहले ही ले ली है, तो दोबारा न लें।");
  });

  it("joins several medicines and leaves out ones already marked", () => {
    const three = rx([DOLO, PAN, item("Telma 40", "OD")]);
    const plan = todayPlan(three, TIMES, [], at(3, 8));
    expect(reminderText(plan.slots[0])).toContain("एक बिंदु वाली दवा, Pan 40 और Telma 40 लेने का समय हो गया है।");
    const marked = todayPlan(three, TIMES, [{ itemId: "Pan 40", slot: "morning", date: "2026-11-03", at: "x" }], at(3, 8));
    expect(reminderText(marked.slots[0])).toContain("एक बिंदु वाली दवा और Telma 40 लेने का समय हो गया है।");
  });
});

describe("safety wording", () => {
  it("never tells the user to take a medicine except as the reminder of the prescribed time", () => {
    const plan = todayPlan(rx([DOLO, PAN]), TIMES, [], at(3, 12));
    const texts = [
      todaySpeech(plan),
      reminderText(todayPlan(rx([DOLO, PAN]), TIMES, [], at(3, 8)).slots[0]),
      SAY_TODAY.noPrescription,
      SAY_TODAY.marked(DOLO, "morning"),
      SAY_TODAY.unmarked(DOLO, "morning"),
      SAY_TODAY.remindersOn,
      SAY_TODAY.remindersOff,
      SAY_TODAY.timesSaved(TIMES),
      SAY_TODAY.notifyGranted,
      SAY_TODAY.notifyDenied,
      SAY_TODAY.notifyUnsupported,
      ...SLOTS.flatMap((s) => (["invalid", "order", "gap"] as const).map((code) => SAY_TODAY.timeError({ code, slot: s }))),
    ];
    for (const t of texts) {
      // Every "लें" (take) is negated: "न लें".
      for (const m of t.matchAll(/लें/g)) expect(t.slice(Math.max(0, (m.index ?? 0) - 2), m.index)).toBe("न ");
      expect(t).not.toMatch(/एक साथ ले|ज़्यादा ले|बाद में ले/);
    }
  });
});

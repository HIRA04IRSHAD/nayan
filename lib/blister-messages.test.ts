import { describe, expect, it } from "vitest";
import { evaluateBlister, type BlisterInput, type BlisterResult, type NotSureReason } from "./blister";
import { blisterEnglish, blisterText, medicineLabel, SAY_DOSE } from "./blister-messages";
import type { BlisterBaseline, BlisterReading, PrescriptionItem } from "./types";

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const TIMES = { morning: "08:00", afternoon: "14:00", evening: "18:00", night: "21:00" };
const read = (empty: number, total = 10): BlisterReading => ({ total_pockets: total, empty_pockets: empty, whole_strip_visible: true, confidence: 0.95 });
const base = (when: Date, empty: number, total = 10): BlisterBaseline => ({ at: when.toISOString(), emptyPockets: empty, totalPockets: total });

const dolo: PrescriptionItem = { id: "rx1", nameAsWritten: "Dolo 650", ingredients: [], form: "tablet", frequency: "1-0-1", timing: null, durationDays: 5 };
const tagged: PrescriptionItem = { ...dolo, tag: "two_dots" };

function evalAt(now: Date, empty: number | null, baseline: BlisterBaseline | null, over: Partial<BlisterInput> = {}): BlisterResult {
  const r = empty == null ? null : read(empty);
  return evaluateBlister({ reading1: r, reading2: r, baseline, now, item: dolo, slotTimes: TIMES, ...over });
}

const night = base(at(9, 21, 30), 4);

describe("blisterText", () => {
  it("names the medicine by its tactile tag when it has one", () => {
    expect(medicineLabel(tagged)).toBe("दो बिंदु वाली दवा");
    expect(medicineLabel(dolo)).toBe("Dolo 650");
    expect(blisterText(evalAt(at(10, 8, 5), 5, night), tagged, at(10, 8, 5))).toMatch(/^दो बिंदु वाली दवा: /);
    expect(blisterText(evalAt(at(10, 8, 5), 5, night), dolo, at(10, 8, 5))).toMatch(/^Dolo 650: /);
  });

  it("already taken: the pitch sentence, and do not take again", () => {
    const text = blisterText(evalAt(at(10, 8, 5), 5, night), dolo, at(10, 8, 5));
    expect(text).toContain("लगता है आज सुबह की गोली पहले ही ले ली गई है।");
    expect(text).toContain("दोबारा न लें");
  });

  it("after midnight the night dose is not called today's", () => {
    const now = at(10, 0, 30);
    const text = blisterText(evalAt(now, 5, base(at(9, 20), 4)), dolo, now);
    expect(text).toContain("लगता है रात की गोली पहले ही ले ली गई है।");
  });

  it("take now only restates the schedule and asks to mark it", () => {
    const text = blisterText(evalAt(at(10, 8, 5), 4, night), dolo, at(10, 8, 5));
    expect(text).toContain("पर्चे के हिसाब से अभी सुबह की खुराक का समय है");
    expect(text).toContain("'मैंने अभी ली'");
  });

  it("double dose is a strong warning; missed never says to catch up", () => {
    const extra = blisterText(evalAt(at(10, 8, 30), 6, night), dolo, at(10, 8, 30));
    expect(extra).toContain("सावधान!");
    expect(extra).toContain("1 खाना उम्मीद से ज़्यादा खाली है");
    const missed = blisterText(evalAt(at(10, 15, 30), 4, night), dolo, at(10, 15, 30));
    expect(missed).toContain("एक साथ न लें");
    expect(missed).toContain("डॉक्टर या केमिस्ट");
  });

  it("ok says when the next dose is", () => {
    const text = blisterText(evalAt(at(10, 15, 30), 5, base(at(10, 8, 5), 5)), dolo, at(10, 15, 30));
    expect(text).toContain("अगली खुराक रात 21:00 बजे है।");
  });

  it("first count and new strip say what was saved; in a dose window they explain the button", () => {
    const first = blisterText(evalAt(at(10, 15), 2, null), dolo, at(10, 15));
    expect(first).toContain("10 में से 2 खाने खाली हैं");
    expect(first).not.toContain("मैंने अभी ली");
    expect(blisterText(evalAt(at(10, 8, 10), 2, null), dolo, at(10, 8, 10))).toContain("'मैंने अभी ली'");
    expect(blisterText(evalAt(at(10, 15), 1, night, { reading1: read(1, 15), reading2: read(1, 15) }), dolo, at(10, 15))).toContain("नया पत्ता");
  });

  it("an empty strip is mentioned", () => {
    expect(blisterText(evalAt(at(10, 8, 5), 10, base(at(9, 21, 30), 9)), dolo, at(10, 8, 5))).toContain("यह पत्ता अब खाली है।");
  });

  it("has a not-sure sentence for every reason", () => {
    const reasons: NotSureReason[] = [
      "missing_read",
      "no_strip",
      "impossible",
      "not_whole",
      "disagree",
      "low_confidence",
      "no_schedule",
      "part_dose",
      "which_dose",
      "log_disagrees",
      "count_before_dose",
      "part_taken",
    ];
    for (const reason of reasons) {
      const r: BlisterResult = { ...evalAt(at(10, 8), null, null), outcome: "not_sure", reason };
      const text = blisterText(r, dolo, at(10, 8));
      expect(text, reason).toMatch(/^Dolo 650: \S/);
      expect(text, reason).not.toContain("undefined");
    }
    expect(SAY_DOSE.cannotCheck(dolo, "no_schedule")).toContain("तय समय नहीं");
  });

  it("never tells the user to take a medicine: every 'लें' is negated and every 'लीजिए' is about a photo", () => {
    const scenarios: BlisterResult[] = [
      evalAt(at(10, 8, 5), 4, night), // ok_take_now
      evalAt(at(10, 8, 5), 5, night), // already_taken
      evalAt(at(10, 15, 30), 5, base(at(10, 8, 5), 5)), // ok
      evalAt(at(10, 8, 30), 7, night), // extra_taken
      evalAt(at(10, 15, 30), 4, night), // missed
      evalAt(at(10, 8, 5), 0, night), // new_strip
      evalAt(at(10, 8, 10), 2, null), // baseline_set
      evalAt(at(10, 8, 5), null, night, { reading1: read(4), reading2: read(5) }), // not sure
      evalAt(at(10, 21, 5), 5, night), // which dose
      evalAt(at(10, 7, 30), 3, base(at(10, 6, 55), 3)), // count made just before the dose window
    ];
    expect(scenarios.at(-1)?.reason).toBe("count_before_dose");
    expect(new Set(scenarios.map((s) => s.outcome)).size).toBe(8);
    for (const r of scenarios) {
      const text = blisterText(r, dolo, at(10, 8));
      for (const m of text.matchAll(/लें/g)) expect(text.slice(Math.max(0, m.index! - 2), m.index), text).toBe("न ");
      const photo = "फ़ोटो ";
      for (const m of text.matchAll(/लीजिए/g)) expect(text.slice(Math.max(0, m.index! - photo.length), m.index), text).toBe(photo);
    }
  });
});

describe("blisterEnglish", () => {
  it("summarises the counts for a sighted helper", () => {
    expect(blisterEnglish(evalAt(at(10, 8, 5), 4, night))).toBe("DOSE CHECK: OK_TAKE_NOW, empty 4/10, expected 5, current dose: morning");
  });
});

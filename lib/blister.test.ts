import { describe, expect, it } from "vitest";
import {
  agreedCount,
  currentDose,
  doseTimesBetween,
  dosesDueBetween,
  evaluateBlister,
  expectedEmptyNow,
  localDate,
  markTaken,
  MIN_CONFIDENCE,
  type BlisterInput,
  type SlotTimes,
} from "./blister";
import { tabletsPerSlot } from "./schedule";
import type { BlisterBaseline, BlisterReading, DoseLogEntry } from "./types";

// Local times in November 2026 (all logic is in local time, so these pass in any time zone).
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const iso = (d: Date) => d.toISOString();

const TIMES: SlotTimes = { morning: "08:00", afternoon: "14:00", evening: "18:00", night: "21:00" };
const BD = ["morning", "night"] as const;
const QID = ["morning", "afternoon", "evening", "night"] as const;

const read = (empty: number, total = 10, confidence = 0.95, whole = true): BlisterReading => ({
  total_pockets: total,
  empty_pockets: empty,
  whole_strip_visible: whole,
  confidence,
});
const base = (when: Date, empty: number, total = 10): BlisterBaseline => ({ at: iso(when), emptyPockets: empty, totalPockets: total });

function run(over: Partial<BlisterInput> & { now: Date }, empty?: number, total = 10) {
  const r = empty == null ? null : read(empty, total);
  return evaluateBlister({
    reading1: r,
    reading2: r,
    baseline: null,
    item: { id: "rx1", frequency: "1-0-1" },
    slotTimes: TIMES,
    ...over,
  });
}

describe("tabletsPerSlot", () => {
  it("reads whole tablets per slot", () => {
    expect(tabletsPerSlot("1-0-1")).toEqual({ morning: 1, night: 1 });
    expect(tabletsPerSlot("2-0-1")).toEqual({ morning: 2, night: 1 });
    expect(tabletsPerSlot("1-1-1-1")).toEqual({ morning: 1, afternoon: 1, evening: 1, night: 1 });
    expect(tabletsPerSlot("BD")).toEqual({ morning: 1, night: 1 });
    expect(tabletsPerSlot("OD")).toEqual({ morning: 1 });
    expect(tabletsPerSlot("HS")).toEqual({ night: 1 });
  });

  it("gives up on half tablets, as-needed and unknown patterns", () => {
    expect(tabletsPerSlot("½-0-½")).toBeNull();
    expect(tabletsPerSlot("1/2-0-1")).toBeNull();
    expect(tabletsPerSlot("SOS")).toBeNull();
    expect(tabletsPerSlot("0-0-0")).toBeNull();
    expect(tabletsPerSlot("as directed")).toBeNull();
    expect(tabletsPerSlot(null)).toBeNull();
  });
});

describe("dosesDueBetween", () => {
  it("counts dose times with from < t <= to", () => {
    expect(dosesDueBetween(at(10, 7), at(10, 22), BD, TIMES)).toBe(2);
    expect(dosesDueBetween(at(10, 8), at(10, 21), BD, TIMES)).toBe(1); // 08:00 excluded, 21:00 included
    expect(dosesDueBetween(at(10, 7, 59), at(10, 8), BD, TIMES)).toBe(1);
    expect(dosesDueBetween(at(10, 8), at(10, 8), BD, TIMES)).toBe(0);
  });

  it("crosses midnight and several days", () => {
    expect(dosesDueBetween(at(9, 22), at(11, 8, 30), BD, TIMES)).toBe(3); // 10th 08:00 + 21:00, 11th 08:00
    expect(dosesDueBetween(at(1, 0), at(8, 0), ["morning"], TIMES)).toBe(7);
    expect(dosesDueBetween(at(10, 0), at(11, 0), QID, TIMES)).toBe(4);
  });

  it("is zero for an empty or backwards range, and across month ends uses clock times", () => {
    expect(dosesDueBetween(at(10, 22), at(10, 7), BD, TIMES)).toBe(0);
    const times = doseTimesBetween(new Date(2026, 10, 30, 20), new Date(2026, 11, 1, 9), BD, TIMES);
    expect(times.map((t) => [t.slot, t.at.getDate(), t.at.getHours()])).toEqual([
      ["night", 30, 21],
      ["morning", 1, 8],
    ]);
  });

  it("returns times in clock order even when a slot time is set out of order", () => {
    const odd = { ...TIMES, night: "07:00" };
    const times = doseTimesBetween(at(10, 0), at(10, 23), BD, odd);
    expect(times.map((t) => t.slot)).toEqual(["night", "morning"]);
  });

  it("skips a slot whose time is broken", () => {
    expect(dosesDueBetween(at(10, 0), at(11, 0), BD, { ...TIMES, night: "late" })).toBe(1);
  });
});

describe("currentDose", () => {
  const slot = (d: Date, slots: readonly ("morning" | "afternoon" | "evening" | "night")[] = BD) => currentDose(d, slots, TIMES)?.slot ?? null;

  it("opens an hour before the dose time and closes four hours after", () => {
    expect(slot(at(10, 6, 59))).toBeNull();
    expect(slot(at(10, 7))).toBe("morning");
    expect(slot(at(10, 11, 59))).toBe("morning");
    expect(slot(at(10, 12))).toBeNull();
  });

  it("cuts a window short where the next dose's window opens (several slots a day)", () => {
    expect(slot(at(10, 16, 59), QID)).toBe("afternoon");
    expect(slot(at(10, 17), QID)).toBe("evening"); // afternoon 14:00 + 4 h = 18:00, but evening opens at 17:00
    expect(slot(at(10, 19, 59), QID)).toBe("evening");
    expect(slot(at(10, 20), QID)).toBe("night");
  });

  it("keeps the night dose current past midnight, dated the evening before", () => {
    const d = currentDose(at(10, 0, 30), BD, TIMES);
    expect(d?.slot).toBe("night");
    expect(localDate(d!.at)).toBe("2026-11-09");
    expect(slot(at(10, 1))).toBeNull();
  });
});

describe("agreedCount", () => {
  it("needs both reads", () => {
    expect(agreedCount(read(3), null)).toBe("missing_read");
    expect(agreedCount(null, null)).toBe("missing_read");
  });

  it("rejects impossible numbers and no strip", () => {
    expect(agreedCount(read(0, 0), read(0, 0))).toBe("no_strip");
    expect(agreedCount(read(11, 10), read(11, 10))).toBe("impossible");
    expect(agreedCount(read(-1), read(-1))).toBe("impossible");
    expect(agreedCount(read(2.5), read(2.5))).toBe("impossible");
    expect(agreedCount(read(3, 140), read(3, 140))).toBe("impossible");
  });

  it("needs the whole strip in both photos' reads", () => {
    expect(agreedCount(read(3), read(3, 10, 0.95, false))).toBe("not_whole");
  });

  it("needs the two counts to agree exactly", () => {
    expect(agreedCount(read(3), read(4))).toBe("disagree");
    expect(agreedCount(read(3, 10), read(3, 12))).toBe("disagree");
  });

  it("needs both reads to be confident", () => {
    expect(agreedCount(read(3, 10, 0.84), read(3))).toBe("low_confidence");
    expect(agreedCount(read(3, 10, MIN_CONFIDENCE), read(3, 10, MIN_CONFIDENCE))).toEqual({ empty: 3, total: 10 });
  });
});

describe("evaluateBlister: not sure", () => {
  it("cannot check as-needed, unknown or half-tablet schedules", () => {
    expect(run({ now: at(10, 8), item: { id: "rx1", frequency: "SOS" } }, 3).reason).toBe("no_schedule");
    expect(run({ now: at(10, 8), item: { id: "rx1", frequency: null } }, 3).reason).toBe("no_schedule");
    expect(run({ now: at(10, 8), item: { id: "rx1", frequency: "½-0-½" } }, 3).reason).toBe("part_dose");
    expect(run({ now: at(10, 8), slotTimes: { ...TIMES, morning: "8 am" } }, 3).reason).toBe("no_schedule");
  });

  it("never saves a count it does not trust", () => {
    const r = evaluateBlister({
      reading1: read(4),
      reading2: read(5),
      baseline: base(at(9, 21, 30), 4),
      now: at(10, 8, 5),
      item: { id: "rx1", frequency: "1-0-1" },
      slotTimes: TIMES,
    });
    expect(r).toMatchObject({ outcome: "not_sure", reason: "disagree", baseline: null, canMarkTaken: false });
  });

  it("says not sure for a torn or cut strip (not whole) and a blurry one", () => {
    const torn = read(4, 10, 0.95, false);
    expect(run({ now: at(10, 8), reading1: torn, reading2: torn }).reason).toBe("not_whole");
    const blur = read(4, 10, 0.5);
    expect(run({ now: at(10, 8), reading1: blur, reading2: blur }).reason).toBe("low_confidence");
  });
});

describe("evaluateBlister: first count", () => {
  it("records a baseline outside any dose window", () => {
    const r = run({ now: at(10, 15) }, 2);
    expect(r).toMatchObject({ outcome: "baseline_set", current: null, canMarkTaken: false });
    expect(r.baseline).toEqual(base(at(10, 15), 2));
    expect(r.next?.slot).toBe("night");
  });

  it("just after a dose time, assumes the photo already shows that dose and offers 'I took it now'", () => {
    const r = run({ now: at(10, 8, 10) }, 2);
    expect(r).toMatchObject({ outcome: "baseline_set", canMarkTaken: true });
    expect(r.current?.slot).toBe("morning");
    expect(r.baseline).toEqual(base(at(10, 8, 10), 2));
  });

  it("just before a dose time (early window), the count covers that dose time", () => {
    const r = run({ now: at(10, 7, 30) }, 2);
    expect(r.baseline).toEqual(base(at(10, 8), 2));
    expect(r.canMarkTaken).toBe(true);
  });

  it("starts again from a count that is too old or from the future", () => {
    expect(run({ now: at(21, 15), baseline: base(at(10, 15), 2) }, 6)).toMatchObject({ outcome: "baseline_set", reason: "stale" });
    expect(run({ now: at(10, 15), baseline: base(at(10, 18), 2) }, 2)).toMatchObject({ outcome: "baseline_set", reason: "stale" });
    expect(run({ now: at(10, 15), baseline: { at: "garbage", emptyPockets: 2, totalPockets: 10 } }, 2).reason).toBe("stale");
  });
});

describe("evaluateBlister: compared with the saved count (1-0-1)", () => {
  const night = base(at(9, 21, 30), 4); // last night's count, after the night dose

  it("morning, one pocket fewer than expected: the current dose is still in the strip", () => {
    const r = run({ now: at(10, 8, 5), baseline: night }, 4);
    expect(r).toMatchObject({ outcome: "ok_take_now", expected: 5, canMarkTaken: true, baseline: null });
    expect(r.current).toMatchObject({ slot: "morning", tablets: 1 });
  });

  it("also within the hour before the dose time", () => {
    expect(run({ now: at(10, 7, 15), baseline: night }, 4).outcome).toBe("ok_take_now");
  });

  it("morning, as many empty as expected: already taken, and the count is refreshed", () => {
    const r = run({ now: at(10, 8, 5), baseline: night }, 5);
    expect(r).toMatchObject({ outcome: "already_taken", expected: 5, canMarkTaken: false });
    expect(r.baseline).toEqual(base(at(10, 8, 5), 5));
  });

  it("afternoon, as expected and no dose due: ok, with the next dose time", () => {
    const r = run({ now: at(10, 15, 30), baseline: base(at(10, 8, 5), 5) }, 5);
    expect(r).toMatchObject({ outcome: "ok", expected: 5, current: null });
    expect(r.next?.slot).toBe("night");
    // The saved count (made at the morning dose time) is kept: it predicts later checks exactly the same.
    expect(r.baseline).toBeNull();
  });

  it("one more pocket empty than expected: possible double dose", () => {
    const r = run({ now: at(10, 8, 30), baseline: night }, 6);
    expect(r).toMatchObject({ outcome: "extra_taken", difference: 1 });
    expect(r.baseline).toEqual(base(at(10, 8, 30), 6)); // warned once; the next check starts from this photo
    expect(run({ now: at(10, 15, 30), baseline: base(at(10, 8, 5), 5) }, 7)).toMatchObject({ outcome: "extra_taken", difference: 2 });
  });

  it("a dose time passed without its dose (no window open): missed", () => {
    const r = run({ now: at(10, 15, 30), baseline: night }, 4);
    expect(r).toMatchObject({ outcome: "missed", difference: 1, expected: 5, canMarkTaken: false });
  });

  it("at a dose time, more than the current dose short: missed (beyond the current dose)", () => {
    const r = run({ now: at(10, 21, 5), baseline: night }, 4);
    expect(r).toMatchObject({ outcome: "missed", difference: 1, expected: 6, canMarkTaken: true });
  });

  it("one dose short with an earlier dose also expected: which dose is missing is unknown", () => {
    const r = run({ now: at(10, 21, 5), baseline: night }, 5);
    expect(r).toMatchObject({ outcome: "not_sure", reason: "which_dose", baseline: null });
  });

  it("the dose log can tell which dose is missing", () => {
    const log: DoseLogEntry[] = [{ itemId: "rx1", slot: "morning", date: "2026-11-10", at: iso(at(10, 8, 2)) }];
    expect(run({ now: at(10, 21, 5), baseline: night, doseLog: log }, 5).outcome).toBe("ok_take_now");
    const otherItem = log.map((e) => ({ ...e, itemId: "rx2" }));
    expect(run({ now: at(10, 21, 5), baseline: night, doseLog: otherItem }, 5).reason).toBe("which_dose");
  });

  it("never says 'not taken yet' when the user marked the current dose as taken", () => {
    const log: DoseLogEntry[] = [{ itemId: "rx1", slot: "morning", date: "2026-11-10", at: iso(at(10, 8, 1)) }];
    expect(run({ now: at(10, 8, 5), baseline: night, doseLog: log }, 4)).toMatchObject({ outcome: "not_sure", reason: "log_disagrees" });
  });
});

describe("evaluateBlister: new strip and multi-strip packs", () => {
  const night = base(at(9, 21, 30), 4);

  it("a different number of pockets is a new strip", () => {
    const r = run({ now: at(10, 15), baseline: night }, 1, 15);
    expect(r).toMatchObject({ outcome: "new_strip" });
    expect(r.baseline).toEqual(base(at(10, 15), 1, 15));
  });

  it("fewer empty pockets than last time is a new strip (the next strip of a pack)", () => {
    const r = run({ now: at(10, 8, 5), baseline: night }, 0);
    expect(r).toMatchObject({ outcome: "new_strip", canMarkTaken: true });
    expect(r.baseline).toEqual(base(at(10, 8, 5), 0));
  });

  it("two strips in one photo are not read as one big strip", () => {
    const two = read(5, 20, 0.95, false); // the prompt asks for whole_strip_visible=false with more than one strip
    expect(run({ now: at(10, 8, 5), baseline: night, reading1: two, reading2: two }).reason).toBe("not_whole");
  });

  it("a 30-pocket strip is counted like any other", () => {
    expect(run({ now: at(10, 8, 5), baseline: base(at(9, 21, 30), 20, 30) }, 21, 30).outcome).toBe("already_taken");
  });
});

describe("evaluateBlister: all pockets empty", () => {
  it("the last tablet taken: already taken, strip finished", () => {
    const r = run({ now: at(10, 8, 5), baseline: base(at(9, 21, 30), 9) }, 10);
    expect(r).toMatchObject({ outcome: "already_taken", finished: true });
  });

  it("a dose due but the strip is empty: no 'I took it now'", () => {
    const r = run({ now: at(10, 8, 5), baseline: base(at(9, 21, 30), 10) }, 10);
    expect(r).toMatchObject({ outcome: "ok_take_now", finished: true, canMarkTaken: false });
  });

  it("a first count of an empty strip is saved but offers nothing to take", () => {
    expect(run({ now: at(10, 8, 5) }, 10)).toMatchObject({ outcome: "baseline_set", finished: true, canMarkTaken: false });
  });
});

describe("evaluateBlister: around midnight", () => {
  it("the night dose stays current after midnight", () => {
    const afternoon = base(at(9, 14), 4); // counted well before the night dose
    const r = run({ now: at(10, 0, 30), baseline: afternoon }, 4);
    expect(r).toMatchObject({ outcome: "ok_take_now", expected: 5 });
    expect(localDate(new Date(r.current!.at))).toBe("2026-11-09");
    expect(run({ now: at(10, 0, 30), baseline: afternoon }, 5).outcome).toBe("already_taken");
  });

  it("marking it taken after midnight logs it on the night's date", () => {
    const r = run({ now: at(10, 0, 30), baseline: base(at(9, 14), 4) }, 4);
    const m = markTaken(r, "rx1", at(10, 0, 31));
    expect(m?.dose).toMatchObject({ slot: "night", date: "2026-11-09" });
    expect(m?.baseline).toEqual(base(at(10, 0, 31), 5));
  });
});

describe("evaluateBlister: several slots and tablets per dose", () => {
  it("1-1-1: each dose is checked against the count after the previous one", () => {
    const item = { id: "rx1", frequency: "1-1-1" };
    const morning = base(at(10, 8, 5), 3);
    expect(run({ now: at(10, 14, 10), baseline: morning, item }, 3).outcome).toBe("ok_take_now");
    expect(run({ now: at(10, 14, 10), baseline: morning, item }, 4).outcome).toBe("already_taken");
    expect(run({ now: at(10, 14, 10), baseline: morning, item }, 5).outcome).toBe("extra_taken");
  });

  it("2-0-2: two pockets per dose; one of two taken is not sure", () => {
    const item = { id: "rx1", frequency: "2-0-2" };
    const night = base(at(9, 21, 30), 4, 20);
    const r = run({ now: at(10, 8, 5), baseline: night, item }, 4, 20);
    expect(r).toMatchObject({ outcome: "ok_take_now", expected: 6 });
    expect(r.current?.tablets).toBe(2);
    expect(run({ now: at(10, 8, 5), baseline: night, item }, 5, 20).reason).toBe("part_taken");
    expect(run({ now: at(10, 8, 5), baseline: night, item }, 6, 20).outcome).toBe("already_taken");
    expect(run({ now: at(10, 8, 5), baseline: night, item }, 7, 20)).toMatchObject({ outcome: "extra_taken", difference: 1 });
  });
});

describe("evaluateBlister: baseline set near a dose time", () => {
  it("set just after the morning dose (photo assumed to show it): the night dose is checked alone", () => {
    const first = run({ now: at(10, 8, 10) }, 2).baseline!;
    expect(run({ now: at(10, 21, 5), baseline: first }, 2).outcome).toBe("ok_take_now");
    // If the morning tablet was taken after that photo without tapping "मैंने अभी ली", the error falls on the
    // safe side: "already taken", never "take it now".
    expect(run({ now: at(10, 21, 5), baseline: first }, 3).outcome).toBe("already_taken");
  });

  it("set just before the morning dose with the tablet already out: no false 'missed' or 'take now' later", () => {
    const first = run({ now: at(10, 7, 30) }, 3).baseline!; // morning tablet taken at 07:20, shown in the photo
    expect(run({ now: at(10, 8, 30), baseline: first }, 3).outcome).toBe("already_taken");
    expect(run({ now: at(10, 21, 5), baseline: first }, 3).outcome).toBe("ok_take_now");
    expect(run({ now: at(10, 21, 5), baseline: first }, 4).outcome).toBe("already_taken");
  });

  it("set just before the dose, then taken and marked: the count includes it", () => {
    const r = run({ now: at(10, 7, 30) }, 2);
    const m = markTaken(r, "rx1", at(10, 7, 40))!;
    expect(m.baseline).toEqual(base(at(10, 8), 3)); // covers the 08:00 dose time
    expect(run({ now: at(10, 8, 30), baseline: m.baseline }, 3).outcome).toBe("already_taken");
    expect(run({ now: at(10, 21, 5), baseline: m.baseline }, 3).outcome).toBe("ok_take_now");
  });
});

describe("evaluateBlister: a tablet taken early, then counted before its window", () => {
  // Regression: morning 08:00, tablet taken at 06:45, strip counted at 06:55 (no window open yet). At 07:30 the
  // same count used to give ok_take_now ("not taken yet"), which invites a second dose.
  it("a first count shortly before the dose window never leads to 'not taken yet'", () => {
    const item = { id: "rx1", frequency: "1-0-0" };
    const first = run({ now: at(10, 6, 55), item }, 3);
    expect(first.outcome).toBe("baseline_set");
    const r = run({ now: at(10, 7, 30), baseline: first.baseline!, item }, 3);
    expect(r).toMatchObject({ outcome: "not_sure", reason: "count_before_dose", baseline: null, canMarkTaken: false });
  });

  it("an 'ok' count between doses keeps the dose-time count, so an early tablet reads as already taken", () => {
    const night = base(at(9, 21, 30), 4);
    const ok = run({ now: at(10, 6, 55), baseline: night }, 5); // morning tablet taken at 06:45
    expect(ok).toMatchObject({ outcome: "extra_taken" }); // more than an hour early: warned, not "ok"
    const okBefore = run({ now: at(10, 5, 0), baseline: night }, 4); // nothing taken yet, nothing due
    expect(okBefore).toMatchObject({ outcome: "ok", baseline: null });
    expect(run({ now: at(10, 7, 30), baseline: night }, 5).outcome).toBe("already_taken");
  });

  it("a count made long enough before the dose, or at an earlier dose time, still allows 'not taken yet'", () => {
    expect(run({ now: at(10, 21, 5), baseline: base(at(10, 14, 30), 5) }, 5).outcome).toBe("ok_take_now");
    expect(run({ now: at(10, 21, 5), baseline: base(at(10, 16), 5) }, 5).reason).toBe("count_before_dose");
    expect(run({ now: at(10, 21, 5), baseline: base(at(10, 8, 30), 5) }, 5).outcome).toBe("ok_take_now");
  });

  it("a count made under old slot times never gives 'not taken yet' after the time is moved later", () => {
    // withSlotTimes drops saved counts when times change; this checks the rules are safe even if one survives.
    const item = { id: "rx1", frequency: "1-0-1" };
    const first = run({ now: at(10, 8, 30), item }, 3).baseline!; // morning 08:00 tablet taken and counted
    const moved = { ...TIMES, morning: "09:00" };
    expect(run({ now: at(10, 9, 15), baseline: first, item, slotTimes: moved }, 3).outcome).not.toBe("ok_take_now");
  });

  it("a count stamped inside the window but before the dose time is not a dose-time count", () => {
    expect(run({ now: at(10, 21, 30), baseline: base(at(10, 20, 30), 5) }, 5).reason).toBe("count_before_dose");
  });
});

describe("markTaken", () => {
  it("after 'take now': the count includes the dose and a second scan says already taken", () => {
    const r = run({ now: at(10, 8, 5), baseline: base(at(9, 21, 30), 4) }, 4);
    const m = markTaken(r, "rx1", at(10, 8, 6))!;
    expect(m.baseline).toEqual(base(at(10, 8, 6), 5));
    expect(m.dose).toEqual({ itemId: "rx1", slot: "morning", date: "2026-11-10", at: iso(at(10, 8, 6)) });
    expect(run({ now: at(10, 8, 20), baseline: m.baseline }, 5).outcome).toBe("already_taken");
  });

  it("is refused when the result does not allow it", () => {
    const r = run({ now: at(10, 8, 5), baseline: base(at(9, 21, 30), 4) }, 5); // already taken
    expect(markTaken(r, "rx1", at(10, 8, 6))).toBeNull();
    expect(markTaken(run({ now: at(10, 15) }, 2), "rx1", at(10, 15))).toBeNull(); // no current dose
  });
});

describe("expectedEmptyNow", () => {
  it("predicts the count for the demo buttons", () => {
    expect(expectedEmptyNow(base(at(9, 21, 30), 4), at(10, 8, 5), { frequency: "1-0-1" }, TIMES)).toEqual({ expected: 5, pending: 1 });
    expect(expectedEmptyNow(null, at(10, 8, 5), { frequency: "1-0-1" }, TIMES)).toBeNull();
    expect(expectedEmptyNow(base(at(9, 21, 30), 4), at(10, 8, 5), { frequency: "SOS" }, TIMES)).toBeNull();
  });
});

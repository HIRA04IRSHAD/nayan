import { describe, expect, it } from "vitest";
import {
  courseLastDay,
  isActiveOn,
  NOW_AFTER_MS,
  NOW_BEFORE_MS,
  reminderDue,
  reminderKey,
  todayPlan,
  validateSlotTimes,
  type TodayPlan,
} from "./today";
import type { SlotTimes } from "./blister";
import type { DoseLogEntry, Prescription, PrescriptionItem } from "./types";

// Local times in November 2026 (all logic is in local time, so these pass in any time zone).
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const TIMES: SlotTimes = { morning: "08:00", afternoon: "14:00", evening: "18:00", night: "21:00" };

const item = (id: string, frequency: string | null, durationDays: number | null = null, extra: Partial<PrescriptionItem> = {}): PrescriptionItem => ({
  id,
  nameAsWritten: id.toUpperCase(),
  ingredients: [],
  form: "tablet",
  frequency,
  timing: null,
  durationDays,
  ...extra,
});

const DOLO = item("dolo", "1-0-1", 5, { timing: "after food", tag: "one_dot" });
const PAN = item("pan", "1-0-0", 30);
const TELMA = item("telma", "OD", 30);
const SOS = item("sos", "SOS");
const ODD = item("odd", "as directed");

// Saved early on 1 November, before the first dose window.
const rx = (items: PrescriptionItem[], saved = at(1, 7)): Prescription => ({ items, savedAt: saved.toISOString() });
const RX = rx([DOLO, PAN, TELMA, SOS, ODD]);

const log = (itemId: string, slot: DoseLogEntry["slot"], day: number, h = 8): DoseLogEntry => ({
  itemId,
  slot,
  date: `2026-11-${String(day).padStart(2, "0")}`,
  at: at(day, h, 5).toISOString(),
});

const statuses = (p: TodayPlan) => Object.fromEntries(p.slots.map((s) => [s.slot, s.doses.map((d) => `${d.item.id}:${d.status}`)]));

describe("todayPlan: layout", () => {
  it("puts each medicine under its slots, in time order, with as-needed and unknown ones apart", () => {
    const p = todayPlan(RX, TIMES, [], at(3, 6));
    expect(p.date).toBe("2026-11-03");
    expect(p.slots.map((s) => [s.slot, s.time])).toEqual([
      ["morning", "08:00"],
      ["night", "21:00"],
    ]);
    expect(p.slots[0].doses.map((d) => d.item.id)).toEqual(["dolo", "pan", "telma"]);
    expect(p.slots[1].doses.map((d) => d.item.id)).toEqual(["dolo"]);
    expect(p.slots[0].at).toEqual(at(3, 8));
    expect(p.asNeeded.map((r) => r.item.id)).toEqual(["sos"]);
    expect(p.unscheduled.map((r) => r.item.id)).toEqual(["odd"]);
    expect(p.finished).toEqual([]);
    expect(p.slots[0].doses[1].index).toBe(1);
  });

  it("returns an empty plan without a prescription", () => {
    const p = todayPlan(null, TIMES, [], at(3, 9));
    expect(p).toMatchObject({ date: "2026-11-03", slots: [], asNeeded: [], unscheduled: [], finished: [], next: null });
  });

  it("follows edited slot times and orders slots by time", () => {
    const p = todayPlan(rx([item("q", "1-1-1-1")]), { morning: "06:30", afternoon: "12:00", evening: "17:00", night: "22:15" }, [], at(3, 5));
    expect(p.slots.map((s) => s.time)).toEqual(["06:30", "12:00", "17:00", "22:15"]);
    expect(p.slots[3].at).toEqual(at(3, 22, 15));
  });

  it("gives whole tablets per dose from the pattern", () => {
    const p = todayPlan(rx([item("two", "2-0-1"), item("half", "½-0-½")]), TIMES, [], at(3, 6));
    expect(p.slots[0].doses.map((d) => [d.item.id, d.tablets])).toEqual([
      ["two", 2],
      ["half", null],
    ]);
    expect(p.slots[1].doses.map((d) => [d.item.id, d.tablets])).toEqual([
      ["two", 1],
      ["half", null],
    ]);
  });
});

describe("todayPlan: status", () => {
  it("is upcoming, then now from 30 min before to 2 h after, then missed", () => {
    expect(NOW_BEFORE_MS).toBe(30 * 60_000);
    expect(NOW_AFTER_MS).toBe(2 * 60 * 60_000);
    const morning = (now: Date) => statuses(todayPlan(RX, TIMES, [], now)).morning[0];
    expect(morning(at(3, 7, 29))).toBe("dolo:upcoming");
    expect(morning(at(3, 7, 30))).toBe("dolo:now");
    expect(morning(at(3, 9, 59))).toBe("dolo:now");
    expect(morning(at(3, 10, 0))).toBe("dolo:missed");
    expect(morning(at(3, 23, 59))).toBe("dolo:missed");
  });

  it("is done when the dose log has that medicine, slot and date, whatever the time", () => {
    const p = todayPlan(RX, TIMES, [log("dolo", "morning", 3), log("pan", "morning", 2), log("telma", "night", 3)], at(3, 12));
    expect(statuses(p).morning).toEqual(["dolo:done", "pan:missed", "telma:missed"]);
    expect(p.slots[0].doses[0].takenAt).toBe(at(3, 8, 5).toISOString());
    // A dose marked early (before the window) is still done.
    expect(statuses(todayPlan(RX, TIMES, [log("dolo", "night", 3, 6)], at(3, 6))).night).toEqual(["dolo:done"]);
  });

  it("leaves out doses whose window closed before the prescription was saved", () => {
    const savedAfternoon = rx([DOLO], at(1, 15));
    expect(todayPlan(savedAfternoon, TIMES, [], at(1, 16)).slots.map((s) => s.slot)).toEqual(["night"]);
    // Saved during the morning window: the morning dose is on the list.
    expect(statuses(todayPlan(rx([DOLO], at(1, 9)), TIMES, [], at(1, 9, 30))).morning).toEqual(["dolo:now"]);
    // The next day everything is there.
    expect(todayPlan(savedAfternoon, TIMES, [], at(2, 6)).slots.map((s) => s.slot)).toEqual(["morning", "night"]);
    // A marked dose is shown even then.
    expect(todayPlan(savedAfternoon, TIMES, [log("dolo", "morning", 1)], at(1, 16)).slots.map((s) => s.slot)).toEqual(["morning", "night"]);
  });
});

describe("todayPlan: course length", () => {
  it("lists a medicine for durationDays calendar days from the save date, then as finished", () => {
    expect(statuses(todayPlan(RX, TIMES, [], at(5, 23))).night).toEqual(["dolo:missed"]);
    const p = todayPlan(RX, TIMES, [], at(6, 6));
    expect(p.slots.map((s) => s.slot)).toEqual(["morning"]);
    expect(p.slots[0].doses.map((d) => d.item.id)).toEqual(["pan", "telma"]);
    expect(p.finished.map((f) => [f.item.id, f.lastDay])).toEqual([["dolo", "2026-11-05"]]);
  });

  it("does not hide anything when the save date is unknown or the duration is missing", () => {
    const unknown: Prescription = { items: [DOLO], savedAt: new Date(0).toISOString() };
    expect(todayPlan(unknown, TIMES, [], at(30, 6)).slots).toHaveLength(2);
    expect(todayPlan({ items: [DOLO], savedAt: "garbage" }, TIMES, [], at(30, 6)).slots).toHaveLength(2);
    expect(isActiveOn({ durationDays: null }, at(1, 7), at(30, 6))).toBe(true);
    expect(isActiveOn({ durationDays: 0 }, at(1, 7), at(30, 6))).toBe(true);
  });

  it("counts calendar days (a save late at night still makes that day day 1)", () => {
    expect(courseLastDay({ durationDays: 1 }, at(1, 23, 50))).toEqual(new Date(2026, 10, 1));
    expect(isActiveOn({ durationDays: 1 }, at(1, 23, 50), at(2, 0, 10))).toBe(false);
    expect(courseLastDay({ durationDays: 2.5 }, at(1, 9))).toEqual(new Date(2026, 10, 3));
    // Before the save date (clock changed): still listed.
    expect(isActiveOn({ durationDays: 1 }, at(5, 9), at(3, 9))).toBe(true);
  });
});

describe("todayPlan: next dose", () => {
  it("is the next time with something unmarked, today or tomorrow", () => {
    expect(todayPlan(RX, TIMES, [], at(3, 6)).next).toEqual({ slot: "morning", at: at(3, 8) });
    // During the morning window the morning time is still ahead.
    expect(todayPlan(RX, TIMES, [], at(3, 7, 45)).next).toEqual({ slot: "morning", at: at(3, 8) });
    expect(todayPlan(RX, TIMES, [], at(3, 9)).next).toEqual({ slot: "night", at: at(3, 21) });
    expect(todayPlan(RX, TIMES, [log("dolo", "night", 3, 19)], at(3, 19)).next).toEqual({ slot: "morning", at: at(4, 8) });
    expect(todayPlan(RX, TIMES, [], at(3, 22)).next).toEqual({ slot: "morning", at: at(4, 8) });
  });

  it("knows when tomorrow has nothing left (course over) or nothing has a time", () => {
    const oneDay = rx([item("x", "1-0-1", 1)]);
    expect(todayPlan(oneDay, TIMES, [], at(1, 22)).next).toBeNull();
    expect(todayPlan(rx([SOS, ODD]), TIMES, [], at(3, 9)).next).toBeNull();
  });
});

describe("reminderDue", () => {
  const plan = (now: Date, doseLog: DoseLogEntry[] = []) => todayPlan(RX, TIMES, doseLog, now);

  it("fires at the dose time, not in the early marking window, and not after the window", () => {
    expect(reminderDue(plan(at(3, 7, 45)), at(3, 7, 45), [])).toBeNull();
    expect(reminderDue(plan(at(3, 8)), at(3, 8), [])?.slot).toBe("morning");
    expect(reminderDue(plan(at(3, 9, 59)), at(3, 9, 59), [])?.slot).toBe("morning");
    expect(reminderDue(plan(at(3, 10)), at(3, 10), [])).toBeNull();
  });

  it("fires once per slot per day", () => {
    const fired = [reminderKey("2026-11-03", "morning")];
    expect(fired[0]).toBe("2026-11-03:morning");
    expect(reminderDue(plan(at(3, 8, 30)), at(3, 8, 30), fired)).toBeNull();
    // Yesterday's key does not block today.
    expect(reminderDue(plan(at(4, 8, 30)), at(4, 8, 30), fired)?.slot).toBe("morning");
  });

  it("stays quiet when every dose of the slot is marked, and reminds while any is not", () => {
    const all = [log("dolo", "morning", 3), log("pan", "morning", 3), log("telma", "morning", 3)];
    expect(reminderDue(plan(at(3, 8, 10), all), at(3, 8, 10), [])).toBeNull();
    expect(reminderDue(plan(at(3, 8, 10), all.slice(1)), at(3, 8, 10), [])?.slot).toBe("morning");
  });

  it("does nothing without a prescription or for as-needed medicines", () => {
    expect(reminderDue(todayPlan(null, TIMES, [], at(3, 8)), at(3, 8), [])).toBeNull();
    expect(reminderDue(todayPlan(rx([SOS]), TIMES, [], at(3, 8)), at(3, 8), [])).toBeNull();
  });
});

describe("validateSlotTimes", () => {
  it("accepts the defaults and other sensible days", () => {
    expect(validateSlotTimes(TIMES)).toBeNull();
    expect(validateSlotTimes({ morning: "06:00", afternoon: "07:00", evening: "08:00", night: "23:00" })).toBeNull();
  });

  it("rejects broken times", () => {
    expect(validateSlotTimes({ ...TIMES, evening: "" })).toEqual({ code: "invalid", slot: "evening" });
    expect(validateSlotTimes({ ...TIMES, morning: "8:00" })).toEqual({ code: "invalid", slot: "morning" });
    expect(validateSlotTimes({ ...TIMES, night: "24:00" })).toEqual({ code: "invalid", slot: "night" });
  });

  it("requires morning → afternoon → evening → night, at least an hour apart", () => {
    expect(validateSlotTimes({ ...TIMES, afternoon: "07:00" })).toEqual({ code: "order", slot: "afternoon" });
    expect(validateSlotTimes({ ...TIMES, night: "18:00" })).toEqual({ code: "order", slot: "night" });
    expect(validateSlotTimes({ ...TIMES, night: "18:30" })).toEqual({ code: "gap", slot: "night" });
    // Night to the next morning counts too.
    expect(validateSlotTimes({ morning: "00:15", afternoon: "12:00", evening: "17:00", night: "23:45" })).toEqual({ code: "gap", slot: "morning" });
  });
});

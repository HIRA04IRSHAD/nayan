import { beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_PRESCRIPTION_KEY,
  STORAGE_KEY,
  addDose,
  defaultState,
  getNayanState,
  migrateFromV1,
  parsePrescription,
  parseState,
  readState,
  resetStoreForTests,
  subscribeNayan,
  updateNayan,
  upsertCase,
  updateCase,
  MAX_SAVED_CASES,
  DOSE_LOG_DAYS,
  MAX_REMINDERS_FIRED,
  removeDose,
  withReminderFired,
  withBlisterBaseline,
  withItemTag,
  withPrescription,
  withSettings,
  withSlotTimes,
  withTheme,
  writeState,
  type KeyValueStorage,
} from "./store";
import { DEMO_PRESCRIPTION } from "./fixtures";
import type { NayanState, Prescription } from "./types";

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

/** Storage that refuses writes, like Safari private mode or a full quota. */
class ReadOnlyStorage extends MemoryStorage {
  setItem() {
    throw new Error("QuotaExceededError");
  }
}

class BrokenStorage implements KeyValueStorage {
  getItem(): string | null {
    throw new Error("SecurityError");
  }
  setItem() {
    throw new Error("SecurityError");
  }
  removeItem() {
    throw new Error("SecurityError");
  }
}

const RX: Prescription = { items: DEMO_PRESCRIPTION, savedAt: "2026-11-01T10:00:00.000Z" };

describe("defaults", () => {
  it("has the agreed default settings", () => {
    expect(defaultState()).toEqual({
      prescription: null,
      caregiver: null,
      cases: [],
      blisterBaselines: {},
      doseLog: [],
      remindersFired: [],
      settings: {
        theme: "dark",
        slotTimes: { morning: "08:00", afternoon: "14:00", evening: "18:00", night: "21:00" },
        remindersOn: false,
        voiceOn: true,
      },
    });
  });

  it("returns a fresh object each time (no shared mutable defaults)", () => {
    const a = defaultState();
    a.settings.slotTimes.morning = "07:00";
    expect(defaultState().settings.slotTimes.morning).toBe("08:00");
  });
});

describe("parseState", () => {
  it("round-trips a full state", () => {
    const s: NayanState = {
      prescription: RX,
      caregiver: { name: "Asha", relation: "बेटी" },
      cases: [
        {
          id: "c1",
          token: "t1",
          createdAt: "2026-11-02T09:00:00Z",
          itemLabel: "Dolo 650",
          askedAbout: "Dolo 650",
          status: "answered",
          answer: "correct",
          answeredAt: "2026-11-02T09:05:00Z",
        },
      ],
      blisterBaselines: { rx1: { at: "2026-11-02T09:00:00Z", emptyPockets: 3, totalPockets: 10 } },
      doseLog: [{ itemId: "rx1", slot: "morning", date: "2026-11-02", at: "2026-11-02T08:10:00Z" }],
      remindersFired: ["2026-11-02:morning"],
      settings: {
        theme: "light",
        slotTimes: { morning: "07:30", afternoon: "13:00", evening: "19:00", night: "22:15" },
        remindersOn: true,
        voiceOn: false,
      },
    };
    expect(parseState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it("falls back to defaults for non-objects", () => {
    for (const raw of [undefined, null, 42, "x", [1, 2]]) expect(parseState(raw)).toEqual(defaultState());
  });

  it("fills missing fields with defaults (older or partial saves)", () => {
    const s = parseState({ prescription: RX });
    expect(s.prescription).toEqual(RX);
    expect(s.settings).toEqual(defaultState().settings);
    expect(s.cases).toEqual([]);
  });

  it("repairs one bad field without losing the others", () => {
    const s = parseState({
      prescription: RX,
      settings: { theme: "purple", slotTimes: { morning: "25:00", night: "21:30" }, remindersOn: "yes", voiceOn: "no" },
      cases: "not a list",
      doseLog: [{ itemId: "rx1", slot: "lunch", date: "2026-11-02", at: "x" }, { itemId: "rx2", slot: "night", date: "2026-11-02", at: "y" }],
      blisterBaselines: { rx1: { at: "a", emptyPockets: -1, totalPockets: 10 }, rx2: { at: "b", emptyPockets: 2, totalPockets: 10 } },
    });
    expect(s.prescription).toEqual(RX);
    expect(s.settings).toEqual({
      theme: "dark",
      slotTimes: { morning: "08:00", afternoon: "14:00", evening: "18:00", night: "21:30" },
      remindersOn: false,
      voiceOn: true,
    });
    expect(s.cases).toEqual([]);
    expect(s.doseLog).toEqual([{ itemId: "rx2", slot: "night", date: "2026-11-02", at: "y" }]);
    expect(Object.keys(s.blisterBaselines)).toEqual(["rx2"]);
  });

  it("drops an unreadable prescription line instead of guessing its contents", () => {
    const p = parsePrescription({ items: [DEMO_PRESCRIPTION[0], { id: "bad", nameAsWritten: "X", ingredients: "Paracetamol" }], savedAt: "s" });
    expect(p?.items.map((i) => i.id)).toEqual(["rx1"]);
  });

  it("treats a prescription with no readable line as no prescription", () => {
    expect(parsePrescription({ items: [], savedAt: "s" })).toBeNull();
    expect(parsePrescription({ items: [{ nameAsWritten: "no id" }], savedAt: "s" })).toBeNull();
  });

  it("keeps a valid tag and drops an unknown one", () => {
    const p = parsePrescription({
      items: [
        { ...DEMO_PRESCRIPTION[0], tag: "two_dots" },
        { ...DEMO_PRESCRIPTION[1], tag: "star" },
      ],
      savedAt: "s",
    });
    expect(p?.items[0].tag).toBe("two_dots");
    expect(p?.items[1].tag).toBeUndefined();
    expect(p?.items).toHaveLength(2);
  });

  it("keeps fields a newer build added to a prescription line", () => {
    const p = parsePrescription({ items: [{ ...DEMO_PRESCRIPTION[0], futureField: 7 }], savedAt: "s" });
    expect((p?.items[0] as unknown as Record<string, unknown>).futureField).toBe(7);
  });
});

describe("migration from v1", () => {
  it("copies the v1 prescription into v2 and removes v1", () => {
    const st = new MemoryStorage();
    st.setItem(LEGACY_PRESCRIPTION_KEY, JSON.stringify(RX));
    const s = readState(st);
    expect(s.prescription).toEqual(RX);
    expect(s.settings.theme).toBe("dark");
    expect(st.getItem(LEGACY_PRESCRIPTION_KEY)).toBeNull();
    expect(JSON.parse(st.getItem(STORAGE_KEY)!).prescription).toEqual(RX);
  });

  it("happens only once: an existing v2 entry wins over a leftover v1", () => {
    const st = new MemoryStorage();
    const v2 = withTheme(defaultState(), "light");
    st.setItem(STORAGE_KEY, JSON.stringify(v2));
    st.setItem(LEGACY_PRESCRIPTION_KEY, JSON.stringify(RX));
    expect(readState(st)).toEqual(v2);
  });

  it("keeps v1 when v2 cannot be written, so nothing is lost", () => {
    const st = new ReadOnlyStorage();
    st.data.set(LEGACY_PRESCRIPTION_KEY, JSON.stringify(RX));
    expect(readState(st).prescription).toEqual(RX);
    expect(st.getItem(LEGACY_PRESCRIPTION_KEY)).not.toBeNull();
  });

  it("ignores a corrupt v1 value", () => {
    expect(migrateFromV1("{not json")).toBeNull();
    expect(migrateFromV1(null)).toBeNull();
    const st = new MemoryStorage();
    st.setItem(LEGACY_PRESCRIPTION_KEY, "{not json");
    expect(readState(st)).toEqual(defaultState());
  });
});

describe("readState / writeState", () => {
  it("returns defaults with no storage or broken storage, and never throws", () => {
    expect(readState(null)).toEqual(defaultState());
    expect(readState(new BrokenStorage())).toEqual(defaultState());
    expect(writeState(new BrokenStorage(), defaultState())).toBe(false);
    expect(writeState(null, defaultState())).toBe(false);
  });

  it("returns defaults for a corrupt v2 value", () => {
    const st = new MemoryStorage();
    st.setItem(STORAGE_KEY, "{oops");
    expect(readState(st)).toEqual(defaultState());
  });

  it("writes JSON that reads back the same", () => {
    const st = new MemoryStorage();
    const s = withPrescription(defaultState(), RX);
    expect(writeState(st, s)).toBe(true);
    expect(readState(st)).toEqual(s);
  });
});

describe("updaters", () => {
  it("withItemTag sets one line's tag and leaves the input untouched", () => {
    const s0 = withPrescription(defaultState(), RX);
    const s1 = withItemTag(s0, "rx2", "one_dot");
    expect(s1.prescription!.items.map((i) => i.tag)).toEqual([undefined, "one_dot", undefined]);
    expect(s0.prescription!.items[1].tag).toBeUndefined();
  });

  it("withItemTag is a no-op for an unknown line or no prescription", () => {
    const s0 = withPrescription(defaultState(), RX);
    expect(withItemTag(s0, "nope", "one_dot")).toBe(s0);
    const empty = defaultState();
    expect(withItemTag(empty, "rx1", "one_dot")).toBe(empty);
  });

  it("withPrescription drops pocket counts of medicines that are no longer prescribed", () => {
    let s = withPrescription(defaultState(), RX);
    s = withBlisterBaseline(s, "rx1", { at: "a", emptyPockets: 1, totalPockets: 10 });
    s = withBlisterBaseline(s, "old", { at: "a", emptyPockets: 1, totalPockets: 10 });
    expect(Object.keys(withPrescription(s, RX).blisterBaselines)).toEqual(["rx1"]);
    expect(withPrescription(s, null).blisterBaselines).toEqual({});
  });

  it("withSlotTimes drops saved blister counts only when a time really changes", () => {
    const b = { at: "2026-11-10T03:00:00.000Z", emptyPockets: 3, totalPockets: 10 };
    const s = withBlisterBaseline(withPrescription(defaultState(), RX), "rx1", b);
    const same = withSlotTimes(s, { ...s.settings.slotTimes });
    expect(same).toBe(s);
    const moved = withSlotTimes(s, { ...s.settings.slotTimes, morning: "09:00" });
    expect(moved.settings.slotTimes.morning).toBe("09:00");
    expect(moved.blisterBaselines).toEqual({});
    expect(moved.prescription).toBe(s.prescription);
  });

  it("withSettings merges a partial patch", () => {
    const s = withSettings(defaultState(), { remindersOn: true });
    expect(s.settings.remindersOn).toBe(true);
    expect(s.settings.theme).toBe("dark");
  });

  it("upsertCase replaces by id and keeps newest first", () => {
    const base = { token: "t", createdAt: "c", itemLabel: "Dolo", status: "waiting" as const };
    let s = upsertCase(defaultState(), { ...base, id: "a" });
    s = upsertCase(s, { ...base, id: "b" });
    s = upsertCase(s, { ...base, id: "a", status: "answered", answer: "wrong" });
    expect(s.cases.map((c) => [c.id, c.status])).toEqual([
      ["a", "answered"],
      ["b", "waiting"],
    ]);
  });

  it("upsertCase keeps at most MAX_SAVED_CASES, dropping the oldest", () => {
    const base = { token: "t", createdAt: "c", itemLabel: "Dolo", status: "waiting" as const };
    let s = defaultState();
    for (let i = 0; i < MAX_SAVED_CASES + 5; i++) s = upsertCase(s, { ...base, id: `c${i}` });
    expect(s.cases).toHaveLength(MAX_SAVED_CASES);
    expect(s.cases[0].id).toBe(`c${MAX_SAVED_CASES + 4}`);
    expect(s.cases.some((c) => c.id === "c0")).toBe(false);
  });

  it("updateCase changes one case in place and ignores unknown ids", () => {
    const base = { token: "t", createdAt: "c", itemLabel: "Dolo", status: "waiting" as const };
    const s = upsertCase(upsertCase(defaultState(), { ...base, id: "a" }), { ...base, id: "b" });
    const s2 = updateCase(s, "a", (c) => ({ ...c, status: "answered", answer: "correct" }));
    expect(s2.cases.map((c) => [c.id, c.status])).toEqual([
      ["b", "waiting"],
      ["a", "answered"],
    ]);
    expect(updateCase(s, "zzz", (c) => ({ ...c, status: "expired" }))).toBe(s);
    expect(updateCase(s, "a", (c) => c)).toBe(s);
  });

  it("parseState keeps the caregiver-answer fields and drops bad ones", () => {
    const s = parseState({
      cases: [
        {
          id: "c1",
          token: "t1",
          createdAt: "2026-11-02T09:00:00Z",
          itemLabel: "Dolo 650",
          status: "answered",
          url: "http://x/c/c1#t=t1",
          askedWho: "बेटी प्रिया",
          answer: "correct",
          answerItemIndex: 1,
          answerLine: "2. Pan 40",
          note: "ठीक है",
        },
        { id: "c2", token: "t2", createdAt: "x", itemLabel: "", status: "waiting", answerItemIndex: -3, askedWho: 5 },
      ],
    });
    expect(s.cases[0]).toMatchObject({ askedWho: "बेटी प्रिया", answerItemIndex: 1, answerLine: "2. Pan 40", url: "http://x/c/c1#t=t1" });
    expect(s.cases[1].answerItemIndex).toBeUndefined();
    expect(s.cases[1].askedWho).toBeUndefined();
  });

  it("addDose ignores a second tap for the same dose", () => {
    const e = { itemId: "rx1", slot: "morning" as const, date: "2026-11-02", at: "t1" };
    const s1 = addDose(defaultState(), e);
    expect(addDose(s1, { ...e, at: "t2" })).toBe(s1);
    expect(addDose(s1, { ...e, slot: "night" }).doseLog).toHaveLength(2);
  });

  it("addDose drops entries more than DOSE_LOG_DAYS older than the new one", () => {
    const old = { itemId: "rx1", slot: "morning" as const, date: "2026-09-01", at: "t0" };
    const recent = { ...old, date: "2026-10-01" };
    const bad = { ...old, date: "not a date" };
    let s = addDose(addDose(addDose(defaultState(), old), recent), bad);
    expect(s.doseLog).toHaveLength(3);
    s = addDose(s, { ...old, date: "2026-11-09" });
    expect(s.doseLog.map((d) => d.date)).toEqual(["2026-10-01", "not a date", "2026-11-09"]);
    expect(DOSE_LOG_DAYS).toBeGreaterThanOrEqual(10); // the blister check looks back at most 10 days
  });

  it("removeDose undoes one tap and leaves the rest", () => {
    const e = { itemId: "rx1", slot: "morning" as const, date: "2026-11-02", at: "t1" };
    const s = addDose(addDose(defaultState(), e), { ...e, slot: "night" });
    const r = removeDose(s, "rx1", "morning", "2026-11-02");
    expect(r.doseLog).toEqual([{ ...e, slot: "night" }]);
    expect(removeDose(r, "rx1", "morning", "2026-11-02")).toBe(r);
  });

  it("withReminderFired records each key once and keeps only the newest", () => {
    let s = withReminderFired(defaultState(), "2026-11-09:morning");
    expect(withReminderFired(s, "2026-11-09:morning")).toBe(s);
    for (let i = 0; i < MAX_REMINDERS_FIRED + 3; i++) s = withReminderFired(s, `k${i}`);
    expect(s.remindersFired).toHaveLength(MAX_REMINDERS_FIRED);
    expect(s.remindersFired.at(-1)).toBe(`k${MAX_REMINDERS_FIRED + 2}`);
  });

  it("loads saves from before reminders existed, and drops junk reminder keys", () => {
    const { remindersFired: _, ...old } = defaultState();
    expect(parseState(old).remindersFired).toEqual([]);
    expect(parseState({ ...old, remindersFired: ["2026-11-09:night", 4, null] }).remindersFired).toEqual(["2026-11-09:night"]);
    expect(parseState({ ...old, remindersFired: "x" }).remindersFired).toEqual([]);
  });
});

describe("in-memory store (no browser)", () => {
  beforeEach(() => resetStoreForTests());

  it("starts from defaults without localStorage and notifies subscribers on change", () => {
    expect(getNayanState()).toEqual(defaultState());
    let calls = 0;
    const unsubscribe = subscribeNayan(() => calls++);
    const next = updateNayan((s) => withTheme(s, "light"));
    expect(next.settings.theme).toBe("light");
    expect(getNayanState()).toBe(next);
    expect(calls).toBe(1);
    // Returning the same object is "no change": nobody re-renders.
    updateNayan((s) => s);
    expect(calls).toBe(1);
    unsubscribe();
  });
});

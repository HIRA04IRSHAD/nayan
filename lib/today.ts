// "आज": today's doses, worked out from the saved prescription, the slot times (settings) and the dose log.
//
// Pure and deterministic (lib/today.test.ts): the same prescription, times, log and clock always give the
// same list. It decides nothing about whether a strip is right or a dose was really taken; it only lays out
// what the confirmed prescription says for today and what the user marked with "मैंने ली".
//
// Definitions (all in the phone's local time):
// - A dose: one scheduled item at one slot ("1-0-1" → morning and night) on today's date, at the slot's "HH:MM".
// - Status: "done" when doseLog has that item + slot + today's date; otherwise "upcoming" until NOW_BEFORE_MS
//   before the time, "now" until NOW_AFTER_MS after it, then "missed" (only means "not marked": Nayan cannot
//   know whether it was taken). These windows are shorter than the blister check's (lib/blister.ts): they are
//   for reminding and marking, not for counting pockets.
// - Course: an item with durationDays is on the list from the day the prescription was saved
//   (Prescription.savedAt, day 1) for that many calendar days. After that it is listed as finished, never due.
// - A dose whose window had already closed when the prescription was saved is left out: it was before Nayan
//   knew about the medicine, so calling it "missed" would be wrong.

import type { DoseLogEntry, Prescription, PrescriptionItem, Slot } from "./types";
import { SLOTS } from "./types";
import { parseFrequency, tabletsPerSlot } from "./schedule";
import { localDate, type SlotTimes } from "./blister";

/** A dose is "now" (due, reminder shown, "मैंने ली" offered) from this long before its time... */
export const NOW_BEFORE_MS = 30 * 60_000;
/** ...until this long after it. Later it counts as "missed" (not marked). */
export const NOW_AFTER_MS = 2 * 60 * 60_000;
/** Slot times must be at least this far apart, so two doses' windows never collapse into one moment. */
export const MIN_SLOT_GAP_MIN = 60;

const DAY_MS = 24 * 60 * 60_000;
/** A savedAt before this is the store's "unknown" fallback (the epoch), not a real save date. */
const EARLIEST_REAL_SAVE = Date.UTC(2000, 0, 1);

export type DoseStatus = "upcoming" | "now" | "done" | "missed";

export interface ItemRef {
  item: PrescriptionItem;
  /** 0-based line number in the prescription. */
  index: number;
}

export interface TodayDose extends ItemRef {
  slot: Slot;
  status: DoseStatus;
  /** Whole tablets per dose when the pattern says so ("2-0-1" → 2 in the morning), else null. */
  tablets: number | null;
  /** When "मैंने ली" was tapped (ISO), for done doses. */
  takenAt: string | null;
}

export interface TodaySlot {
  slot: Slot;
  /** "HH:MM" from settings. */
  time: string;
  at: Date;
  doses: TodayDose[];
}

export interface FinishedItem extends ItemRef {
  /** Local date "YYYY-MM-DD" of the course's last day. */
  lastDay: string;
}

export interface TodayPlan {
  /** Today's local date "YYYY-MM-DD" (the dose log's date for every dose on this list). */
  date: string;
  /** Slots with at least one dose, in time order. */
  slots: TodaySlot[];
  /** "SOS" / as-needed medicines: no time, never reminded. */
  asNeeded: ItemRef[];
  /** Medicines whose schedule could not be understood ("as directed", blank): shown, never reminded. */
  unscheduled: ItemRef[];
  /** Medicines whose course (durationDays) is over. */
  finished: FinishedItem[];
  /** The next dose time after now that still has something to take (today or tomorrow), for "अगली खुराक". */
  next: { slot: Slot; at: Date } | null;
}

// ---------------------------------------------------------------- time helpers

/** "HH:MM" → minutes after midnight, or null when it is not a valid time. */
export function slotMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** The local time hh:mm on the calendar day of `day` (built from local parts, so DST days are still right). */
function onDay(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
}

/** A day number that only depends on the local calendar date (no clock time, no DST). */
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);

function savedDate(p: Prescription): Date | null {
  const t = Date.parse(p.savedAt);
  return Number.isFinite(t) && t >= EARLIEST_REAL_SAVE ? new Date(t) : null;
}

/**
 * The course's last day, or null when the item has no duration (or the save date is unknown: then nothing is
 * hidden, because hiding a medicine that is still prescribed is the worse mistake).
 */
export function courseLastDay(item: Pick<PrescriptionItem, "durationDays">, saved: Date | null): Date | null {
  const days = item.durationDays;
  if (!saved || days == null || !Number.isFinite(days) || days <= 0) return null;
  return new Date(saved.getFullYear(), saved.getMonth(), saved.getDate() + Math.ceil(days) - 1);
}

/** Is the item still being taken on this calendar day? (Days before the save date count as "yes".) */
export function isActiveOn(item: Pick<PrescriptionItem, "durationDays">, saved: Date | null, day: Date): boolean {
  const last = courseLastDay(item, saved);
  return !last || dayNumber(day) <= dayNumber(last);
}

// ---------------------------------------------------------------- the plan

type DayLayout = {
  bySlot: Map<Slot, ItemRef[]>;
  asNeeded: ItemRef[];
  unscheduled: ItemRef[];
  finished: FinishedItem[];
};

/** Which item goes where on a given day: per slot, as-needed, not understood, or finished. */
function layoutFor(p: Prescription, slotTimes: SlotTimes, day: Date): DayLayout {
  const out: DayLayout = { bySlot: new Map(), asNeeded: [], unscheduled: [], finished: [] };
  const saved = savedDate(p);
  p.items.forEach((item, index) => {
    const ref = { item, index };
    if (!isActiveOn(item, saved, day)) {
      out.finished.push({ ...ref, lastDay: localDate(courseLastDay(item, saved)!) });
      return;
    }
    const sch = parseFrequency(item.frequency);
    if (sch?.asNeeded) return void out.asNeeded.push(ref);
    // A slot whose time is broken cannot be placed on the clock; the store validates times, so this is a guard.
    const slots = sch?.slots.filter((s) => slotMinutes(slotTimes[s]) != null) ?? [];
    if (!slots.length) return void out.unscheduled.push(ref);
    for (const s of slots) out.bySlot.set(s, [...(out.bySlot.get(s) ?? []), ref]);
  });
  return out;
}

/** Slots in time order (ties keep the morning → night order). */
function slotsInOrder(slotTimes: SlotTimes, wanted: (s: Slot) => boolean): Slot[] {
  return SLOTS.filter(wanted).sort((a, b) => slotMinutes(slotTimes[a])! - slotMinutes(slotTimes[b])!);
}

function statusOf(at: Date, now: Date, logged: boolean): DoseStatus {
  if (logged) return "done";
  const t = at.getTime();
  const n = now.getTime();
  if (n < t - NOW_BEFORE_MS) return "upcoming";
  if (n < t + NOW_AFTER_MS) return "now";
  return "missed";
}

/** Today's dose list (see the header). An empty plan when there is no prescription. */
export function todayPlan(
  prescription: Prescription | null,
  slotTimes: SlotTimes,
  doseLog: readonly DoseLogEntry[],
  now: Date,
): TodayPlan {
  const date = localDate(now);
  const plan: TodayPlan = { date, slots: [], asNeeded: [], unscheduled: [], finished: [], next: null };
  if (!prescription) return plan;

  const today = layoutFor(prescription, slotTimes, now);
  plan.asNeeded = today.asNeeded;
  plan.unscheduled = today.unscheduled;
  plan.finished = today.finished;
  const saved = savedDate(prescription);

  for (const slot of slotsInOrder(slotTimes, (s) => today.bySlot.has(s))) {
    const time = slotTimes[slot];
    const at = onDay(now, slotMinutes(time)!);
    const doses: TodayDose[] = [];
    for (const { item, index } of today.bySlot.get(slot)!) {
      const log = doseLog.find((e) => e.itemId === item.id && e.slot === slot && e.date === date);
      if (!log && saved && saved.getTime() >= at.getTime() + NOW_AFTER_MS) continue; // before Nayan knew it
      doses.push({
        item,
        index,
        slot,
        status: statusOf(at, now, !!log),
        tablets: tabletsPerSlot(item.frequency)?.[slot] ?? null,
        takenAt: log?.at ?? null,
      });
    }
    if (doses.length) plan.slots.push({ slot, time, at, doses });
  }

  plan.next = nextDoseTime(plan, prescription, slotTimes, now);
  return plan;
}

/** The first dose time after now that still has an unmarked dose today, else tomorrow's first dose time. */
function nextDoseTime(plan: TodayPlan, p: Prescription, slotTimes: SlotTimes, now: Date): TodayPlan["next"] {
  const later = plan.slots.find((s) => s.at.getTime() > now.getTime() && s.doses.some((d) => d.status !== "done"));
  if (later) return { slot: later.slot, at: later.at };
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const t = layoutFor(p, slotTimes, tomorrow);
  const first = slotsInOrder(slotTimes, (s) => t.bySlot.has(s))[0];
  return first ? { slot: first, at: onDay(tomorrow, slotMinutes(slotTimes[first])!) } : null;
}

/** Doses in the plan that are due now and not yet marked. */
export const dueNow = (slot: TodaySlot) => slot.doses.filter((d) => d.status === "now");

// ---------------------------------------------------------------- reminders

/** The key a reminder is remembered by (store.remindersFired): one per slot per day. */
export const reminderKey = (date: string, slot: Slot) => `${date}:${slot}`;

/**
 * The slot to remind about now, or null: its time has come (not before it: the window opens early only for
 * marking), it is still within NOW_AFTER_MS, something in it is unmarked, and it was not announced yet today.
 * When two slots qualify (only after a long pause), the earlier one comes first; the next check gets the other.
 */
export function reminderDue(plan: TodayPlan, now: Date, fired: readonly string[]): TodaySlot | null {
  const n = now.getTime();
  return (
    plan.slots.find(
      (s) =>
        n >= s.at.getTime() &&
        n < s.at.getTime() + NOW_AFTER_MS &&
        dueNow(s).length > 0 &&
        !fired.includes(reminderKey(plan.date, s.slot)),
    ) ?? null
  );
}

// ---------------------------------------------------------------- slot time settings

export type SlotTimeError = { code: "invalid" | "order" | "gap"; slot: Slot };

/**
 * Edited slot times must be valid "HH:MM", in the order morning → afternoon → evening → night within one day,
 * and at least MIN_SLOT_GAP_MIN apart (also from night round to the next morning). Equal or overlapping times
 * would merge two doses into one moment, here and in the blister check's dose windows.
 */
export function validateSlotTimes(times: Readonly<Record<Slot, string>>): SlotTimeError | null {
  const mins: number[] = [];
  for (const slot of SLOTS) {
    const m = slotMinutes(times[slot]);
    if (m == null) return { code: "invalid", slot };
    mins.push(m);
  }
  for (let i = 1; i < SLOTS.length; i++) {
    if (mins[i] <= mins[i - 1]) return { code: "order", slot: SLOTS[i] };
    if (mins[i] - mins[i - 1] < MIN_SLOT_GAP_MIN) return { code: "gap", slot: SLOTS[i] };
  }
  if (24 * 60 - mins[mins.length - 1] + mins[0] < MIN_SLOT_GAP_MIN) return { code: "gap", slot: "morning" };
  return null;
}

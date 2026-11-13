// Blister double-dose check: pocket counts of the back of a strip against the confirmed schedule.
//
// The AI reads, the rules decide. The model only counts pockets (twice, with two different methods; see
// extractBlister in lib/gemini.ts). It is never shown the schedule and never asked whether a dose was taken.
// Everything here is pure and deterministic (lib/blister.test.ts): the same counts, saved count and clock always
// give the same answer.
//
// The idea: the last saved count of this strip (the "baseline") plus the tablets scheduled since then says how
// many pockets should be empty now. More empty pockets than that = possibly a double dose; exactly one dose fewer
// at a dose time = the current dose is still in the strip. It is a warning aid, not a pill tracker: it never tells
// the user to take extra tablets to catch up, and whenever the evidence is unclear it says "not sure".
//
// Definitions (all in the phone's local time):
// - Dose time: a calendar day at the slot's "HH:MM" (settings.slotTimes), for each slot in the item's schedule.
// - Current dose: the dose whose window contains now. The window opens EARLY_MS before the dose time (people take
//   the morning tablet a little early) and closes LATE_MS after it, or earlier where the next dose's window opens,
//   so windows never overlap and at most one dose is current. The night window can run past midnight.
// - Baseline: { at, emptyPockets, totalPockets } means "after every dose time <= at, the strip had emptyPockets
//   empty pockets". Dose times after `at`, up to now + EARLY_MS, are expected to have emptied more pockets.
// - When a count is saved during a dose window, the photo is ASSUMED to already show the current dose
//   (at = max(now, dose time)). If the user takes the dose after the photo, "मैंने अभी ली" adds it (markTaken).
//   This makes every mistake fall on the side of "already taken, do not take again", never "take it now".

import type { BlisterBaseline, BlisterReading, DoseLogEntry, PrescriptionItem, Slot } from "./types";
import { SLOTS } from "./types";
import { parseFrequency, tabletsPerSlot } from "./schedule";

/** Both counts must be at least this sure (same bar as the strip rules). */
export const MIN_CONFIDENCE = 0.85;
/** A dose counts as due from this long before its time. */
export const EARLY_MS = 60 * 60_000;
/** ...and stays the current dose until this long after it (or until the next dose's window opens). */
export const LATE_MS = 4 * 60 * 60_000;
/**
 * People sometimes take a tablet hours early. A saved count made outside any dose window, less than this before a
 * dose time, may already show that dose taken early; it is never used to say "not taken yet" (see evaluateBlister).
 */
export const EARLY_TAKE_MS = 6 * 60 * 60_000;
/** An older saved count is not compared against: a fresh count starts instead (strips get swapped, days skipped). */
export const MAX_BASELINE_AGE_MS = 10 * 24 * 60 * 60_000;
/** No real strip has more pockets than this; a bigger count is a misread. */
export const MAX_POCKETS = 100;

const DAY_MS = 24 * 60 * 60_000;

export type SlotTimes = Readonly<Record<Slot, string>>;

export type BlisterOutcome =
  | "not_sure"
  | "baseline_set"
  | "ok_take_now"
  | "already_taken"
  | "ok"
  | "extra_taken"
  | "missed"
  | "new_strip";

export type NotSureReason =
  /** One of the two reads failed. */
  | "missing_read"
  /** The model saw no strip (0 pockets). */
  | "no_strip"
  /** Counts that cannot be true (empty > total, negative, absurdly many pockets). */
  | "impossible"
  /** Part of the strip is outside the photo, covered, cut or torn away, or more than one strip is visible. */
  | "not_whole"
  /** The two reads gave different counts. */
  | "disagree"
  | "low_confidence"
  /** As-needed (SOS), not understood, or a slot time is broken: nothing to count against. */
  | "no_schedule"
  /** Part of a tablet per dose ("½-0-½"): a half tablet does not empty a whole pocket. */
  | "part_dose"
  /** One dose short, but more than one dose is expected since the last count: which one is missing is unknown. */
  | "which_dose"
  /** One dose short, but the user marked the current dose as taken. */
  | "log_disagrees"
  /** One dose short, but the saved count was made shortly before this dose time: it may have been taken early. */
  | "count_before_dose"
  /** Fewer pockets than a whole multi-tablet dose are short: part of the current dose seems taken. */
  | "part_taken";

export interface DoseTime {
  slot: Slot;
  at: Date;
}

/** The current dose (see the header), as stored in a result. */
export interface CurrentDose {
  slot: Slot;
  /** ISO time of the scheduled dose. */
  at: string;
  /** Tablets per dose for this slot ("2-0-1" → 2 in the morning). */
  tablets: number;
}

export interface BlisterInput {
  reading1: BlisterReading | null;
  reading2: BlisterReading | null;
  /** The saved count for this medicine (store.blisterBaselines[item.id]), if any. */
  baseline: BlisterBaseline | null;
  now: Date;
  item: Pick<PrescriptionItem, "id" | "frequency">;
  slotTimes: SlotTimes;
  /** Doses the user marked as taken; used only to tell which dose is missing. */
  doseLog?: readonly DoseLogEntry[];
}

export interface BlisterResult {
  outcome: BlisterOutcome;
  /** Why "not sure" (or "stale" for a baseline_set that replaced a too-old count). */
  reason: NotSureReason | "stale" | null;
  /** The agreed count, when both reads agreed. */
  observed: { empty: number; total: number } | null;
  /** How many pockets should be empty now, when there was a count to compare with. */
  expected: number | null;
  current: CurrentDose | null;
  /** The next dose time after now (for "nothing due now"). */
  next: { slot: Slot; at: string } | null;
  /** extra_taken: pockets more than expected. missed: pockets fewer than expected, not counting the current dose. */
  difference: number;
  /** The count to save for this medicine, or null to keep the saved one. */
  baseline: BlisterBaseline | null;
  /** Offer "मैंने अभी ली": there is a current dose, this outcome allows it, and the strip still has its tablets. */
  canMarkTaken: boolean;
  /** Every pocket is empty. */
  finished: boolean;
}

// ---------------------------------------------------------------- time

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Local calendar date "YYYY-MM-DD" (the doseLog's date format). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Every scheduled dose time t with from < t <= to, across days, oldest first. Slots with a broken time are skipped. */
export function doseTimesBetween(from: Date, to: Date, slots: readonly Slot[], slotTimes: SlotTimes): DoseTime[] {
  const out: DoseTime[] = [];
  if (!(to.getTime() > from.getTime())) return out;
  const wanted = SLOTS.filter((s) => slots.includes(s));
  const [y, m, d] = [from.getFullYear(), from.getMonth(), from.getDate()];
  // Dates are built from local parts (not by adding 24 h), so a dose is at its clock time on every day.
  // The day cap only guards against absurd ranges; callers never ask for more than a few weeks.
  for (let i = 0; i <= 400 && new Date(y, m, d + i).getTime() <= to.getTime(); i++) {
    for (const slot of wanted) {
      const mins = minutesOf(slotTimes[slot]);
      if (mins == null) continue;
      const at = new Date(y, m, d + i, Math.floor(mins / 60), mins % 60);
      if (at > from && at <= to) out.push({ slot, at });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Number of scheduled dose times t with from < t <= to (across days). */
export function dosesDueBetween(from: Date, to: Date, slots: readonly Slot[], slotTimes: SlotTimes): number {
  return doseTimesBetween(from, to, slots, slotTimes).length;
}

/** The dose whose window (EARLY_MS before → LATE_MS after, cut where the next window opens) contains now. */
export function currentDose(now: Date, slots: readonly Slot[], slotTimes: SlotTimes): DoseTime | null {
  const n = now.getTime();
  const around = doseTimesBetween(new Date(n - 2 * DAY_MS), new Date(n + 2 * DAY_MS), slots, slotTimes);
  for (let i = 0; i < around.length; i++) {
    const t = around[i].at.getTime();
    const next = around[i + 1];
    const start = t - EARLY_MS;
    const end = Math.min(t + LATE_MS, next ? next.at.getTime() - EARLY_MS : Infinity);
    if (start <= n && n < end) return around[i];
  }
  return null;
}

/** The first dose time after now. */
export function nextDose(now: Date, slots: readonly Slot[], slotTimes: SlotTimes): DoseTime | null {
  return doseTimesBetween(now, new Date(now.getTime() + 2 * DAY_MS), slots, slotTimes)[0] ?? null;
}

// ---------------------------------------------------------------- reads

/** The count both reads agree on, or why they cannot be trusted. */
export function agreedCount(r1: BlisterReading | null, r2: BlisterReading | null): { empty: number; total: number } | NotSureReason {
  if (!r1 || !r2) return "missing_read";
  const reads = [r1, r2];
  if (reads.some((r) => r.total_pockets === 0)) return "no_strip";
  const possible = (r: BlisterReading) =>
    Number.isInteger(r.total_pockets) &&
    Number.isInteger(r.empty_pockets) &&
    r.total_pockets >= 1 &&
    r.total_pockets <= MAX_POCKETS &&
    r.empty_pockets >= 0 &&
    r.empty_pockets <= r.total_pockets;
  if (!reads.every(possible)) return "impossible";
  if (!reads.every((r) => r.whole_strip_visible)) return "not_whole";
  if (r1.total_pockets !== r2.total_pockets || r1.empty_pockets !== r2.empty_pockets) return "disagree";
  if (!reads.every((r) => Number.isFinite(r.confidence) && r.confidence >= MIN_CONFIDENCE)) return "low_confidence";
  return { empty: r1.empty_pockets, total: r1.total_pockets };
}

// ---------------------------------------------------------------- schedule

type PillSchedule = { slots: Slot[]; tablets: Partial<Record<Slot, number>> };

/** The item's slots and whole tablets per slot, or why its pockets cannot be counted against a schedule. */
export function pillSchedule(frequency: string | null, slotTimes: SlotTimes): PillSchedule | "no_schedule" | "part_dose" {
  const tablets = tabletsPerSlot(frequency);
  if (!tablets) {
    const sch = parseFrequency(frequency);
    return sch && !sch.asNeeded && sch.slots.length ? "part_dose" : "no_schedule";
  }
  const slots = SLOTS.filter((s) => tablets[s]);
  // A broken slot time would silently drop that dose from the expected count.
  if (slots.some((s) => minutesOf(slotTimes[s]) == null)) return "no_schedule";
  return { slots, tablets };
}

export interface Expectation {
  /** Pockets that should be empty now, if every expected dose was taken (including the current one). */
  expected: number;
  /** Tablets of the current dose included in `expected` (0 when there is none, or the saved count already covers it). */
  pending: number;
  /** The expected dose times since the saved count. */
  counted: DoseTime[];
  current: DoseTime | null;
}

/** What the saved count predicts for now, or "stale" when it is too old (or from the future) to compare with. */
export function expectation(baseline: BlisterBaseline, now: Date, sched: PillSchedule, slotTimes: SlotTimes): Expectation | "stale" {
  const at = Date.parse(baseline.at);
  const n = now.getTime();
  if (!Number.isFinite(at) || at > n + EARLY_MS || n - at > MAX_BASELINE_AGE_MS) return "stale";
  const counted = doseTimesBetween(new Date(at), new Date(n + EARLY_MS), sched.slots, slotTimes);
  const current = currentDose(now, sched.slots, slotTimes);
  const tabletsOf = (d: DoseTime) => sched.tablets[d.slot] ?? 0;
  const expected = baseline.emptyPockets + counted.reduce((sum, d) => sum + tabletsOf(d), 0);
  const currentCounted = current != null && counted.some((d) => d.at.getTime() === current.at.getTime());
  return { expected, pending: currentCounted ? tabletsOf(current) : 0, counted, current };
}

/** For the demo buttons: the expected empty pockets now, or null without a usable saved count or schedule. */
export function expectedEmptyNow(
  baseline: BlisterBaseline | null,
  now: Date,
  item: Pick<PrescriptionItem, "frequency">,
  slotTimes: SlotTimes,
): { expected: number; pending: number } | null {
  const sched = pillSchedule(item.frequency, slotTimes);
  if (!baseline || typeof sched === "string") return null;
  const e = expectation(baseline, now, sched, slotTimes);
  return e === "stale" ? null : { expected: e.expected, pending: e.pending };
}

/**
 * True when the saved count was made at a dose time: inside a dose's window and not before the dose time itself.
 * Counts saved during a window are stamped max(now, dose time), so they are assumed to show that dose.
 */
function atDoseTime(baseline: BlisterBaseline, sched: PillSchedule, slotTimes: SlotTimes): boolean {
  const at = Date.parse(baseline.at);
  if (!Number.isFinite(at)) return false;
  const d = currentDose(new Date(at), sched.slots, slotTimes);
  return d != null && at >= d.at.getTime();
}

// ---------------------------------------------------------------- the decision

export function evaluateBlister(input: BlisterInput): BlisterResult {
  const { reading1, reading2, baseline, now, item, slotTimes, doseLog = [] } = input;
  const result: BlisterResult = {
    outcome: "not_sure",
    reason: null,
    observed: null,
    expected: null,
    current: null,
    next: null,
    difference: 0,
    baseline: null,
    canMarkTaken: false,
    finished: false,
  };
  const notSure = (reason: NotSureReason): BlisterResult => ({ ...result, outcome: "not_sure", reason, baseline: null, canMarkTaken: false });

  const sched = pillSchedule(item.frequency, slotTimes);
  if (typeof sched === "string") return notSure(sched);

  const cur = currentDose(now, sched.slots, slotTimes);
  const nxt = nextDose(now, sched.slots, slotTimes);
  result.current = cur ? { slot: cur.slot, at: cur.at.toISOString(), tablets: sched.tablets[cur.slot] ?? 1 } : null;
  result.next = nxt ? { slot: nxt.slot, at: nxt.at.toISOString() } : null;

  const count = agreedCount(reading1, reading2);
  if (typeof count === "string") return notSure(count);
  const { empty: O, total } = count;
  result.observed = count;
  result.finished = O === total;

  // The count to save when this photo becomes the new reference. During a dose window the photo is assumed to
  // already show the current dose (see the header); "मैंने अभी ली" corrects that when it is taken afterwards.
  const fresh: BlisterBaseline = {
    at: new Date(Math.max(now.getTime(), cur?.at.getTime() ?? 0)).toISOString(),
    emptyPockets: O,
    totalPockets: total,
  };
  const tapAllowed = !!result.current && O + result.current.tablets <= total;
  const restart = (outcome: "baseline_set" | "new_strip", reason: "stale" | null = null): BlisterResult => ({
    ...result,
    outcome,
    reason,
    baseline: fresh,
    canMarkTaken: tapAllowed,
  });

  if (!baseline) return restart("baseline_set");
  const exp = expectation(baseline, now, sched, slotTimes);
  if (exp === "stale") return restart("baseline_set", "stale");

  // A different pocket count, or fewer empty pockets than last time, cannot be the same strip.
  if (total !== baseline.totalPockets || O < baseline.emptyPockets) return restart("new_strip");

  const { expected: E, pending: P, counted } = exp;
  result.expected = E;

  if (O > E) return { ...result, outcome: "extra_taken", difference: O - E, baseline: fresh };
  // "ok" keeps the saved count: with no dose window open it predicts every later check exactly as this photo
  // would, and a count saved at a dose time is the stronger reference (it is known to show that dose; a count
  // made between doses could already show the next tablet taken early, see EARLY_TAKE_MS).
  if (O === E) return cur ? { ...result, outcome: "already_taken", baseline: fresh } : { ...result, outcome: "ok", baseline: null };

  // Fewer empty pockets than expected.
  if (P > 0 && cur && O === E - P) {
    const logged = (d: DoseTime) => doseLog.some((e) => e.itemId === item.id && e.slot === d.slot && e.date === localDate(d.at));
    if (logged(cur)) return notSure("log_disagrees");
    // With several doses expected since the last count, the missing one could be an earlier dose, and then the
    // current one may already be taken. Only say "not taken yet" when every earlier dose is accounted for.
    const earlier = counted.filter((d) => d.at.getTime() !== cur.at.getTime());
    if (earlier.some((d) => !logged(d))) return notSure("which_dose");
    // The saved count may itself already show this dose: a tablet taken hours early, then counted before its
    // window opened. Only a count made at an earlier dose time (known to show that dose, not the next one) or
    // long enough before this dose rules that out; otherwise "taken early" and "not taken" look the same.
    if (!earlier.length && !atDoseTime(baseline, sched, slotTimes) && Date.parse(baseline.at) > cur.at.getTime() - EARLY_TAKE_MS) {
      return notSure("count_before_dose");
    }
    // Keep the saved count: it still predicts correctly whether or not the dose is taken next, and covering
    // the pending dose now would turn an untapped dose into a false "already taken" later.
    return { ...result, outcome: "ok_take_now", baseline: null, canMarkTaken: tapAllowed };
  }
  if (P > 1 && O > E - P) return notSure("part_taken");
  return { ...result, outcome: "missed", difference: E - P - O, baseline: fresh, canMarkTaken: tapAllowed };
}

/**
 * "मैंने अभी ली" after a result with a current dose: the new saved count (the photo's count plus this dose,
 * covering the dose time) and the dose-log entry (dated by the dose time, so a night dose taken after midnight
 * is still that night's). Null when the result does not allow it.
 */
export function markTaken(result: BlisterResult, itemId: string, now: Date): { baseline: BlisterBaseline; dose: DoseLogEntry } | null {
  const cur = result.current;
  if (!result.canMarkTaken || !cur || !result.observed) return null;
  const doseAt = new Date(cur.at);
  return {
    baseline: {
      at: new Date(Math.max(now.getTime(), doseAt.getTime())).toISOString(),
      emptyPockets: result.observed.empty + cur.tablets,
      totalPockets: result.observed.total,
    },
    dose: { itemId, slot: cur.slot, date: localDate(doseAt), at: now.toISOString() },
  };
}

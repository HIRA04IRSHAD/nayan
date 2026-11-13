// Everything Nayan keeps on the phone, in one versioned localStorage entry.
//
// The pure functions (parse / migrate / read / write and the with* updaters) take a storage object as an
// argument so they can be unit-tested without a browser (store.test.ts). The React hook at the bottom is a
// thin wrapper around them that keeps every screen in sync.
//
// Saved data is never trusted blindly: it may be from an older build, edited by hand, or half-written.
// Each field is validated on its own and falls back to its default, so one bad field never wipes the
// prescription. A prescription line that cannot be read is dropped (the user then sees it missing) rather
// than kept with guessed values, because the rule engine treats saved lines as ground truth.

import { useSyncExternalStore } from "react";
import { z } from "zod";
import {
  DOSAGE_FORMS,
  SLOTS,
  type BlisterBaseline,
  type Caregiver,
  type CaregiverCaseRef,
  type DoseLogEntry,
  type NayanState,
  type Prescription,
  type PrescriptionItem,
  type Settings,
  type Slot,
  type TactileTagId,
  type Theme,
} from "./types";
import { TAGS } from "./tags";
import { STORAGE_KEY } from "./theme";

export { STORAGE_KEY };
/** Before v2 only the prescription was saved, under this key. Read once, copied into v2, then removed. */
export const LEGACY_PRESCRIPTION_KEY = "nayan.prescription.v1";

export const DEFAULT_SLOT_TIMES: Readonly<Record<Slot, string>> = {
  morning: "08:00",
  afternoon: "14:00",
  evening: "18:00",
  night: "21:00",
};

/** Reminder keys kept in remindersFired: enough for every slot of today and yesterday. */
export const MAX_REMINDERS_FIRED = 12;
/**
 * Dose-log entries older than this (by date) are dropped when a dose is added, so the log cannot slowly fill
 * localStorage. Nothing reads further back: the Today list needs today, the blister check at most 10 days.
 */
export const DOSE_LOG_DAYS = 60;

export function defaultSettings(): Settings {
  return { theme: "dark", slotTimes: { ...DEFAULT_SLOT_TIMES }, remindersOn: false, voiceOn: true };
}

export function defaultState(): NayanState {
  return {
    prescription: null,
    caregiver: null,
    cases: [],
    blisterBaselines: {},
    doseLog: [],
    remindersFired: [],
    settings: defaultSettings(),
  };
}

// ---------------------------------------------------------------- validation

/** Keep the entries of an array that pass the schema; drop the rest. */
function keepValid<T>(values: unknown[], schema: z.ZodType<T, z.ZodTypeDef, unknown>): T[] {
  return values.flatMap((v) => {
    const r = schema.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

const EPOCH = new Date(0).toISOString();
const isTagId = (v: unknown): v is TactileTagId => TAGS.some((t) => t.id === v);

const ingredientZ = z.object({ salt: z.string(), strength: z.string().nullable().catch(null) });

// passthrough(): a later build may add fields to a line; an older parser must not strip them on save.
const itemZ: z.ZodType<PrescriptionItem, z.ZodTypeDef, unknown> = z
  .object({
    id: z.string().min(1),
    nameAsWritten: z.string(),
    ingredients: z.array(ingredientZ),
    form: z.enum(DOSAGE_FORMS).nullable().catch(null),
    frequency: z.string().nullable().catch(null),
    timing: z.string().nullable().catch(null),
    durationDays: z.number().finite().nullable().catch(null),
    tag: z.custom<TactileTagId>(isTagId).optional().catch(undefined),
  })
  .passthrough();

const prescriptionZ = z
  .object({
    items: z.array(z.unknown()).transform((a) => keepValid(a, itemZ)),
    savedAt: z.string().catch(EPOCH),
  })
  // A prescription with no readable line is no prescription: show the setup screen again.
  .transform((p): Prescription | null => (p.items.length ? p : null));

/** Validate a saved prescription (v1 value or the v2 field). Null when nothing usable is in it. */
export function parsePrescription(raw: unknown): Prescription | null {
  const r = prescriptionZ.safeParse(raw);
  return r.success ? r.data : null;
}

const caregiverZ: z.ZodType<Caregiver | null, z.ZodTypeDef, unknown> = z
  .object({ name: z.string(), relation: z.string().catch("") })
  .nullable()
  .catch(null);

const caseZ: z.ZodType<CaregiverCaseRef, z.ZodTypeDef, unknown> = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  createdAt: z.string(),
  itemLabel: z.string().catch(""),
  status: z.enum(["waiting", "answered", "expired"]).catch("waiting"),
  url: z.string().optional().catch(undefined),
  askedWho: z.string().optional().catch(undefined),
  askedAbout: z.string().optional().catch(undefined),
  answer: z.enum(["correct", "wrong"]).optional().catch(undefined),
  answeredAt: z.string().optional().catch(undefined),
  answerItemIndex: z.number().int().min(0).optional().catch(undefined),
  answerLine: z.string().optional().catch(undefined),
  note: z.string().optional().catch(undefined),
});

const baselineZ: z.ZodType<BlisterBaseline, z.ZodTypeDef, unknown> = z.object({
  at: z.string(),
  emptyPockets: z.number().int().min(0),
  totalPockets: z.number().int().min(1),
});

const doseZ: z.ZodType<DoseLogEntry, z.ZodTypeDef, unknown> = z.object({
  itemId: z.string().min(1),
  slot: z.enum(SLOTS),
  date: z.string(),
  at: z.string(),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeZ = (slot: Slot) => z.string().regex(HHMM).catch(DEFAULT_SLOT_TIMES[slot]);

const settingsZ: z.ZodType<Settings, z.ZodTypeDef, unknown> = z
  .object({
    theme: z.enum(["dark", "light"]).catch("dark"),
    slotTimes: z
      .object({ morning: timeZ("morning"), afternoon: timeZ("afternoon"), evening: timeZ("evening"), night: timeZ("night") })
      .catch(() => ({ ...DEFAULT_SLOT_TIMES })),
    remindersOn: z.boolean().catch(false),
    // Older saves have no voiceOn: speaking stays on, as before.
    voiceOn: z.boolean().catch(true),
  })
  .catch(() => defaultSettings());

// Typed against NayanState, so adding a field to the state without adding it here is a compile error.
const stateZ: z.ZodType<NayanState, z.ZodTypeDef, unknown> = z.object({
  prescription: z.unknown().transform((v) => (v == null ? null : parsePrescription(v))),
  caregiver: caregiverZ,
  cases: z
    .array(z.unknown())
    .catch([])
    .transform((a) => keepValid(a, caseZ)),
  blisterBaselines: z
    .record(z.unknown())
    .catch({})
    .transform((rec) => {
      const out: Record<string, BlisterBaseline> = {};
      for (const [id, v] of Object.entries(rec)) {
        const r = baselineZ.safeParse(v);
        if (r.success) out[id] = r.data;
      }
      return out;
    }),
  doseLog: z
    .array(z.unknown())
    .catch([])
    .transform((a) => keepValid(a, doseZ)),
  // Added with the reminders; older saves have no such field and start empty.
  remindersFired: z
    .array(z.unknown())
    .catch([])
    .transform((a) => a.filter((k): k is string => typeof k === "string").slice(-MAX_REMINDERS_FIRED)),
  settings: settingsZ,
});

/** Turn anything read from storage into a complete, valid state. Never throws. */
export function parseState(raw: unknown): NayanState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return defaultState();
  const r = stateZ.safeParse(raw);
  return r.success ? r.data : defaultState();
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** v1 saved only the prescription; everything else starts from the defaults. Null when there is nothing to migrate. */
export function migrateFromV1(legacyRaw: string | null): NayanState | null {
  const prescription = parsePrescription(parseJson(legacyRaw));
  return prescription ? { ...defaultState(), prescription } : null;
}

// ---------------------------------------------------------------- storage

/** The part of localStorage the store uses; tests pass an in-memory fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** window.localStorage, or null where it does not exist or access throws (private mode, blocked cookies, server). */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Save the state. False when storage is missing or full; the app keeps working for this session. */
export function writeState(storage: KeyValueStorage | null, state: NayanState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the state: the v2 entry if there is one; otherwise a one-time migration of the v1 prescription
 * (written to v2, and v1 removed only after that write succeeded); otherwise the defaults. Never throws.
 */
export function readState(storage: KeyValueStorage | null): NayanState {
  if (!storage) return defaultState();
  let v2: string | null = null;
  let v1: string | null = null;
  try {
    v2 = storage.getItem(STORAGE_KEY);
    if (v2 == null) v1 = storage.getItem(LEGACY_PRESCRIPTION_KEY);
  } catch {
    return defaultState();
  }
  if (v2 != null) return parseState(parseJson(v2));
  const migrated = migrateFromV1(v1);
  if (!migrated) return defaultState();
  if (writeState(storage, migrated)) {
    try {
      storage.removeItem(LEGACY_PRESCRIPTION_KEY);
    } catch {
      /* harmless: v2 exists now, so v1 is never read again */
    }
  }
  return migrated;
}

// ---------------------------------------------------------------- pure updaters
// Each returns a new state (or the same object when nothing changes). Use them with updateNayan().

/** Replace the prescription (null = start over). Pocket counts of medicines no longer on the list are dropped. */
export function withPrescription(s: NayanState, prescription: Prescription | null): NayanState {
  const ids = new Set(prescription?.items.map((i) => i.id) ?? []);
  const blisterBaselines = Object.fromEntries(Object.entries(s.blisterBaselines).filter(([id]) => ids.has(id)));
  return { ...s, prescription, blisterBaselines };
}

export function withItemTag(s: NayanState, itemId: string, tag: TactileTagId): NayanState {
  if (!s.prescription?.items.some((i) => i.id === itemId)) return s;
  return {
    ...s,
    prescription: { ...s.prescription, items: s.prescription.items.map((i) => (i.id === itemId ? { ...i, tag } : i)) },
  };
}

export function withSettings(s: NayanState, patch: Partial<Settings>): NayanState {
  return { ...s, settings: { ...s.settings, ...patch } };
}

/**
 * Change the dose times. The saved blister counts are dropped when any time actually changes: each count means
 * "after every dose time up to then", measured with the old times, and re-reading it with the new ones can count
 * a dose that was already taken a second time (a false "not taken yet"). The next dose check starts a new count.
 */
export function withSlotTimes(s: NayanState, slotTimes: Readonly<Record<Slot, string>>): NayanState {
  const changed = SLOTS.some((slot) => s.settings.slotTimes[slot] !== slotTimes[slot]);
  if (!changed) return s;
  return { ...s, settings: { ...s.settings, slotTimes: { ...slotTimes } }, blisterBaselines: {} };
}

export const withTheme = (s: NayanState, theme: Theme) => withSettings(s, { theme });

export const withCaregiver = (s: NayanState, caregiver: Caregiver | null): NayanState => ({ ...s, caregiver });

/** The history keeps this many cases; older ones are dropped (their server copy expired after 48 h anyway). */
export const MAX_SAVED_CASES = 50;

/** Add a caregiver case, or replace the one with the same id. Newest first, at most MAX_SAVED_CASES. */
export function upsertCase(s: NayanState, c: CaregiverCaseRef): NayanState {
  return { ...s, cases: [c, ...s.cases.filter((x) => x.id !== c.id)].slice(0, MAX_SAVED_CASES) };
}

/**
 * Change one saved case in place (keeps the order), e.g. when the poller sees its answer. A case that is no
 * longer saved is left alone, so a late poll can never bring a removed case back.
 */
export function updateCase(s: NayanState, id: string, fn: (c: CaregiverCaseRef) => CaregiverCaseRef): NayanState {
  const i = s.cases.findIndex((c) => c.id === id);
  if (i < 0) return s;
  const next = fn(s.cases[i]);
  if (next === s.cases[i]) return s;
  const cases = s.cases.slice();
  cases[i] = next;
  return { ...s, cases };
}

export function withBlisterBaseline(s: NayanState, itemId: string, b: BlisterBaseline): NayanState {
  return { ...s, blisterBaselines: { ...s.blisterBaselines, [itemId]: b } };
}

/** Whole days from local date a to local date b ("YYYY-MM-DD"); NaN when either is not a date. */
function daysBetween(a: string, b: string): number {
  const ms = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN);
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/**
 * Record a dose as taken. A second tap for the same medicine, slot and day is ignored. Entries more than
 * DOSE_LOG_DAYS older than the new one are dropped (entries with an unreadable date are kept: they are harmless).
 */
export function addDose(s: NayanState, e: DoseLogEntry): NayanState {
  const dup = s.doseLog.some((d) => d.itemId === e.itemId && d.slot === e.slot && d.date === e.date);
  if (dup) return s;
  const kept = s.doseLog.filter((d) => !(daysBetween(d.date, e.date) > DOSE_LOG_DAYS));
  return { ...s, doseLog: [...kept, e] };
}

/** Undo a "मैंने ली" tap: remove that medicine's dose for that slot and day. */
export function removeDose(s: NayanState, itemId: string, slot: Slot, date: string): NayanState {
  const doseLog = s.doseLog.filter((d) => !(d.itemId === itemId && d.slot === slot && d.date === date));
  return doseLog.length === s.doseLog.length ? s : { ...s, doseLog };
}

/** Remember that a reminder was given (key from lib/today.ts reminderKey). Keeps the newest MAX_REMINDERS_FIRED. */
export function withReminderFired(s: NayanState, key: string): NayanState {
  if (s.remindersFired.includes(key)) return s;
  return { ...s, remindersFired: [...s.remindersFired, key].slice(-MAX_REMINDERS_FIRED) };
}

// ---------------------------------------------------------------- React binding

let current: NayanState | null = null;
const listeners = new Set<() => void>();
// Rendered on the server and during hydration. Must be one stable object (useSyncExternalStore compares by reference).
const SERVER_SNAPSHOT: NayanState = defaultState();

/** The current state. Read lazily from localStorage on first use in the browser. */
export function getNayanState(): NayanState {
  if (!current) current = readState(browserStorage());
  return current;
}

const emit = () => listeners.forEach((l) => l());

/** Apply a pure updater, save, and re-render every screen. Returns the new state. */
export function updateNayan(fn: (s: NayanState) => NayanState): NayanState {
  const prev = getNayanState();
  const next = fn(prev);
  if (next !== prev) {
    current = next;
    writeState(browserStorage(), next);
    emit();
  }
  return next;
}

// Another tab of the app saved: pick up its state so two open tabs never overwrite each other's tags.
function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY && e.key !== null) return;
  current = readState(browserStorage());
  emit();
}

export function subscribeNayan(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** The whole saved state; the component re-renders when it changes. Defaults on the server. */
export function useNayan(): NayanState {
  return useSyncExternalStore(subscribeNayan, getNayanState, () => SERVER_SNAPSHOT);
}

const noSubscribe = () => () => {};
/** False during the server render and hydration, true after. Lets the UI wait instead of flashing the setup screen. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** Tests only: forget the in-memory state so the next read starts from storage again. */
export function resetStoreForTests() {
  current = null;
  listeners.clear();
}

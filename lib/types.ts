export const DOSAGE_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "suspension",
  "injection",
  "drops",
  "cream",
  "ointment",
  "gel",
  "solution",
  "inhaler",
  "powder",
  "other",
] as const;
export type DosageForm = (typeof DOSAGE_FORMS)[number];

/** One active salt with its strength exactly as printed/written, e.g. { salt: "Paracetamol IP", strength: "650 mg" }. */
export interface Ingredient {
  salt: string;
  strength: string | null;
}

export type TactileTagId =
  | "one_dot"
  | "two_dots"
  | "three_dots"
  | "line"
  | "triangle"
  | "circle"
  | "cross"
  | "square";

/** A prescription line after the user/caregiver has confirmed it. Treated as ground truth by the rule engine. */
export interface PrescriptionItem {
  id: string;
  nameAsWritten: string;
  /** Empty when the doctor wrote only a brand name; the drug database fills it in. */
  ingredients: Ingredient[];
  form: DosageForm | null;
  frequency: string | null;
  timing: string | null;
  durationDays: number | null;
  tag?: TactileTagId;
}

export interface Prescription {
  items: PrescriptionItem[];
  savedAt: string;
}

/** A value read by the vision model, with the model's own confidence (0..1). */
export interface Confident<T> {
  value: T;
  confidence: number;
}

/** What the vision model read off one photo of a strip. It never contains a verdict. */
export interface StripReading {
  brand: Confident<string | null>;
  ingredients: Confident<Ingredient[]>;
  form: Confident<DosageForm | null>;
  /** As printed, e.g. "08/2027" or "2027-08". Parsed by code, not by the model. */
  expiry: Confident<string | null>;
}

export type Verdict = "match" | "no_match" | "not_sure";

export type ReasonCode =
  | "salt_differs"
  | "strength_differs"
  | "form_differs"
  | "expired"
  | "low_confidence"
  | "readings_disagree"
  | "missing_field"
  | "unknown_drug"
  | "no_prescription";

export interface Reason {
  code: ReasonCode;
  detail?: Record<string, string>;
}

export interface CheckResult {
  verdict: Verdict;
  reasons: Reason[];
  /** The prescription item this verdict is about, when one can be named. */
  itemId?: string;
}

// ---- Persisted app state (lib/store.ts) ----

/** The four dose times of day. "1-0-1" style frequencies map onto these (lib/schedule.ts). */
export const SLOTS = ["morning", "afternoon", "evening", "night"] as const;
export type Slot = (typeof SLOTS)[number];

/** The family member who answers "is this the right strip?" when Nayan is not sure. */
export interface Caregiver {
  name: string;
  relation: string;
}

export type CaregiverCaseStatus = "waiting" | "answered" | "expired";

/** A strip photo sent to the caregiver for a one-tap सही/गलत answer. The photo itself lives on the server. */
export interface CaregiverCaseRef {
  id: string;
  /** Secret part of the caregiver's link; only the phone that created the case knows it. */
  token: string;
  createdAt: string;
  /** What the user was checking, e.g. "Dolo 650" or "पत्ता 2", shown in the case list. */
  itemLabel: string;
  status: CaregiverCaseStatus;
  /** The caregiver's link (contains the token), kept so it can be sent again. */
  url?: string;
  /** Who was asked, e.g. "बेटी प्रिया", frozen at creation so a later name change does not rewrite history. */
  askedWho?: string;
  /**
   * Spoken name of what was asked about: set only when the rules matched the strip to a confirmed prescription
   * line (that line's name). Never the strip's model reading, which is not confirmed and is never spoken.
   */
  askedAbout?: string;
  /** The family member's opinion. Never turned into a rule-engine verdict and never assigns a tactile tag. */
  answer?: "correct" | "wrong";
  answeredAt?: string;
  /** Prescription line (0-based) the caregiver says the strip is, with a "correct" answer, and that line's text. */
  answerItemIndex?: number;
  answerLine?: string;
  note?: string;
}

/**
 * One pocket count of a blister strip photo by the vision model (POST /api/extract kind "blister").
 * Counts only: it never says whether a dose was taken. lib/blister.ts decides that.
 */
export interface BlisterReading {
  total_pockets: number;
  empty_pockets: number;
  whole_strip_visible: boolean;
  confidence: number;
}

/** Last blister pocket count for a medicine, to warn about a double dose. */
export interface BlisterBaseline {
  at: string;
  emptyPockets: number;
  totalPockets: number;
}

/** One dose the user marked as taken. date = local "YYYY-MM-DD", at = ISO timestamp. */
export interface DoseLogEntry {
  itemId: string;
  slot: Slot;
  date: string;
  at: string;
}

export type Theme = "dark" | "light";

export interface Settings {
  theme: Theme;
  /** Local "HH:MM" for each slot. */
  slotTimes: Record<Slot, string>;
  remindersOn: boolean;
  /**
   * Nayan's own voice. Off for screen-reader (TalkBack/VoiceOver) users who prefer to hear everything through
   * their reader: the "नयन ने कहा" live region and focus still announce every message, without two voices at once.
   */
  voiceOn: boolean;
}

/** Everything Nayan keeps on the phone, saved under one versioned localStorage key. */
export interface NayanState {
  prescription: Prescription | null;
  caregiver: Caregiver | null;
  cases: CaregiverCaseRef[];
  /** Keyed by PrescriptionItem.id. */
  blisterBaselines: Record<string, BlisterBaseline>;
  doseLog: DoseLogEntry[];
  /**
   * Reminders already given, as "YYYY-MM-DD:slot" (lib/today.ts reminderKey), so each dose time is announced
   * once per day even after a reload or with two tabs open. Only the last few are kept.
   */
  remindersFired: string[];
  settings: Settings;
}

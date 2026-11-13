// Patient-side bookkeeping for caregiver cases: pure functions the poller (components/app/useCaregiverCases.ts)
// uses to turn what the server says into the saved CaregiverCaseRef. Unit-tested in caregiver-cases.test.ts.

import type { CaregiverCaseRef } from "./types";
import { CASE_TTL_MS, type CaseView, type CreatedCase } from "./case-schema";

export function newCaseRef(
  created: CreatedCase,
  itemLabel: string,
  askedWho: string,
  now = new Date(),
  askedAbout?: string,
): CaregiverCaseRef {
  const ref: CaregiverCaseRef = { id: created.id, token: created.token, url: created.url, createdAt: now.toISOString(), itemLabel, askedWho, status: "waiting" };
  return askedAbout ? { ...ref, askedAbout } : ref;
}

/** Past its 48 h on our own clock: no need to ask the server, it no longer serves it. */
export function expiredLocally(ref: CaregiverCaseRef, now = new Date()): boolean {
  const t = Date.parse(ref.createdAt);
  return !Number.isFinite(t) || now.getTime() >= t + CASE_TTL_MS;
}

/**
 * Merge the server's view into the saved ref. Returns the same object when nothing changed, so the store
 * does not re-render. Only a waiting case can change; an answer, once saved, is never overwritten.
 */
export function applyCaseView(ref: CaregiverCaseRef, view: CaseView): CaregiverCaseRef {
  if (ref.status !== "waiting" || view.status !== "answered" || !view.answer) return ref;
  const idx = view.answer === "correct" && view.itemIndex != null ? view.itemIndex : undefined;
  return {
    ...ref,
    status: "answered",
    answer: view.answer,
    answeredAt: view.answeredAt,
    answerItemIndex: idx,
    answerLine: idx != null ? view.itemLines[idx] : undefined,
    note: view.note?.trim() || undefined,
  };
}

/** The server no longer has it (expired, or the server lost its files): stop waiting. */
export function markExpired(ref: CaregiverCaseRef): CaregiverCaseRef {
  return ref.status === "waiting" ? { ...ref, status: "expired" } : ref;
}

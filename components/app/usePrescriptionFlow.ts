"use client";
// Setup: prescription photo (or demo) → lines read by Gemini → reviewed one by one → saved in the store.
// Only lines the user confirmed are saved; the rule engine treats them as ground truth.

import { useState } from "react";
import type { PrescriptionItem } from "@/lib/types";
import { SAY } from "@/lib/messages";
import { cachedLookup, fetchLookups, prepareImage, readPrescription } from "@/lib/client";
import { DEMO_PRESCRIPTION } from "@/lib/fixtures";
import { newId } from "@/lib/id";
import { updateNayan, withPrescription } from "@/lib/store";
import type { BusyKind } from "./AppContext";

export type DraftStatus = "pending" | "ok" | "removed";
export type DraftItem = PrescriptionItem & { confidence?: number; status: DraftStatus };

interface Deps {
  say: (text: string) => Promise<void>;
  setBusy: (b: BusyKind | null) => void;
  speakError: (e: unknown) => void;
  /** The review closed: saved = true after "सेव करें", false after "रद्द करें". */
  onClosed: (saved: boolean) => void;
}

export interface PrescriptionFlow {
  /** Lines being reviewed; null when no review is open. */
  draft: DraftItem[] | null;
  setItems: (fn: (items: DraftItem[]) => DraftItem[]) => void;
  fromPhoto: (file: File) => Promise<void>;
  startDemo: () => void;
  save: () => void;
  cancel: () => void;
}

export function usePrescriptionFlow({ say, setBusy, speakError, onClosed }: Deps): PrescriptionFlow {
  const [draft, setDraft] = useState<DraftItem[] | null>(null);

  async function startReview(items: (PrescriptionItem & { confidence?: number })[]) {
    // Look the names up first so each line can be read back with its salt and strength.
    await fetchLookups(items.map((i) => i.nameAsWritten));
    if (!items.length) {
      say(SAY.noMedicinesFound);
      return;
    }
    // The review screen speaks the intro together with the first line (a second speak() would cut it off).
    setDraft(items.map((i) => ({ ...i, status: "pending" })));
  }

  async function fromPhoto(file: File) {
    setBusy("prescription");
    say(SAY.readingPrescription);
    try {
      await startReview(await readPrescription(await prepareImage(file)));
    } catch (e) {
      speakError(e);
    } finally {
      setBusy(null);
    }
  }

  function startDemo() {
    setBusy("lookup");
    void startReview(DEMO_PRESCRIPTION.map((i) => ({ ...i, id: newId() }))).finally(() => setBusy(null));
  }

  function save() {
    if (!draft) return;
    // Store the confirmed salts and strengths with each line, so later checks don't depend on a lookup.
    const items: PrescriptionItem[] = draft
      .filter((d) => d.status === "ok")
      .map(({ status: _s, confidence: _c, ...item }) => {
        if (item.ingredients.length) return item;
        const hit = cachedLookup(item.nameAsWritten);
        return hit && hit.score === 1 ? { ...item, ingredients: hit.entry.ingredients, form: item.form ?? hit.entry.form } : item;
      });
    if (!items.length) return;
    updateNayan((s) => withPrescription(s, { items, savedAt: new Date().toISOString() }));
    setDraft(null);
    onClosed(true);
    say(SAY.saved(items.length));
  }

  function cancel() {
    setDraft(null);
    onClosed(false);
    say(SAY.cancelled);
  }

  return {
    draft,
    setItems: (fn) => setDraft((d) => (d ? fn(d) : d)),
    fromPhoto,
    startDemo,
    save,
    cancel,
  };
}

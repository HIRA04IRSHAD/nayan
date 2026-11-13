"use client";
// Daily check: strip photo → fields (Gemini) → checkAgainstPrescription() → spoken verdict.
// On the first verified match the strip gets the next free tactile tag.
// The last photo and reading are kept as "evidence" for "परिवार से पूछें" (components/app/useCaregiverCases.ts).

import { useRef, useState } from "react";
import type { CheckResult, PrescriptionItem, StripReading, TactileTagId } from "@/lib/types";
import { checkAgainstPrescription } from "@/lib/rules";
import { SAY, tagInstruction, verdictText } from "@/lib/messages";
import { nextFreeTag } from "@/lib/tags";
import { fetchLookups, prepareImage, readStrip, type PreparedImage } from "@/lib/client";
import { getNayanState, updateNayan, withItemTag } from "@/lib/store";
import type { BusyKind } from "./AppContext";

/** After this many "not sure" scans of one strip, offer to ask a family member. */
export const MAX_TRIES_BEFORE_CAREGIVER = 2;

export interface CheckOutcome {
  res: CheckResult;
  /** Exactly what was spoken. */
  text: string;
  /** The prescription line the verdict is about (with its tag after assignment), if one can be named. */
  item?: PrescriptionItem;
  itemIndex: number;
  /** Set when this check just handed out a tag, so the screen can show which sticker to put on. */
  newTag: TactileTagId | null;
}

/** What a family member gets to see for the strip on screen: the photo (or the demo strip's name) and the reading. */
export interface StripEvidence {
  photo: PreparedImage | null;
  /** Set for a demo strip, which has no camera photo. */
  demoLabel: string | null;
  reading: StripReading | null;
}

interface Deps {
  say: (text: string) => Promise<void>;
  setBusy: (b: BusyKind | null) => void;
  speakError: (e: unknown) => void;
}

export interface StripCheck {
  result: CheckOutcome | null;
  /** "Not sure" scans in a row for the current strip. */
  tries: number;
  fromPhoto: (file: File) => Promise<void>;
  /** Check a sample strip (demo mode, no camera photo). */
  fromDemo: (reading: StripReading, label: string) => Promise<void>;
  evaluate: (reading: StripReading) => Promise<void>;
  reset: () => void;
  /** The photo and reading behind the verdict on screen. */
  evidence: () => StripEvidence;
}

interface Session {
  readings: StripReading[];
  tries: number;
  photo: PreparedImage | null;
  demoLabel: string | null;
  last: StripReading | null;
}

const emptySession = (): Session => ({ readings: [], tries: 0, photo: null, demoLabel: null, last: null });

export function useStripCheck({ say, setBusy, speakError }: Deps): StripCheck {
  const [result, setResult] = useState<CheckOutcome | null>(null);
  const [tries, setTries] = useState(0);
  // Kept in a ref: evaluate() runs after awaits and must see the latest scans, not a stale render's.
  const session = useRef<Session>(emptySession());

  function reset() {
    session.current = emptySession();
    setTries(0);
    setResult(null);
  }

  async function evaluate(reading: StripReading) {
    const rx = getNayanState().prescription;
    if (!rx) return;
    // Keep the previous unsure scan so two agreeing scans can confirm a hard-to-read field.
    const scans = [...session.current.readings, reading].slice(-2);
    const lookup = await fetchLookups([...scans.map((s) => s.brand.value), ...rx.items.map((i) => i.nameAsWritten)]);
    const res = checkAgainstPrescription(rx.items, scans, lookup);
    const itemIndex = rx.items.findIndex((i) => i.id === res.itemId);
    let item = itemIndex >= 0 ? rx.items[itemIndex] : undefined;
    let text = verdictText(res, item);
    let newTag: TactileTagId | null = null;

    // Tags come only from a rule-engine match. A family member's answer (useCaregiverCases) never gets here.
    if (res.verdict === "match" && item) {
      if (item.tag) {
        text += ` ${SAY.tagShouldBe(item.tag)}`;
      } else {
        const tag = nextFreeTag(getNayanState().prescription?.items ?? rx.items);
        if (tag) {
          const id = item.id;
          updateNayan((s) => withItemTag(s, id, tag));
          item = { ...item, tag };
          newTag = tag;
          text += ` ${tagInstruction(tag, item)}`;
        } else {
          text += ` ${SAY.allTagsUsed}`;
        }
      }
    }

    session.current.last = reading;
    if (res.verdict === "not_sure") {
      const n = session.current.tries + 1;
      session.current = { ...session.current, readings: scans, tries: n };
      if (n >= MAX_TRIES_BEFORE_CAREGIVER) text += ` ${SAY.canSendToFamily}`;
    } else {
      session.current = { ...session.current, readings: [], tries: 0 };
    }
    setTries(session.current.tries);
    setResult({ res, text, item, itemIndex, newTag });
    say(text);
  }

  async function fromPhoto(file: File) {
    setBusy("strip");
    say(SAY.readingStrip);
    try {
      const img = await prepareImage(file);
      session.current.photo = img;
      session.current.demoLabel = null;
      await evaluate(await readStrip(img));
    } catch (e) {
      // Do not leave the previous verdict on screen: it would look like the answer for this photo.
      setResult(null);
      speakError(e);
    } finally {
      setBusy(null);
    }
  }

  async function fromDemo(reading: StripReading, label: string) {
    // A sample strip must never be sent to the family with an earlier real photo.
    session.current.photo = null;
    session.current.demoLabel = label;
    await evaluate(reading);
  }

  const evidence = (): StripEvidence => ({
    photo: session.current.photo,
    demoLabel: session.current.demoLabel,
    reading: session.current.last,
  });

  return { result, tries, fromPhoto, fromDemo, evaluate, reset, evidence };
}

"use client";
// "खुराक जाँच (ब्लिस्टर)": pick a medicine → photo of the back of its strip → two pocket counts (Gemini) →
// evaluateBlister() (lib/blister.ts) → spoken warning from a fixed template (lib/blister-messages.ts).
// Saves the strip's count in store.blisterBaselines and, on "मैंने अभी ली", the dose in store.doseLog.
// Like the strip check: the model only counts pockets, the rules decide.

import { useRef, useState } from "react";
import type { BlisterReading, PrescriptionItem } from "@/lib/types";
import { evaluateBlister, expectedEmptyNow, markTaken as markDoseTaken, pillSchedule, type BlisterResult } from "@/lib/blister";
import { blisterText, SAY_DOSE } from "@/lib/blister-messages";
import { SLOT_HI } from "@/lib/schedule";
import { prepareImage, readBlister } from "@/lib/client";
import { addDose, getNayanState, updateNayan, withBlisterBaseline } from "@/lib/store";
import type { BusyKind } from "./AppContext";

export interface DoseOutcome {
  r: BlisterResult;
  /** Exactly what was spoken. */
  text: string;
  item: PrescriptionItem;
  itemIndex: number;
  /** "मैंने अभी ली" was tapped for this result. */
  marked: boolean;
}

/** Sample counts for trying the flow without a camera or API key, relative to what the rules expect now. */
export type DemoBlister = "as_expected" | "one_dose_less" | "one_more" | "blurry" | "new_strip";

export const DEMO_BLISTERS: { kind: DemoBlister; label: string }[] = [
  { kind: "as_expected", label: "जितने खाली होने चाहिए" },
  { kind: "one_dose_less", label: "एक खुराक कम खाली" },
  { kind: "one_more", label: "एक खाना ज़्यादा खाली" },
  { kind: "blurry", label: "धुंधली फ़ोटो (गिनती अलग)" },
  { kind: "new_strip", label: "नया पत्ता" },
];

interface Deps {
  say: (text: string) => Promise<void>;
  setBusy: (b: BusyKind | null) => void;
  speakError: (e: unknown) => void;
  /** Move focus to the screen title after the next render (the flow's own title on start, the tab's on close). */
  focusScreenTitle: () => void;
  onClosed: () => void;
}

export interface DoseCheck {
  /** The flow is open (shown full screen instead of the tabs). */
  active: boolean;
  itemId: string | null;
  result: DoseOutcome | null;
  /** Open the flow, optionally with the medicine already chosen (e.g. from the Today screen). */
  start: (itemId?: string) => void;
  close: () => void;
  pick: (itemId: string) => void;
  /** Back to choosing the medicine. */
  unpick: () => void;
  fromPhoto: (file: File) => Promise<void>;
  fromDemo: (kind: DemoBlister) => void;
  /** "मैंने अभी ली": save the dose and the count including it. */
  markTaken: () => void;
}

const currentItems = () => getNayanState().prescription?.items ?? [];

export function useBlisterCheck({ say, setBusy, speakError, focusScreenTitle, onClosed }: Deps): DoseCheck {
  const [active, setActive] = useState(false);
  const [itemId, setItemId] = useState<string | null>(null);
  const [result, setResult] = useState<DoseOutcome | null>(null);
  // Read after awaits (the photo read takes seconds): a ref always has the chosen medicine, not a stale render's.
  const chosen = useRef<string | null>(null);

  function choose(id: string | null) {
    chosen.current = id;
    setItemId(id);
    setResult(null);
  }

  /** Only medicines with a fixed whole-tablet schedule can be counted; for the others, say why. */
  function pick(id: string) {
    const item = currentItems().find((i) => i.id === id);
    if (!item) return;
    const sched = pillSchedule(item.frequency, getNayanState().settings.slotTimes);
    if (typeof sched === "string") {
      void say(SAY_DOSE.cannotCheck(item, sched));
      return;
    }
    choose(id);
    void say(SAY_DOSE.picked(item));
  }

  function start(id?: string) {
    setActive(true);
    focusScreenTitle();
    const item = id ? currentItems().find((i) => i.id === id) : undefined;
    if (item && typeof pillSchedule(item.frequency, getNayanState().settings.slotTimes) !== "string") {
      choose(item.id);
      void say(SAY_DOSE.picked(item));
    } else {
      choose(null);
      void say(SAY_DOSE.start);
    }
  }

  function close() {
    setActive(false);
    choose(null);
    onClosed();
  }

  function unpick() {
    choose(null);
    void say(SAY_DOSE.start);
  }

  function evaluate(reads: [BlisterReading | null, BlisterReading | null]) {
    const s = getNayanState();
    const items = s.prescription?.items ?? [];
    const itemIndex = items.findIndex((i) => i.id === chosen.current);
    if (itemIndex < 0) return;
    const item = items[itemIndex];
    const now = new Date();
    const r = evaluateBlister({
      reading1: reads[0],
      reading2: reads[1],
      baseline: s.blisterBaselines[item.id] ?? null,
      now,
      item,
      slotTimes: s.settings.slotTimes,
      doseLog: s.doseLog,
    });
    const saved = r.baseline;
    if (saved) updateNayan((st) => withBlisterBaseline(st, item.id, saved));
    const text = blisterText(r, item, now);
    setResult({ r, text, item, itemIndex, marked: false });
    void say(text);
  }

  async function fromPhoto(file: File) {
    if (!chosen.current) return;
    setBusy("blister");
    void say(SAY_DOSE.reading);
    try {
      const img = await prepareImage(file);
      evaluate(await readBlister(img));
    } catch (e) {
      // Do not leave the previous result on screen: it would look like the answer for this photo.
      setResult(null);
      speakError(e);
    } finally {
      setBusy(null);
    }
  }

  function fromDemo(kind: DemoBlister) {
    const s = getNayanState();
    const item = currentItems().find((i) => i.id === chosen.current);
    if (!item) return;
    const baseline = s.blisterBaselines[item.id] ?? null;
    const total = baseline?.totalPockets ?? 10;
    const exp = expectedEmptyNow(baseline, new Date(), item, s.settings.slotTimes);
    const expected = exp?.expected ?? 2;
    const count = (empty: number, t = total, confidence = 0.95): BlisterReading => ({
      total_pockets: t,
      empty_pockets: Math.max(0, Math.min(t, empty)),
      whole_strip_visible: true,
      confidence,
    });
    switch (kind) {
      case "as_expected":
        return evaluate([count(expected), count(expected)]);
      case "one_dose_less": {
        const less = expected - (exp?.pending || 1);
        return evaluate([count(less), count(less)]);
      }
      case "one_more":
        return evaluate([count(expected + 1), count(expected + 1)]);
      case "blurry":
        return evaluate([count(expected, total, 0.5), count(expected + 1, total, 0.5)]);
      case "new_strip": {
        const t = total === 10 ? 15 : 10;
        return evaluate([count(0, t), count(0, t)]);
      }
    }
  }

  function markTaken() {
    const cur = result;
    if (!cur || cur.marked) return;
    const m = markDoseTaken(cur.r, cur.item.id, new Date());
    if (!m) return;
    const id = cur.item.id;
    updateNayan((s) => addDose(withBlisterBaseline(s, id, m.baseline), m.dose));
    setResult({ ...cur, marked: true });
    void say(SAY_DOSE.marked(SLOT_HI[m.dose.slot]));
  }

  return { active, itemId, result, start, close, pick, unpick, fromPhoto, fromDemo, markTaken };
}

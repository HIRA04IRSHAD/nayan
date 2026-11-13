"use client";
// "परिवार से पूछें" on the patient's phone: create a case on the server, share the caregiver's link, and poll
// waiting cases until the family member answers (then say the answer aloud).
//
// SAFETY: the answer is the family member's opinion. It is saved and spoken as theirs (caregiverAnswerText);
// it never becomes a rule-engine verdict and never assigns a tactile tag. Nothing here imports lib/rules or
// lib/tags on purpose.

import { useEffect, useState } from "react";
import type { CaregiverCaseRef } from "@/lib/types";
import { describeItem, SAY } from "@/lib/messages";
import { caregiverAnswerText, caregiverWho, caseShareText, SAY_FAMILY, stripReadingText } from "@/lib/caregiver-messages";
import { applyCaseView, expiredLocally, markExpired, newCaseRef } from "@/lib/caregiver-cases";
import { caseUrl, LIMITS } from "@/lib/case-schema";
import { createCase, fetchCase } from "@/lib/case-client";
import { cachedLookup, drawDemoStripPhoto, fetchLookups } from "@/lib/client";
import { getNayanState, updateCase, updateNayan, upsertCase } from "@/lib/store";
import type { BusyKind } from "./AppContext";
import type { CheckOutcome, StripEvidence } from "./useStripCheck";

/** How often waiting cases are checked while the app is open and visible. */
export const POLL_MS = 5000;

/** The case whose link is being sent: the share panel offers Web Share, WhatsApp and copy for it. */
export interface PendingShare {
  caseId: string;
  url: string;
  text: string;
}

export interface CaregiverCases {
  pending: PendingShare | null;
  /** Create a case for the verdict on screen and open the share sheet. */
  ask: (outcome: CheckOutcome | null) => Promise<void>;
  /** (Re)send a saved case's link. */
  share: (ref: CaregiverCaseRef) => Promise<void>;
  copyLink: () => Promise<void>;
  dismiss: () => void;
  /** Say a saved answer again. */
  replay: (ref: CaregiverCaseRef) => void;
}

interface Deps {
  say: (text: string) => Promise<void>;
  announce: (text: string) => void;
  setBusy: (b: BusyKind | null) => void;
  busy: BusyKind | null;
  getEvidence: () => StripEvidence;
  cases: CaregiverCaseRef[];
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The answer as spoken now, against the prescription saved now (see caregiverAnswerText). */
export const answerText = (ref: CaregiverCaseRef) =>
  caregiverAnswerText(ref, { now: new Date(), prescriptionSavedAt: getNayanState().prescription?.savedAt ?? null });

const linkFor = (ref: CaregiverCaseRef) => ref.url ?? caseUrl(window.location.origin, ref.id, ref.token);

export function useCaregiverCases({ say, announce, setBusy, busy, getEvidence, cases }: Deps): CaregiverCases {
  const [pending, setPending] = useState<PendingShare | null>(null);
  // Answers arrive in the background, so they go through announce (AppContext): queued one after another, and
  // never on top of a verdict, a photo read or the yes/no microphone. announce is stable, so the poller does not
  // restart.

  async function share(ref: CaregiverCaseRef) {
    const url = linkFor(ref);
    const text = caseShareText(getNayanState().caregiver?.name ?? "");
    setPending({ caseId: ref.id, url, text });
    if (typeof navigator === "undefined" || !navigator.share) return; // the panel's WhatsApp / copy buttons remain
    try {
      await navigator.share({ title: "नयन", text, url });
    } catch {
      // Closed by the user (AbortError), or the tap's activation was used up by the network request
      // (NotAllowedError): the share panel stays open with its own buttons, each a fresh tap.
    }
  }

  async function ask(outcome: CheckOutcome | null) {
    const rx = getNayanState().prescription;
    if (!outcome || !rx) return;
    if (busy) {
      say(SAY.wait);
      return;
    }
    const ev = getEvidence();
    setBusy("case");
    say(SAY_FAMILY.creating);
    try {
      let photo = ev.photo;
      if (!photo && ev.demoLabel && ev.reading) photo = await drawDemoStripPhoto(ev.demoLabel, stripReadingText(ev.reading).split(" · "));
      if (!photo) {
        say(SAY_FAMILY.noPhoto);
        return;
      }
      const lookup = await fetchLookups(rx.items.map((i) => i.nameAsWritten)).catch(() => cachedLookup);
      const caregiver = getNayanState().caregiver;
      const created = await createCase({
        photo: photo.base64,
        mime: "image/jpeg",
        itemLines: rx.items.slice(0, LIMITS.lines).map((i, n) => clip(describeItem(i, n, lookup), LIMITS.line)),
        whatNayanRead: ev.reading ? clip(stripReadingText(ev.reading), LIMITS.whatNayanRead) : "",
        verdictText: clip(outcome.text, LIMITS.verdictText),
        caregiverName: clip(caregiver?.name ?? "", LIMITS.caregiverName),
      });
      const who = caregiverWho(caregiver);
      // Label for the history list: the prescription line when the rules named one, else the demo name or the strip's brand.
      const label = outcome.item?.nameAsWritten ?? ev.demoLabel ?? ev.reading?.brand.value ?? "पत्ता";
      // Spoken with the answer only when the rules matched a confirmed prescription line (never the model's reading).
      const about = outcome.res.verdict === "match" && outcome.item ? clip(outcome.item.nameAsWritten, 80) : undefined;
      const ref = newCaseRef(created, clip(label, 80), who, new Date(), about);
      updateNayan((s) => upsertCase(s, ref));
      setBusy(null);
      say(SAY_FAMILY.created(who));
      await share(ref);
    } catch (e) {
      console.error(e);
      say(SAY_FAMILY.failed);
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.url);
      say(SAY_FAMILY.linkCopied);
    } catch {
      say(SAY_FAMILY.copyFailed);
    }
  }

  // ---- polling: only while some case is waiting; restarts when that set changes; stops on unmount.
  const waitingKey = cases
    .filter((c) => c.status === "waiting")
    .map((c) => c.id)
    .join(",");

  useEffect(() => {
    if (!waitingKey) return;
    let cancelled = false;
    let inFlight = false;

    async function tick() {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        for (const ref of getNayanState().cases.filter((c) => c.status === "waiting")) {
          if (cancelled) return;
          if (expiredLocally(ref)) {
            updateNayan((s) => updateCase(s, ref.id, markExpired));
            continue;
          }
          let r: Awaited<ReturnType<typeof fetchCase>>;
          try {
            r = await fetchCase(ref.id, ref.token);
          } catch {
            continue; // offline or server hiccup: try again on the next tick
          }
          if (cancelled) return;
          if (r.kind === "gone") {
            updateNayan((s) => updateCase(s, ref.id, markExpired));
            continue;
          }
          // Read and write with no await in between, so the answer is applied (and spoken) exactly once.
          const cur = getNayanState().cases.find((c) => c.id === ref.id);
          if (!cur) continue;
          const next = applyCaseView(cur, r.view);
          if (next === cur) continue;
          updateNayan((s) => updateCase(s, ref.id, () => next));
          if (next.status === "answered") announce(answerText(next));
        }
      } finally {
        inFlight = false;
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waitingKey, announce]);

  return {
    pending,
    ask,
    share,
    copyLink,
    dismiss: () => setPending(null),
    replay: (ref) => {
      if (ref.status === "answered") say(answerText(ref));
      else say(ref.status === "waiting" ? SAY_FAMILY.waiting(ref.askedWho || "परिवार वाले") : SAY_FAMILY.expired(ref.askedWho || "परिवार वाले"));
    },
  };
}

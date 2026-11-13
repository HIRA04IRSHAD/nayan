"use client";
// Setup step 2: every line read from the prescription is shown on its own large card, read aloud, and
// confirmed by tap or voice before anything is saved. A sighted family member can correct the fields
// under "बदलें". Only confirmed lines are saved (the rule engine trusts them completely).

import { useEffect, useRef, useState } from "react";
import type { DosageForm } from "@/lib/types";
import { DOSAGE_FORMS } from "@/lib/types";
import { composition, describeItem, FORM_HI, SAY } from "@/lib/messages";
import { scheduleHi } from "@/lib/schedule";
import { resolvePrescribed } from "@/lib/rules";
import { canListen, listenYesNo } from "@/lib/speech";
import { cachedLookup, fetchLookups } from "@/lib/client";
import { compositionText, parseComposition } from "@/lib/composition";
import { useApp } from "@/components/app/AppContext";
import type { DraftItem, DraftStatus } from "@/components/app/usePrescriptionFlow";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SCREEN_TITLE_ID } from "@/components/ui/ScreenTitle";
import { Notice } from "./common";

/** Below this the model itself was unsure about a line: ask for a careful look. */
const LOW_CONFIDENCE = 0.6;

const STATUS_HI: Record<DraftStatus, string> = { pending: "बाकी", ok: "सही", removed: "हटाई गई" };

export function ReviewScreen() {
  const { rx, say } = useApp();
  const items = rx.draft ?? [];
  const n = items.length;
  const [step, setStep] = useState(0); // 0..n-1 = a medicine, n = summary
  const [listening, setListening] = useState(false);
  const [voiceAvailable] = useState(() => canListen());
  // Bumped after a lookup finishes so an edited line shows (and reads back) its new salt.
  const [, setLookupsDone] = useState(0);

  const listeningRef = useRef(false);
  const spokenStep = useRef<number | null>(null);
  const introDone = useRef(false);
  const ackPrefix = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancelRef = useRef<HTMLParagraphElement>(null);

  const counts = { ok: 0, removed: 0, pending: 0 };
  for (const d of items) counts[d.status]++;
  const atSummary = step >= n;
  const current = atSummary ? null : items[step];

  const update = (id: string, patch: Partial<DraftItem>) => rx.setItems((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  // Any correction puts the line back to "pending": it has to be confirmed again as it now reads.
  const edit = (id: string, patch: Partial<DraftItem>) => update(id, { ...patch, status: "pending" });
  const recheckName = (name: string) => void fetchLookups([name]).then(() => setLookupsDone((x) => x + 1));
  const stepText = (idx: number) => SAY.reviewStep(idx + 1, n, describeItem(items[idx], undefined, cachedLookup));

  // Read each card aloud when it appears (and the intro with the first one). Skipped while the voice loop
  // runs, because the loop does its own speaking; spokenStep also stops React's dev double-run speaking twice.
  useEffect(() => {
    if (listeningRef.current || spokenStep.current === step) return;
    spokenStep.current = step;
    const lead = [introDone.current ? "" : SAY.reviewIntro(n), ackPrefix.current].filter(Boolean).join(" ");
    introDone.current = true;
    ackPrefix.current = "";
    const body = step < n ? stepText(step) : SAY.reviewSummary(counts.ok, counts.removed, counts.pending);
    say(lead ? `${lead} ${body}` : body);
  }, [step]); // only on step change: edits to the card must not interrupt with a re-read

  // Focus follows the card, so a screen reader is always on the medicine being asked about.
  useEffect(() => headingRef.current?.focus(), [step]);

  function goStep(k: number) {
    setStep(Math.max(0, Math.min(n, k)));
  }

  /** The next undecided line after idx (wrapping round), or the summary when none is left. */
  function nextPending(idx: number, statuses: DraftStatus[]): number {
    for (let k = idx + 1; k < n; k++) if (statuses[k] === "pending") return k;
    for (let k = 0; k < idx; k++) if (statuses[k] === "pending") return k;
    return n;
  }

  function decide(status: "ok" | "removed") {
    if (!current || listening) return;
    update(current.id, { status });
    ackPrefix.current = status === "ok" ? SAY.okAck : SAY.removedAck;
    const statuses = items.map((d, k) => (k === step ? status : d.status));
    goStep(nextPending(step, statuses));
  }

  function restore(k: number) {
    update(items[k].id, { status: "pending" });
    ackPrefix.current = SAY.restored;
    goStep(k);
  }

  async function voiceConfirm() {
    if (listeningRef.current) return;
    listeningRef.current = true;
    setListening(true);
    try {
      const statuses = items.map((d) => d.status);
      const start = Math.min(step, n - 1);
      const order = [...items.keys()].slice(start).concat([...items.keys()].slice(0, start));
      for (const idx of order) {
        if (statuses[idx] !== "pending") continue;
        const d = items[idx];
        spokenStep.current = idx;
        setStep(idx);
        await say(SAY.confirmQuestion(stepText(idx)));
        const ans = await listenYesNo();
        if (ans === "yes") {
          statuses[idx] = "ok";
          update(d.id, { status: "ok" });
        } else if (ans === "no") {
          statuses[idx] = "removed";
          update(d.id, { status: "removed" });
          await say(SAY.voiceRemoved);
        } else {
          await say(SAY.voiceNotUnderstood);
          return;
        }
      }
      spokenStep.current = n;
      setStep(n);
      await say(SAY.allReviewed);
    } finally {
      listeningRef.current = false;
      setListening(false);
    }
  }

  function askCancel() {
    setConfirmingCancel(true);
    say(SAY.reviewCancelConfirm);
  }
  // The question takes focus once it is on screen, so a screen reader user lands on it and then its two buttons.
  useEffect(() => {
    if (confirmingCancel) cancelRef.current?.focus();
  }, [confirmingCancel]);

  // Tapping "सेव करें" too early says why instead of doing nothing silently.
  const explainSummary = () => say(SAY.reviewSummary(counts.ok, counts.removed, counts.pending));

  return (
    <section className="review" aria-labelledby={SCREEN_TITLE_ID}>
      <div className="review-head">
        <p className="overline">नए पर्चे की जाँच</p>
        <ol className="step-dots" aria-hidden="true">
          {items.map((d, k) => (
            <li key={d.id} className={`step-dot step-dot--${d.status}${k === step ? " step-dot--current" : ""}`}>
              {d.status === "ok" ? <Icon name="check" size={16} /> : d.status === "removed" ? <Icon name="x" size={16} /> : k + 1}
            </li>
          ))}
          <li className={`step-dot step-dot--summary${atSummary ? " step-dot--current" : ""}`}>
            <Icon name="save" size={16} />
          </li>
        </ol>
      </div>

      {current ? (
        <article key={current.id} className={`med-card med-card--${current.status}`}>
          <div className="med-card-top">
            <span className="step-count">
              {step + 1} / {n}
            </span>
            {current.status !== "pending" && (
              <span className={`chip chip--${current.status === "ok" ? "ok" : "bad"}`}>
                <Icon name={current.status === "ok" ? "check" : "x"} size={18} />
                {current.status === "ok" ? "आपने सही बताया" : "हटाई गई"}
              </span>
            )}
          </div>

          <h1 id={SCREEN_TITLE_ID} ref={headingRef} tabIndex={-1} className="med-card-name">
            <span className="visually-hidden">
              दवा {step + 1}, कुल {n} में से:{" "}
            </span>
            {current.nameAsWritten || "—"}
          </h1>

          <dl className="facts">
            <div>
              <dt>नमक और ताकत</dt>
              <dd>{composition(current, cachedLookup) ?? "—"}</dd>
            </div>
            <div>
              <dt>कब</dt>
              <dd>{scheduleHi(current.frequency, current.timing) || "—"}</dd>
            </div>
            <div>
              <dt>रूप</dt>
              <dd>{current.form ? FORM_HI[current.form] : "—"}</dd>
            </div>
            <div>
              <dt>कितने दिन</dt>
              <dd>{current.durationDays ? `${current.durationDays} दिन` : "—"}</dd>
            </div>
          </dl>

          {current.confidence != null && current.confidence < LOW_CONFIDENCE && (
            <Notice tone="warn">यह लाइन ठीक से पढ़ी नहीं गई। ध्यान से जाँचिए।</Notice>
          )}
          {resolvePrescribed(current, cachedLookup) === null && (
            <Notice tone="warn" title="यह दवा सूची में नहीं मिली">
              नीचे “बदलें” में नमक और ताकत लिखिए, वरना जाँच में “पक्का नहीं” आएगा।
            </Notice>
          )}

          <div className="decide">
            <Button variant="success" size="xl" icon="check" aria-disabled={listening} onClick={() => decide("ok")}>
              सही है
            </Button>
            <Button variant="danger" size="xl" icon="x" aria-disabled={listening} onClick={() => decide("removed")}>
              गलत / हटाएँ
            </Button>
          </div>

          {voiceAvailable && (
            <Button icon="mic" aria-disabled={listening} onClick={() => void voiceConfirm()}>
              {listening ? "सुन रहे हैं… हाँ या नहीं बोलिए" : "आवाज़ से बताइए"}
            </Button>
          )}

          <div className="review-nav">
            <Button variant="ghost" size="md" icon="arrowLeft" aria-disabled={step === 0 || listening} onClick={() => step > 0 && goStep(step - 1)}>
              पिछली
            </Button>
            {/* Blocked during the voice loop: speaking here would cut off its question, and the microphone could
                hear words like "नहीं" from this read-out as the user's answer. */}
            <Button variant="ghost" size="md" icon="speaker" aria-disabled={listening} onClick={() => say(stepText(step))}>
              सुनें
            </Button>
            <Button variant="ghost" size="md" icon="arrowRight" aria-disabled={listening} onClick={() => goStep(step + 1)}>
              {step === n - 1 ? "सारांश" : "अगली"}
            </Button>
          </div>

          <details className="disclosure edit">
            <summary>
              <Icon name="edit" size={24} />
              बदलें (परिवार वाले के लिए)
            </summary>
            <div className="disclosure-body form">
              <label className="field">
                <span className="field-label">दवा का नाम</span>
                <input
                  className="input"
                  value={current.nameAsWritten}
                  onChange={(e) => edit(current.id, { nameAsWritten: e.target.value })}
                  onBlur={(e) => recheckName(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">नमक और ताकत (जैसे: Paracetamol 650 mg + Caffeine 50 mg)</span>
                <input
                  className="input"
                  defaultValue={compositionText(current.ingredients)}
                  onBlur={(e) => edit(current.id, { ingredients: parseComposition(e.target.value) })}
                />
              </label>
              <label className="field">
                <span className="field-label">रूप</span>
                <select
                  className="input"
                  value={current.form ?? ""}
                  onChange={(e) => edit(current.id, { form: (e.target.value || null) as DosageForm | null })}
                >
                  <option value="">—</option>
                  {DOSAGE_FORMS.map((f) => (
                    <option key={f} value={f}>
                      {FORM_HI[f]} ({f})
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-row">
                <label className="field">
                  <span className="field-label">कब (1-0-1)</span>
                  <input className="input" value={current.frequency ?? ""} onChange={(e) => edit(current.id, { frequency: e.target.value || null })} />
                </label>
                <label className="field">
                  <span className="field-label">दिन</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={current.durationDays ?? ""}
                    onChange={(e) => edit(current.id, { durationDays: e.target.value ? Number(e.target.value) || null : null })}
                  />
                </label>
              </div>
              <label className="field">
                <span className="field-label">खाने से पहले/बाद</span>
                <input className="input" value={current.timing ?? ""} onChange={(e) => edit(current.id, { timing: e.target.value || null })} />
              </label>
            </div>
          </details>
        </article>
      ) : (
        <article className="med-card summary">
          <h1 id={SCREEN_TITLE_ID} ref={headingRef} tabIndex={-1} className="med-card-name">
            सारांश
          </h1>
          <p className="summary-counts">
            <span className="chip chip--ok">
              <Icon name="check" size={18} /> {counts.ok} सही
            </span>
            {counts.removed > 0 && (
              <span className="chip chip--bad">
                <Icon name="x" size={18} /> {counts.removed} हटाई
              </span>
            )}
            {counts.pending > 0 && (
              <span className="chip chip--warn">
                <Icon name="question" size={18} /> {counts.pending} बाकी
              </span>
            )}
          </p>

          <ul className="summary-list">
            {items.map((d, k) => (
              <li key={d.id} className={`summary-row summary-row--${d.status}`}>
                <span className="summary-mark">
                  <Icon name={d.status === "ok" ? "check" : d.status === "removed" ? "x" : "question"} size={22} />
                </span>
                <div className="summary-text">
                  <p className="summary-name">
                    {d.nameAsWritten || "—"} <span className="visually-hidden">({STATUS_HI[d.status]})</span>
                  </p>
                  <p className="muted">{composition(d, cachedLookup) ?? "सूची में नहीं मिली"}</p>
                </div>
                {d.status === "removed" ? (
                  <Button size="md" inline icon="undo" onClick={() => restore(k)} aria-label={`${d.nameAsWritten} वापस लाएँ`}>
                    वापस लाएँ
                  </Button>
                ) : (
                  <Button size="md" inline variant={d.status === "pending" ? "secondary" : "ghost"} onClick={() => goStep(k)} aria-label={`${d.nameAsWritten} देखें`}>
                    देखें
                  </Button>
                )}
              </li>
            ))}
          </ul>

          <Button
            variant="primary"
            size="xl"
            icon="save"
            aria-disabled={counts.pending > 0 || counts.ok === 0}
            whenUnavailable={explainSummary}
            onClick={rx.save}
          >
            सेव करें ({counts.ok})
          </Button>
          {counts.pending > 0 && <p className="muted center">सेव करने से पहले हर दवा को “सही है” या “हटाएँ” कीजिए।</p>}
          <Button variant="ghost" icon="arrowLeft" onClick={() => goStep(n - 1)}>
            पिछली दवा
          </Button>
        </article>
      )}

      {confirmingCancel ? (
        // Asked in the app (not window.confirm): a mis-tap on "रद्द करें" would throw away a read prescription,
        // and reading it again costs another quota-limited photo read.
        <div className="card stack cancel-confirm" role="group" aria-labelledby="cancel-q">
          <p id="cancel-q" ref={cancelRef} tabIndex={-1} className="cancel-q">
            {SAY.reviewCancelConfirm}
          </p>
          <Button
            variant="primary"
            icon="check"
            onClick={() => {
              setConfirmingCancel(false);
              headingRef.current?.focus();
              say(SAY.reviewCancelKept);
            }}
          >
            नहीं, जाँच जारी रखें
          </Button>
          <Button variant="danger" icon="x" onClick={rx.cancel}>
            हाँ, रद्द करें
          </Button>
        </div>
      ) : (
        <Button variant="ghost" icon="x" aria-disabled={listening} onClick={askCancel}>
          रद्द करें
        </Button>
      )}
    </section>
  );
}

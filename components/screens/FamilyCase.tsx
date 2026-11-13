"use client";
// Pieces of the family confirmation loop shown on the patient's phone:
// - CaseSharePanel: after "परिवार से पूछें", the ways to send the link (share sheet, WhatsApp, copy), then the answer.
// - FamilyAnswer: a family member's answer, clearly labelled as their opinion (icon + words, not colour alone),
//   and visibly different from a rule-engine verdict card.

import { useEffect, useRef } from "react";
import type { CaregiverCaseRef } from "@/lib/types";
import { ANSWER_HI, caregiverAnswerText, SAY_FAMILY, whatsappShareUrl } from "@/lib/caregiver-messages";
import { useApp } from "@/components/app/AppContext";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export function CaseSharePanel() {
  const { family, state, say, focusScreenTitle } = useApp();
  const headRef = useRef<HTMLHeadingElement>(null);
  const p = family.pending;
  const ref = p ? state.cases.find((c) => c.id === p.caseId) : undefined;

  // A new link takes focus, so a screen reader user lands on the ways to send it. Only on a change: when the
  // panel merely re-mounts with a tab switch, focus stays on the screen title (goTo). Comparing with the
  // previous id also keeps StrictMode's double effect run harmless.
  const shownId = useRef(p?.caseId);
  useEffect(() => {
    if (shownId.current === p?.caseId) return;
    shownId.current = p?.caseId;
    if (p?.caseId) headRef.current?.focus();
  }, [p?.caseId]);

  if (!p || !ref) return null;
  const who = ref.askedWho || "परिवार वाले";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <section className="card share-panel" aria-labelledby="share-head">
      <h2 id="share-head" ref={headRef} tabIndex={-1} className="share-head">
        <Icon name="family" size={30} />
        {ref.status === "answered" ? `${who} का जवाब` : `${who} से पूछा`}
      </h2>

      {ref.status === "waiting" && (
        <>
          <p>लिंक बन गया। इसे भेजिए; जवाब आते ही नयन बोलकर बताएगा।</p>
          <div className="button-list">
            {canShare && (
              <Button variant="primary" icon="share" onClick={() => void family.share(ref)}>
                लिंक भेजें
              </Button>
            )}
            <a
              className={`btn btn--lg ${canShare ? "btn--secondary" : "btn--primary"}`}
              href={whatsappShareUrl(p.text, p.url)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void say(SAY_FAMILY.openingWhatsapp)}
            >
              <Icon name="chat" size={28} />
              <span className="btn-label">WhatsApp पर भेजें</span>
            </a>
            <Button icon="copy" onClick={() => void family.copyLink()}>
              लिंक कॉपी करें
            </Button>
          </div>
          <label className="field">
            <span className="field-label">
              लिंक <span className="en" lang="en">(link for the family member)</span>
            </span>
            <input className="input share-link" readOnly value={p.url} onFocus={(e) => e.currentTarget.select()} />
          </label>
        </>
      )}

      {ref.status === "answered" && <FamilyAnswer c={ref} />}
      {ref.status === "expired" && <p>{SAY_FAMILY.expired(who)}</p>}

      <Button
        variant="ghost"
        icon="x"
        onClick={() => {
          family.dismiss();
          // The focused button disappears with the panel: put the screen reader back at the top of the screen.
          focusScreenTitle();
        }}
      >
        बंद करें
      </Button>
    </section>
  );
}

/** One answer from the family. Says whose opinion it is; never styled or worded as Nayan's own verdict. */
export function FamilyAnswer({ c }: { c: CaregiverCaseRef }) {
  const { family, state } = useApp();
  if (c.status !== "answered" || !c.answer) return null;
  const ok = c.answer === "correct";
  return (
    <div className={`family-answer family-answer--${c.answer}`}>
      <p className={`chip ${ok ? "chip--ok" : "chip--bad"}`}>
        <Icon name={ok ? "check" : "x"} size={22} />
        परिवार की राय: {ANSWER_HI[c.answer]}
      </p>
      <p className="family-answer-text">{caregiverAnswerText(c, { prescriptionSavedAt: state.prescription?.savedAt ?? null })}</p>
      {c.answerLine && <p className="muted">उन्होंने चुनी: {c.answerLine}</p>}
      <Button icon="speaker" size="md" onClick={() => family.replay(c)}>
        जवाब फिर से सुनें
      </Button>
    </div>
  );
}

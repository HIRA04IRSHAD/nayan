"use client";
// "परिवार": who to ask when Nayan is not sure, how it works, and the history of questions and answers.
// Answers are the family member's opinion: shown and spoken as theirs, never as Nayan's verdict, and they
// never assign a tactile tag (see components/app/useCaregiverCases.ts).

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CaregiverCaseRef } from "@/lib/types";
import { CASE_STATUS_HI, caregiverWho, RELATIONS, SAY_FAMILY } from "@/lib/caregiver-messages";
import { LIMITS } from "@/lib/case-schema";
import { updateNayan, withCaregiver } from "@/lib/store";
import { useApp } from "@/components/app/AppContext";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ScreenTitle } from "@/components/ui/ScreenTitle";
import { Notice } from "./common";
import { CaseSharePanel, FamilyAnswer } from "./FamilyCase";

export function FamilyScreen() {
  const { state, goTo } = useApp();
  return (
    <div className="stack">
      <ScreenTitle sub="जब नयन पक्का न हो, एक टैप में परिवार वाले से पूछिए।">परिवार</ScreenTitle>

      <CaseSharePanel />
      <CaregiverSetup />

      <CaseHistory cases={state.cases} />

      <details className="disclosure">
        <summary>यह कैसे काम करता है</summary>
        <div className="disclosure-body">
          <ol className="numbered">
            <li>“जाँचें” में पत्ते की फ़ोटो लीजिए।</li>
            <li>नतीजे के नीचे “परिवार से पूछें” दबाइए। एक लिंक बनेगा।</li>
            <li>लिंक WhatsApp से परिवार वाले को भेजिए। वे फ़ोटो और पर्चा देखकर “सही है” या “गलत है” दबाएँगे।</li>
            <li>जवाब आते ही नयन बोलकर बताएगा। लिंक 48 घंटे चलता है।</li>
          </ol>
          <Button icon="scan" onClick={() => goTo("check")}>
            जाँचें पर जाएँ
          </Button>
        </div>
      </details>

      <Notice title="परिवार का जवाब उनकी राय है">
        <p>नयन इसे अपनी जाँच नहीं मानता, और इससे कोई टैग नहीं लगता। टैग सिर्फ़ तब लगता है जब नयन खुद पर्चे से मिलान कर ले।</p>
      </Notice>
    </div>
  );
}

/** Name + relation of the family member, saved on the phone (store.caregiver). */
function CaregiverSetup() {
  const { state, say } = useApp();
  const caregiver = state.caregiver;
  const [editing, setEditing] = useState(!caregiver);
  const [name, setName] = useState(caregiver?.name ?? "");
  const [relation, setRelation] = useState(caregiver?.relation ?? "");
  const [error, setError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  // Saving or cancelling removes the form (and the focused button): keep focus on this card's heading,
  // and opening the form puts it on the name field.
  // Compared with the previous value (not a "first render" flag) so StrictMode's double effect run is harmless.
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    if (editing) nameRef.current?.focus();
    else document.getElementById(`${ids}-h`)?.focus();
  }, [editing, ids]);

  function save(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setError(true);
      say(SAY_FAMILY.nameNeeded);
      nameRef.current?.focus();
      return;
    }
    const next = { name: n, relation: relation.trim() };
    updateNayan((s) => withCaregiver(s, next));
    setError(false);
    setEditing(false);
    say(SAY_FAMILY.caregiverSaved(caregiverWho(next)));
  }

  function remove() {
    updateNayan((s) => withCaregiver(s, null));
    setName("");
    setRelation("");
    setEditing(true);
    say(SAY_FAMILY.caregiverRemoved);
  }

  if (caregiver && !editing) {
    return (
      <section className="card" aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`} tabIndex={-1}>
          किससे पूछें
        </h2>
        <p className="caregiver-who">
          <Icon name="family" size={30} />
          {caregiverWho(caregiver)}
        </p>
        <div className="segmented">
          <Button icon="edit" onClick={() => setEditing(true)}>
            बदलें
          </Button>
          <Button variant="ghost" icon="x" onClick={remove}>
            हटाएँ
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby={`${ids}-h`}>
      <h2 id={`${ids}-h`} tabIndex={-1}>
        किससे पूछें
      </h2>
      <p className="muted">
        जिस पर आप भरोसा करते हैं, जैसे बेटा या बेटी। उनका नाम सिर्फ़ इस फ़ोन पर और उनके लिंक में रहता है।
      </p>
      <form className="form" onSubmit={save} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-name`}>
            नाम
          </label>
          <input
            id={`${ids}-name`}
            ref={nameRef}
            className="input"
            value={name}
            maxLength={LIMITS.caregiverName}
            autoComplete="off"
            aria-invalid={error || undefined}
            aria-describedby={error ? `${ids}-err` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error && e.target.value.trim()) setError(false);
            }}
          />
          {error && (
            <span id={`${ids}-err`} className="field-error">
              <Icon name="alert" size={20} /> नाम लिखना ज़रूरी है
            </span>
          )}
        </div>
        <label className="field">
          <span className="field-label">रिश्ता</span>
          <select className="input" value={relation} onChange={(e) => setRelation(e.target.value)}>
            <option value="">रिश्ता चुनें (ज़रूरी नहीं)</option>
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            {relation && !(RELATIONS as readonly string[]).includes(relation) && <option value={relation}>{relation}</option>}
          </select>
        </label>
        <Button type="submit" variant="primary" icon="save">
          सेव करें
        </Button>
        {caregiver && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            रद्द करें
          </Button>
        )}
      </form>
    </section>
  );
}

const STATUS_ICON: Record<CaregiverCaseRef["status"], IconName> = { waiting: "clock", answered: "check", expired: "x" };

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("hi-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

/** Every question sent to the family, newest first, with its answer. */
function CaseHistory({ cases }: { cases: CaregiverCaseRef[] }) {
  const { family } = useApp();
  return (
    <section className="stack stack--tight" aria-labelledby="history-h">
      <h2 id="history-h">पूछे गए सवाल</h2>
      {cases.length === 0 ? (
        <p className="card card--quiet">{SAY_FAMILY.noCases}</p>
      ) : (
        <ul className="case-list">
          {cases.map((c) => {
            const answered = c.status === "answered" && !!c.answer;
            return (
              <li key={c.id} className="card case-row">
                <div className="case-top">
                  <p className="case-label">{c.itemLabel || "पत्ता"}</p>
                  <p className="muted case-meta">
                    {c.askedWho || "परिवार वाले"} · {when(c.createdAt)}
                  </p>
                </div>
                {answered ? (
                  <FamilyAnswer c={c} />
                ) : (
                  <p className={`chip ${c.status === "waiting" ? "chip--warn" : "chip--muted"}`}>
                    <Icon name={STATUS_ICON[c.status]} size={22} />
                    {CASE_STATUS_HI[c.status]}
                  </p>
                )}
                {c.status === "waiting" && (
                  <Button icon="share" size="md" onClick={() => void family.share(c)}>
                    लिंक फिर से भेजें
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

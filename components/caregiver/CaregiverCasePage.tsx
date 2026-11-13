"use client";
// The family member's side of "परिवार से पूछें". A sighted helper (Hindi first, small English hints) sees
// the strip photo, the prescription lines and what Nayan read, and answers with one big tap: सही है / गलत है.
// Their answer goes back to the patient's phone, which reads it aloud as the family member's opinion.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import type { CaseAnswer, CaseView } from "@/lib/case-schema";
import { CASE_ID_RE, LIMITS, tokenFromLocation } from "@/lib/case-schema";
import { fetchCase, fetchCasePhoto, sendAnswer } from "@/lib/case-client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

type Phase =
  | { k: "loading" }
  | { k: "bad_link" }
  | { k: "gone"; expired: boolean }
  | { k: "error" }
  | { k: "ready"; view: CaseView }
  | { k: "done"; view: CaseView; already: boolean };

const ANSWER_LABEL: Record<CaseAnswer, string> = { correct: "सही है", wrong: "गलत है" };

const until = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("hi-IN", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
};

export function CaregiverCasePage({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [token, setToken] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (t: string) => {
    setPhase({ k: "loading" });
    try {
      const r = await fetchCase(id, t);
      if (r.kind === "gone") setPhase({ k: "gone", expired: r.expired });
      else setPhase(r.view.status === "answered" ? { k: "done", view: r.view, already: true } : { k: "ready", view: r.view });
    } catch {
      setPhase({ k: "error" });
    }
  }, [id]);

  useEffect(() => {
    function start() {
      const t = tokenFromLocation(window.location.hash, window.location.search);
      if (!t || !CASE_ID_RE.test(id)) {
        setToken(null);
        setPhase({ k: "bad_link" });
        return;
      }
      setToken(t);
      void load(t);
    }
    start();
    // Pasting a corrected link into the same tab only changes the #fragment, which does not reload the page.
    window.addEventListener("hashchange", start);
    return () => window.removeEventListener("hashchange", start);
  }, [id, load]);

  // Each new state (loaded, answered, error) moves focus to its heading, so screen readers announce it.
  useEffect(() => {
    if (phase.k !== "loading") titleRef.current?.focus();
  }, [phase.k]);

  return (
    <div className="app">
      <main id="main" className="screen cg">
        <p className="cg-brand">
          <span className="orb" aria-hidden="true" />
          <span className="wordmark" lang="en">
            Nayan
          </span>
          <span aria-hidden="true">·</span> परिवार से सवाल
        </p>
        {phase.k === "loading" && (
          <p className="loading" role="status">
            खुल रहा है… <span className="en" lang="en">Loading…</span>
          </p>
        )}
        {phase.k === "bad_link" && (
          <Message titleRef={titleRef} icon="alert" title="यह लिंक अधूरा है" en="This link is incomplete. Please open the full link from the message.">
            लिंक पूरा कॉपी नहीं हुआ लगता है। संदेश में आया पूरा लिंक दोबारा खोलिए।
          </Message>
        )}
        {phase.k === "gone" && (
          <Message
            titleRef={titleRef}
            icon="clock"
            title={phase.expired ? "यह लिंक बंद हो गया है" : "यह लिंक नहीं चलता"}
            en={phase.expired ? "This link has expired (links work for 48 hours)." : "This link is not valid."}
          >
            {phase.expired
              ? "लिंक 48 घंटे ही चलता है। ज़रूरत हो तो परिवार वाले से दोबारा पूछने को कहिए।"
              : "लिंक गलत है या पूरा कॉपी नहीं हुआ। संदेश में आया पूरा लिंक खोलिए, या परिवार वाले से नया लिंक माँगिए।"}
          </Message>
        )}
        {phase.k === "error" && (
          <Message titleRef={titleRef} icon="alert" title="खुल नहीं सका" en="Could not load. Check the internet and try again.">
            इंटरनेट देखकर दोबारा कोशिश कीजिए।
            {token && (
              <Button variant="primary" icon="undo" onClick={() => void load(token)}>
                दोबारा कोशिश करें
              </Button>
            )}
          </Message>
        )}
        {phase.k === "ready" && token && (
          <AnswerForm
            view={phase.view}
            token={token}
            titleRef={titleRef}
            onDone={(view, already) => setPhase({ k: "done", view, already })}
            onGone={(expired) => setPhase({ k: "gone", expired })}
          />
        )}
        {phase.k === "done" && <Done view={phase.view} already={phase.already} titleRef={titleRef} />}
        <p className="disclaimer">नयन एक जाँच सहायक है, डॉक्टरी सलाह नहीं। शक हो तो डॉक्टर या केमिस्ट से पूछिए।</p>
      </main>
    </div>
  );
}

function Message({
  titleRef,
  icon,
  title,
  en,
  children,
}: {
  titleRef: Ref<HTMLHeadingElement>;
  icon: "alert" | "clock";
  title: string;
  en: string;
  children: ReactNode;
}) {
  return (
    <section className="card placeholder" aria-labelledby="cg-title">
      <span className="placeholder-icon">
        <Icon name={icon} size={40} />
      </span>
      <h1 id="cg-title" ref={titleRef} tabIndex={-1} className="screen-title">
        {title}
      </h1>
      <p>{children}</p>
      <p className="en" lang="en">
        {en}
      </p>
    </section>
  );
}

type PhotoState = { k: "loading" } | { k: "ready"; url: string } | { k: "failed" };

/**
 * The strip photo, fetched with the token in a request header and shown through a blob: URL. An <img src> could
 * only carry the token in the query string, which server and proxy access logs keep.
 */
function useCasePhoto(id: string, token: string): PhotoState {
  const [state, setState] = useState<PhotoState>({ k: "loading" });
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setState({ k: "loading" });
    fetchCasePhoto(id, token)
      .then((b) => {
        if (cancelled) return;
        if (b === "gone") return setState({ k: "failed" });
        url = URL.createObjectURL(b);
        setState({ k: "ready", url });
      })
      .catch(() => !cancelled && setState({ k: "failed" }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, token]);
  return state;
}

function AnswerForm({
  view,
  token,
  titleRef,
  onDone,
  onGone,
}: {
  view: CaseView;
  token: string;
  titleRef: Ref<HTMLHeadingElement>;
  onDone: (v: CaseView, already: boolean) => void;
  onGone: (expired: boolean) => void;
}) {
  const ids = useId();
  const [itemIndex, setItemIndex] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<CaseAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const photo = useCasePhoto(view.id, token);
  const name = view.caregiverName.trim();

  async function answer(a: CaseAnswer) {
    if (sending) return;
    setSending(a);
    setFailed(false);
    try {
      const r = await sendAnswer(view.id, { t: token, answer: a, itemIndex: a === "correct" ? itemIndex : null, note: note.trim() || undefined });
      if (r.kind === "gone") onGone(r.expired);
      else onDone(r.view, r.kind === "already");
    } catch {
      setFailed(true);
      setSending(null);
    }
  }

  return (
    <>
      <div className="screen-head">
        <h1 id="cg-title" ref={titleRef} tabIndex={-1} className="screen-title">
          क्या यह सही दवा है?
        </h1>
        <p className="screen-sub">
          {name ? `${name} जी, ` : ""}आपके परिवार वाले ने नयन ऐप से यह दवा जाँची और आपसे पूछा है। फ़ोटो को पर्चे से मिलाइए।
        </p>
        <p className="en" lang="en">
          Is this the right medicine? Compare the strip photo with the prescription below.
        </p>
      </div>

      <figure className="cg-photo">
        {photo.k === "ready" ? (
          <a href={photo.url} target="_blank" rel="noopener noreferrer">
            {/* A plain img: the photo is private and short-lived, there is nothing for next/image to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="दवा के पत्ते की फ़ोटो" />
          </a>
        ) : (
          <p className="loading" role="status">
            {photo.k === "loading" ? "फ़ोटो खुल रही है…" : "फ़ोटो नहीं खुल सकी। पेज दोबारा खोलिए।"}{" "}
            <span className="en" lang="en">
              {photo.k === "loading" ? "Loading photo…" : "Could not load the photo. Reload the page."}
            </span>
          </p>
        )}
        <figcaption className="muted">
          बड़ा देखने के लिए फ़ोटो पर टैप कीजिए। <span className="en" lang="en">Tap to open full size.</span>
        </figcaption>
      </figure>

      <section className="card" aria-labelledby={`${ids}-rx`}>
        <h2 id={`${ids}-rx`}>
          पर्चे की दवाएँ <span className="en cg-en" lang="en">Prescription</span>
        </h2>
        <ul className="cg-lines">
          {view.itemLines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="card card--quiet" aria-labelledby={`${ids}-read`}>
        <h2 id={`${ids}-read`}>
          नयन ने पत्ते पर पढ़ा <span className="en cg-en" lang="en">What Nayan read</span>
        </h2>
        <p>{view.whatNayanRead || "कुछ नहीं पढ़ा जा सका।"}</p>
        {view.verdictText && (
          <p className="muted">
            <strong>नयन ने कहा:</strong> {view.verdictText}
          </p>
        )}
      </section>

      <details className="disclosure">
        <summary>
          और बताना है? <span className="muted">(ज़रूरी नहीं)</span>
        </summary>
        <div className="disclosure-body">
          <fieldset className="choice-group">
            <legend className="field-label">अगर सही है, तो पर्चे की कौन सी दवा है?</legend>
            <label className="choice">
              <input type="radio" name={`${ids}-item`} checked={itemIndex === null} onChange={() => setItemIndex(null)} />
              <span>पता नहीं / बताना नहीं</span>
            </label>
            {view.itemLines.map((l, i) => (
              <label key={i} className="choice">
                <input type="radio" name={`${ids}-item`} checked={itemIndex === i} onChange={() => setItemIndex(i)} />
                <span>{l}</span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span className="field-label">
              कुछ लिखना हो तो <span className="en" lang="en">(optional note — it will be read aloud to them)</span>
            </span>
            <textarea className="input" rows={3} maxLength={LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </details>

      {failed && (
        <p className="notice notice--warn" role="alert">
          <Icon name="alert" size={26} className="notice-icon" />
          <span>जवाब नहीं भेजा जा सका। इंटरनेट देखकर फिर से दबाइए।</span>
        </p>
      )}

      <div className="cg-answer" role="group" aria-label="आपका जवाब">
        <Button variant="success" size="xl" icon="check" stacked aria-disabled={!!sending} onClick={() => void answer("correct")}>
          {sending === "correct" ? "भेजा जा रहा है…" : "सही है"}
          <span className="en cg-en" lang="en">
            Correct
          </span>
        </Button>
        <Button variant="danger" size="xl" icon="x" stacked aria-disabled={!!sending} onClick={() => void answer("wrong")}>
          {sending === "wrong" ? "भेजा जा रहा है…" : "गलत है"}
          <span className="en cg-en" lang="en">
            Wrong
          </span>
        </Button>
      </div>
      <p className="muted center">
        जवाब एक ही बार भेजा जा सकता है। यह लिंक {until(view.expiresAt)} तक चलेगा।
      </p>
    </>
  );
}

function Done({ view, already, titleRef }: { view: CaseView; already: boolean; titleRef: Ref<HTMLHeadingElement> }) {
  const ok = view.answer === "correct";
  return (
    <section className="card placeholder" aria-labelledby="cg-title">
      <span className={`placeholder-icon cg-done cg-done--${ok ? "ok" : "bad"}`}>
        <Icon name={ok ? "check" : "x"} size={44} />
      </span>
      <h1 id="cg-title" ref={titleRef} tabIndex={-1} className="screen-title">
        {already ? "इसका जवाब दिया जा चुका है" : "धन्यवाद!"}
      </h1>
      {view.answer && (
        <p className={`chip ${ok ? "chip--ok" : "chip--bad"}`}>
          <Icon name={ok ? "check" : "x"} size={22} />
          जवाब: {ANSWER_LABEL[view.answer]}
        </p>
      )}
      <p>
        {already
          ? "इस सवाल का जवाब पहले ही भेजा जा चुका है। जवाब एक ही बार दिया जा सकता है।"
          : "आपका जवाब भेज दिया गया। नयन यह जवाब उन्हें बोलकर सुना देगा।"}
      </p>
      {!ok && !already && <p>अगर दवा गलत है, तो उन्हें फ़ोन करके भी बता दीजिए।</p>}
      <p className="en" lang="en">
        {already ? "This question was already answered." : "Thank you — your answer was sent and will be read aloud to them."}
      </p>
    </section>
  );
}

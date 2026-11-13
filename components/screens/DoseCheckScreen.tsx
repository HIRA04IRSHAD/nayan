"use client";
// "खुराक जाँच (ब्लिस्टर)", full screen: 1. choose the medicine (the back of a strip often has no brand, so the
// user picks it, by tactile tag), 2. photograph the back of the strip, 3. a verdict-style result, spoken.
// Opened from the Check and Today screens with useApp().dose.start(); "वापस" returns to that tab.

import { useEffect, useRef, type Ref } from "react";
import type { PrescriptionItem } from "@/lib/types";
import { pillSchedule } from "@/lib/blister";
import { SAY_DOSE } from "@/lib/blister-messages";
import { SAY } from "@/lib/messages";
import { scheduleHi } from "@/lib/schedule";
import { useApp } from "@/components/app/AppContext";
import { DEMO_BLISTERS } from "@/components/app/useBlisterCheck";
import { Button } from "@/components/ui/Button";
import { ScreenTitle } from "@/components/ui/ScreenTitle";
import { NoTagIcon, TagIcon } from "@/components/ui/TagIcon";
import { Disclaimer, NoKeyNotice, Notice } from "./common";
import { DoseVerdictCard } from "./DoseVerdictCard";

export function DoseCheckScreen() {
  const { state, busy, noKey, say, dose, openBlisterCamera } = useApp();
  const items = state.prescription?.items ?? [];
  const item = items.find((i) => i.id === dose.itemId);
  const stepRef = useRef<HTMLHeadingElement>(null);

  // Choosing (or un-choosing) a medicine moves focus to the next step's heading. Not on first show: start()
  // already focuses the screen title.
  const lastItem = useRef(dose.itemId);
  useEffect(() => {
    if (lastItem.current === dose.itemId) return;
    lastItem.current = dose.itemId;
    stepRef.current?.focus();
  }, [dose.itemId]);

  const reading = busy === "blister";
  const result = reading ? null : dose.result;
  let label = "पत्ते के पीछे की फ़ोटो लीजिए";
  if (reading) label = "खाने गिने जा रहे हैं…";
  else if (result) label = "दोबारा फ़ोटो लीजिए";

  return (
    <div className="stack">
      <ScreenTitle sub={result ? undefined : "पत्ते के पीछे के खाली खाने गिनकर बताता है कि खुराक पहले ली गई या नहीं।"}>खुराक जाँच</ScreenTitle>

      {!item ? (
        <PickMedicine items={items} headRef={stepRef} />
      ) : (
        <>
          {result ? (
            <DoseVerdictCard outcome={result} onReplay={() => void say(result.text)} onMarkTaken={dose.markTaken} />
          ) : (
            <section className="card stack stack--tight" aria-labelledby="dose-photo-h">
              <h2 id="dose-photo-h" ref={stepRef} tabIndex={-1}>
                पत्ते के पीछे की फ़ोटो
              </h2>
              <ChosenMedicine item={item} />
            </section>
          )}

          <Button
            variant="primary"
            size="xl"
            icon="camera"
            stacked
            className={result ? "camera-btn camera-btn--compact" : "camera-btn"}
            aria-disabled={!!busy}
            whenUnavailable={() => void say(SAY.wait)}
            aria-describedby={result ? undefined : "blister-hint"}
            onClick={openBlisterCamera}
          >
            {label}
          </Button>
          {!result && (
            <p id="blister-hint" className="hint">
              पत्ते को पलटिए: जिस तरफ़ से गोली निकालते हैं, वह कैमरे की ओर हो। एक बार में एक ही पत्ता, पूरा फ़ोटो में आए।
            </p>
          )}

          <Button icon="pills" aria-disabled={!!busy} whenUnavailable={() => void say(SAY.wait)} onClick={dose.unpick}>
            दूसरी दवा चुनें
          </Button>

          {noKey && <NoKeyNotice />}
          <DemoBlisters open={noKey} />
        </>
      )}

      <Notice title="यह सिर्फ़ एक चेतावनी है">
        <p>
          गिनती फ़ोटो पर निर्भर है। कटे या फटे पत्ते, एक साथ कई पत्ते, या आधी गोली वाली खुराक की जाँच नहीं हो सकती। हर
          खुराक के बाद &quot;मैंने अभी ली&quot; दबाने से गिनती सही रहती है।
        </p>
        <p className="en" lang="en">
          A warning aid based on a photo count, not a pill tracker. It never advises extra doses.
        </p>
      </Notice>

      <Button variant="ghost" icon="undo" aria-disabled={!!busy} whenUnavailable={() => void say(SAY.wait)} onClick={dose.close}>
        वापस
      </Button>
      <Disclaimer />
    </div>
  );
}

/** Step 1: one big button per prescription line, with its tactile tag. Lines without a countable schedule say why. */
function PickMedicine({ items, headRef }: { items: PrescriptionItem[]; headRef: Ref<HTMLHeadingElement> }) {
  const { state, busy, say, dose } = useApp();
  return (
    <section className="stack stack--tight" aria-labelledby="dose-pick-h">
      <h2 id="dose-pick-h" ref={headRef} tabIndex={-1}>
        कौन-सी दवा?
      </h2>
      <p className="muted">पत्ते के पीछे अक्सर नाम नहीं होता, इसलिए पहले दवा चुनिए।</p>
      <ul className="pick-list">
        {items.map((it) => {
          const sched = pillSchedule(it.frequency, state.settings.slotTimes);
          const blocked = typeof sched === "string" ? sched : null;
          const saved = state.blisterBaselines[it.id];
          return (
            <li key={it.id}>
              <Button
                className="pick-btn"
                aria-disabled={!!blocked || !!busy}
                whenUnavailable={() => void say(blocked ? SAY_DOSE.cannotCheck(it, blocked) : SAY.wait)}
                onClick={() => dose.pick(it.id)}
              >
                <span className="pick-row">
                  {it.tag ? <TagIcon tag={it.tag} size={52} /> : <NoTagIcon size={52} />}
                  <span className="pick-text">
                    <span className="pick-name">{it.nameAsWritten}</span>
                    <span className="pick-detail">{scheduleHi(it.frequency, it.timing) || "समय तय नहीं"}</span>
                    {blocked ? (
                      <span className="pick-detail pick-detail--warn">इसकी खुराक जाँच नहीं हो सकती</span>
                    ) : saved ? (
                      <span className="pick-detail">
                        पिछली गिनती: {saved.totalPockets} में से {saved.emptyPockets} खाली
                      </span>
                    ) : null}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ChosenMedicine({ item }: { item: PrescriptionItem }) {
  const sched = scheduleHi(item.frequency, item.timing);
  return (
    <div className="verdict-item">
      {item.tag ? <TagIcon tag={item.tag} size={60} /> : <NoTagIcon size={60} />}
      <div className="verdict-item-body">
        <p className="overline">चुनी गई दवा</p>
        <p className="verdict-item-name">{item.nameAsWritten}</p>
        {sched && <p className="verdict-item-detail">{sched}</p>}
      </div>
    </div>
  );
}

/** Sample counts relative to what the rules expect now, for trying the flow without a camera or API key. */
function DemoBlisters({ open }: { open: boolean }) {
  const { dose, busy } = useApp();
  return (
    <details className="disclosure" open={open}>
      <summary>डेमो गिनती (बिना कैमरा)</summary>
      <div className="disclosure-body">
        <p className="muted">हर बटन एक नमूना गिनती जाँचता है। पहली बार की गिनती सेव होती है, उसके बाद तुलना होती है।</p>
        <div className="demo-grid">
          {DEMO_BLISTERS.map((d) => (
            <Button key={d.kind} size="md" aria-disabled={!!busy} onClick={() => dose.fromDemo(d.kind)}>
              {d.label}
            </Button>
          ))}
        </div>
      </div>
    </details>
  );
}

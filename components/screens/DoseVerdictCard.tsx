"use client";
// The result of one dose check, in the same visual language as the strip verdict (icon + coloured band +
// headline, never colour alone): exactly what was spoken, which medicine, the counts for a sighted helper,
// and "मैंने अभी ली" when the result allows it.

import { useEffect, useRef } from "react";
import type { BlisterOutcome } from "@/lib/blister";
import { blisterEnglish } from "@/lib/blister-messages";
import { scheduleHi, SLOT_HI } from "@/lib/schedule";
import type { DoseOutcome } from "@/components/app/useBlisterCheck";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { NoTagIcon, TagIcon } from "@/components/ui/TagIcon";

type Tone = "match" | "no_match" | "not_sure" | "info";

const OUTCOME: Record<BlisterOutcome, { tone: Tone; head: string; sub: string; icon: IconName }> = {
  ok_take_now: { tone: "match", head: "खुराक बाकी लगती है", sub: "गिनती के हिसाब से अभी नहीं ली गई", icon: "check" },
  ok: { tone: "match", head: "गिनती ठीक है", sub: "अभी कोई खुराक नहीं", icon: "check" },
  already_taken: { tone: "no_match", head: "पहले ही ले ली गई", sub: "दोबारा न लें", icon: "x" },
  extra_taken: { tone: "no_match", head: "ज़्यादा खाने खाली", sub: "और न लें, डॉक्टर से पूछें", icon: "alert" },
  missed: { tone: "not_sure", head: "खुराक छूटी लगती है", sub: "छूटी गोलियाँ एक साथ न लें", icon: "alert" },
  not_sure: { tone: "not_sure", head: "पक्का नहीं", sub: "दोबारा फ़ोटो लीजिए या किसी से पूछिए", icon: "question" },
  baseline_set: { tone: "info", head: "पहली गिनती सेव", sub: "अगली बार से जाँच होगी", icon: "save" },
  new_strip: { tone: "info", head: "नया पत्ता", sub: "गिनती नई शुरू हुई", icon: "layers" },
};

interface Props {
  outcome: DoseOutcome;
  onReplay: () => void;
  onMarkTaken: () => void;
}

export function DoseVerdictCard({ outcome, onReplay, onMarkTaken }: Props) {
  const headRef = useRef<HTMLHeadingElement>(null);
  const markedRef = useRef<HTMLParagraphElement>(null);
  const { r, item, itemIndex, marked } = outcome;
  // A new result takes focus, so a screen reader user can go straight on to its actions.
  useEffect(() => headRef.current?.focus(), [r]);
  // The button disappears once tapped; keep focus on its confirmation instead of losing it to the page.
  useEffect(() => {
    if (marked) markedRef.current?.focus();
  }, [marked]);

  const meta = OUTCOME[r.outcome];
  const sched = scheduleHi(item.frequency, item.timing);

  return (
    <article className={`verdict verdict--${meta.tone}`} aria-labelledby="dose-head">
      <div className="verdict-band">
        <span className="verdict-icon">
          <Icon name={meta.icon} size={52} />
        </span>
        <div>
          <h2 id="dose-head" ref={headRef} tabIndex={-1} className="verdict-head">
            {meta.head}
          </h2>
          <p className="verdict-sub">{meta.sub}</p>
        </div>
      </div>

      <div className="verdict-body">
        <p className="verdict-text">{outcome.text}</p>

        <div className="verdict-item">
          {item.tag ? <TagIcon tag={item.tag} size={60} /> : <NoTagIcon size={60} />}
          <div className="verdict-item-body">
            <p className="overline">पर्चे की दवा {itemIndex + 1}</p>
            <p className="verdict-item-name">{item.nameAsWritten}</p>
            {sched && <p className="verdict-item-detail">{sched}</p>}
          </div>
        </div>

        {r.observed && (
          <dl className="dose-facts">
            <div>
              <dt>खाली खाने</dt>
              <dd>
                {r.observed.empty} / {r.observed.total}
              </dd>
            </div>
            {r.expected != null && (
              <div>
                <dt>होने चाहिए</dt>
                <dd>{r.expected}</dd>
              </div>
            )}
            {r.current && (
              <div>
                <dt>अभी की खुराक</dt>
                <dd>{SLOT_HI[r.current.slot]}</dd>
              </div>
            )}
          </dl>
        )}

        {/* Codes for a sighted helper, kept out of the screen reader's swipe order (see VerdictCard). */}
        <details className="disclosure verdict-details">
          <summary>
            <span lang="en">Details for helper</span>
          </summary>
          <p className="disclosure-body en" lang="en">
            {blisterEnglish(r)}
          </p>
        </details>

        <div className="button-list">
          {r.canMarkTaken && !marked && (
            <Button variant="success" icon="check" onClick={onMarkTaken}>
              मैंने अभी ली
            </Button>
          )}
          {marked && r.current && (
            <p ref={markedRef} tabIndex={-1} className="chip chip--ok dose-marked">
              <Icon name="check" size={22} />
              {SLOT_HI[r.current.slot]} की खुराक दर्ज हो गई
            </p>
          )}
          <Button icon="speaker" onClick={onReplay}>
            फिर से सुनें
          </Button>
        </div>
      </div>
    </article>
  );
}

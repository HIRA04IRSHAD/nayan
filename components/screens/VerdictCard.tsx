"use client";
// The result of one strip check: icon + coloured band + headline (never colour alone), exactly what was
// spoken, which prescription line it is about (with its tactile tag), and what to do next.

import { useEffect, useRef } from "react";
import type { Verdict } from "@/lib/types";
import { composition, verdictEnglish } from "@/lib/messages";
import { scheduleHi } from "@/lib/schedule";
import { tagInfo } from "@/lib/tags";
import { cachedLookup } from "@/lib/client";
import { MAX_TRIES_BEFORE_CAREGIVER, type CheckOutcome } from "@/components/app/useStripCheck";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { NoTagIcon, TagIcon } from "@/components/ui/TagIcon";

const VERDICT: Record<Verdict, { head: string; sub: string; icon: IconName }> = {
  match: { head: "मेल खाती है", sub: "यह पर्चे वाली दवा है", icon: "check" },
  no_match: { head: "मेल नहीं खाती", sub: "यह दवा न लें", icon: "x" },
  not_sure: { head: "पक्का नहीं", sub: "दोबारा फ़ोटो लीजिए या किसी से पूछिए", icon: "question" },
};

interface Props {
  outcome: CheckOutcome;
  tries: number;
  onReplay: () => void;
  onNew: () => void;
  onAskFamily: () => void;
}

export function VerdictCard({ outcome, tries, onReplay, onNew, onAskFamily }: Props) {
  const headRef = useRef<HTMLHeadingElement>(null);
  // A new verdict takes focus, so a screen reader user can go straight on to its actions.
  useEffect(() => headRef.current?.focus(), [outcome]);

  const v = outcome.res.verdict;
  const meta = VERDICT[v];
  const { item, itemIndex, newTag } = outcome;
  const comp = item ? composition(item, cachedLookup) : null;
  const sched = item ? scheduleHi(item.frequency, item.timing) : "";

  return (
    <article className={`verdict verdict--${v}`} aria-labelledby="verdict-head">
      <div className="verdict-band">
        <span className="verdict-icon">
          <Icon name={meta.icon} size={52} />
        </span>
        <div>
          <h2 id="verdict-head" ref={headRef} tabIndex={-1} className="verdict-head">
            {meta.head}
          </h2>
          <p className="verdict-sub">{meta.sub}</p>
        </div>
      </div>

      <div className="verdict-body">
        <p className="verdict-text">{outcome.text}</p>

        {item && (
          <div className="verdict-item">
            {item.tag ? <TagIcon tag={item.tag} size={60} /> : <NoTagIcon size={60} />}
            <div className="verdict-item-body">
              <p className="overline">पर्चे की दवा {itemIndex + 1}</p>
              <p className="verdict-item-name">{item.nameAsWritten}</p>
              {comp && <p className="verdict-item-detail">{comp}</p>}
              {sched && <p className="verdict-item-detail">{sched}</p>}
              {newTag && (
                <p className="chip chip--accent">
                  नया टैग: {tagInfo(newTag).hi} — इसी डिब्बे पर लगाइए
                </p>
              )}
            </div>
          </div>
        )}

        {/* Machine codes for a sighted helper: behind a disclosure, so swiping through the verdict with a screen
            reader does not read English codes after the Hindi result. */}
        <details className="disclosure verdict-details">
          <summary>
            <span lang="en">Details for helper</span>
          </summary>
          <p className="disclosure-body en" lang="en">
            {verdictEnglish(outcome.res)}
          </p>
        </details>

        <div className="verdict-actions">
          <Button icon="speaker" onClick={onReplay}>
            फिर से सुनें
          </Button>
          <Button icon="scan" onClick={onNew}>
            नया पत्ता
          </Button>
          {/* Always offered (a family member can double-check any result); prominent when Nayan is not sure. */}
          <Button
            variant={v !== "not_sure" ? "ghost" : tries >= MAX_TRIES_BEFORE_CAREGIVER ? "primary" : "secondary"}
            size={v === "not_sure" ? "lg" : "md"}
            icon="family"
            onClick={onAskFamily}
          >
            परिवार से पूछें
          </Button>
        </div>
      </div>
    </article>
  );
}

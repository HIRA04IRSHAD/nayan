"use client";
// "नयन ने कहा": the last sentence Nayan spoke, always visible at the top, with a big replay button.
// The text is a polite live region, so screen readers also announce each new sentence.

import { useLayoutEffect, useRef, useState } from "react";
import { useApp } from "@/components/app/AppContext";
import { Icon } from "@/components/ui/Icon";

export function SaidBanner() {
  const { said, say } = useApp();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Long sentences are clamped to a few lines (the full text is still read by screen readers and usually
  // shown in the screen below too); offer "पूरा पढ़ें" only when the clamp actually hides something.
  useLayoutEffect(() => setExpanded(false), [said]);
  useLayoutEffect(() => {
    if (expanded) return; // measure only while clamped
    const el = textRef.current;
    setOverflows(!!el && el.scrollHeight > el.clientHeight + 2);
  }, [said, expanded]);

  return (
    <section className="said" aria-labelledby="said-label">
      <div className="said-top">
        <p id="said-label" className="said-label">
          <span className="said-logo" aria-hidden="true">
            <span className="orb" />
          </span>
          नयन ने कहा
        </p>
        <button type="button" className="said-replay" onClick={() => say(said)}>
          <Icon name="speaker" size={26} />
          <span>फिर से सुनें</span>
        </button>
      </div>
      <p ref={textRef} className={expanded ? "said-text" : "said-text said-text--clamped"} role="status" aria-live="polite" aria-atomic="true">
        {said}
      </p>
      {(overflows || expanded) && (
        <button type="button" className="said-more" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
          {expanded ? "छोटा करें" : "पूरा पढ़ें"}
        </button>
      )}
    </section>
  );
}

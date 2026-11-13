"use client";
// The daily screen: one giant camera button for the strip, then a full-width verdict.
// After "पक्का नहीं" the same button takes a second photo, and the two scans are combined by the rules.

import { useEffect, useRef } from "react";
import { useApp } from "@/components/app/AppContext";
import { useLookups } from "@/components/app/useLookups";
import { medCount, SAY } from "@/lib/messages";
import { DEMO_STRIPS } from "@/lib/fixtures";
import { Button } from "@/components/ui/Button";
import { ScreenTitle } from "@/components/ui/ScreenTitle";
import { Disclaimer, NoKeyNotice } from "./common";
import { DoseCheckEntry } from "./DoseCheckEntry";
import { VerdictCard } from "./VerdictCard";
import { CaseSharePanel } from "./FamilyCase";

export function CheckScreen() {
  const { state, busy, noKey, openStripCamera, check, family, say, focusScreenTitle } = useApp();
  const items = state.prescription?.items ?? [];
  useLookups(items.map((i) => i.nameAsWritten));

  // A new verdict (or "नया पत्ता") closes the share panel of the previous strip, so it is never read as being
  // about the new one. The case itself stays in the "परिवार" tab and its answer is still spoken.
  const lastResult = useRef(check.result);
  useEffect(() => {
    if (lastResult.current === check.result) return;
    lastResult.current = check.result;
    family.dismiss();
  });

  const reading = busy === "strip";
  const result = reading ? null : check.result;
  let label = "दवा का पत्ता जाँचिए";
  if (reading) label = "पत्ता पढ़ा जा रहा है…";
  else if (result) label = result.res.verdict === "not_sure" ? "दोबारा फ़ोटो लीजिए" : "अगला पत्ता जाँचिए";

  return (
    <div className="stack">
      <ScreenTitle sub={result ? undefined : `आपके पर्चे में ${medCount(items.length)}। हर पत्ता एक-एक करके जाँचिए।`}>दवा जाँचिए</ScreenTitle>

      {result && (
        <VerdictCard
          outcome={result}
          tries={check.tries}
          onReplay={() => say(result.text)}
          onNew={() => {
            // The verdict card (with the focused button) unmounts: say so and put focus back at the screen title.
            check.reset();
            focusScreenTitle();
            void say(SAY.readyForNextStrip);
          }}
          onAskFamily={() => void family.ask(result)}
        />
      )}
      <CaseSharePanel />

      <Button
        variant="primary"
        size="xl"
        icon="camera"
        stacked
        className={result ? "camera-btn camera-btn--compact" : "camera-btn"}
        aria-disabled={!!busy}
        whenUnavailable={() => say(SAY.wait)}
        aria-describedby={result ? undefined : "strip-hint"}
        onClick={openStripCamera}
      >
        {label}
      </Button>
      {!result && (
        <p id="strip-hint" className="hint">
          पत्ते को रोशनी में, सीधा और पास रखिए। जिस तरफ़ दवा का नाम और EXP लिखा है, वह कैमरे की ओर हो।
        </p>
      )}

      <DoseCheckEntry />

      {noKey && <NoKeyNotice />}
      <DemoStrips open={noKey} />
      <Disclaimer />
    </div>
  );
}

/** Sample strips covering every verdict, for trying Nayan without a camera or API key. */
function DemoStrips({ open }: { open: boolean }) {
  const { check, busy } = useApp();
  return (
    <details className="disclosure" open={open}>
      <summary>डेमो पत्ते (बिना कैमरा)</summary>
      <div className="disclosure-body">
        <p className="muted">हर बटन एक नमूना पत्ता जाँचता है, ताकि हर तरह का नतीजा देखा जा सके।</p>
        <div className="demo-grid">
          {DEMO_STRIPS.map((d) => (
            <Button key={d.label} size="md" aria-disabled={!!busy} onClick={() => void check.fromDemo(d.reading, d.label)}>
              {d.label}
            </Button>
          ))}
        </div>
      </div>
    </details>
  );
}

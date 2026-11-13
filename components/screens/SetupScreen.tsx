"use client";
// First run (no saved prescription): one big button to photograph the prescription, three tips, and a demo.

import { SAY } from "@/lib/messages";
import { useApp } from "@/components/app/AppContext";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ScreenTitle } from "@/components/ui/ScreenTitle";
import { AboutLink, Disclaimer, NoKeyNotice } from "./common";

const STEPS = ["पर्चे की फ़ोटो", "हर दवा की पुष्टि", "पत्ता जाँचें, टैग लगाएँ"];

export function SetupScreen() {
  const { busy, noKey, openPrescriptionCamera, rx, say } = useApp();
  return (
    <div className="stack">
      {/* Compact hero: the camera button must be visible without scrolling on a 360×640 phone. */}
      <section className="hero">
        <div className="hero-logo" aria-hidden="true">
          <span className="orb orb--lg" />
        </div>
        <ScreenTitle sub="पर्चे से दवा मिलाइए — एक बार जाँचिए, फिर छूकर पहचानिए।">नमस्ते, मैं नयन हूँ</ScreenTitle>
      </section>

      <Button
        variant="primary"
        size="xl"
        icon="camera"
        stacked
        className="btn--hero"
        aria-disabled={!!busy}
        whenUnavailable={() => say(SAY.wait)}
        aria-describedby="rx-tips"
        onClick={openPrescriptionCamera}
      >
        पर्चे की फ़ोटो लीजिए
      </Button>

      <ol className="how-steps" aria-label="कैसे काम करता है">
        {STEPS.map((s, i) => (
          <li key={s} className={i === 0 ? "how-step how-step--now" : "how-step"}>
            <span className="how-step-num" aria-hidden="true">
              {i + 1}
            </span>
            <span>
              {s}
              {i === 0 && <span className="visually-hidden"> (अभी यह कदम)</span>}
            </span>
          </li>
        ))}
      </ol>

      <section className="card" aria-labelledby="rx-tips-h">
        <h2 id="rx-tips-h">अच्छी फ़ोटो के लिए</h2>
        <ul className="tips" id="rx-tips">
          <li>
            <Icon name="sun" />
            <span>पर्चा रोशनी में रखिए, उस पर परछाईं न पड़े।</span>
          </li>
          <li>
            <Icon name="layers" />
            <span>समतल जगह पर रखिए और फ़ोन को ऊपर से सीधा पकड़िए।</span>
          </li>
          <li>
            <Icon name="scan" />
            <span>पूरा पर्चा फ़्रेम में आए — दवाओं वाला हिस्सा कटे नहीं।</span>
          </li>
        </ul>
      </section>

      {noKey && <NoKeyNotice />}

      <section className="card card--quiet" aria-labelledby="demo-rx-h">
        <h2 id="demo-rx-h">बिना कैमरे के आज़माइए</h2>
        <p className="muted">नमूना पर्चा: Dolo 650, Pan 40, Telma 40</p>
        <Button icon="play" aria-disabled={!!busy} onClick={rx.startDemo}>
          डेमो पर्चा खोलें
        </Button>
      </section>

      <Disclaimer />
      <AboutLink />
    </div>
  );
}

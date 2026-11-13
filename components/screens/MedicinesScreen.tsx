"use client";
// "मेरी दवाएँ": the saved prescription with each medicine's tactile tag, read-all-aloud, a new prescription,
// the demo, and the colour theme.

import type { PrescriptionItem } from "@/lib/types";
import { composition, describeItem, medCount, SAY } from "@/lib/messages";
import { scheduleHi } from "@/lib/schedule";
import { tagInfo } from "@/lib/tags";
import { cachedLookup } from "@/lib/client";
import { updateNayan, withSettings, withTheme } from "@/lib/store";
import { useApp } from "@/components/app/AppContext";
import { useLookups } from "@/components/app/useLookups";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { NoTagIcon, TagIcon } from "@/components/ui/TagIcon";
import { ScreenTitle } from "@/components/ui/ScreenTitle";
import { AboutLink, Disclaimer, NoKeyNotice } from "./common";

const savedOn = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("hi-IN", { day: "numeric", month: "long", year: "numeric" });
};

export function MedicinesScreen() {
  const { state, say, busy, noKey, rx, openPrescriptionCamera } = useApp();
  const p = state.prescription;
  const theme = state.settings.theme;
  const voice = state.settings.voiceOn;
  useLookups(p ? p.items.map((i) => i.nameAsWritten) : []);

  function readAll() {
    if (p) say(SAY.medicineList(p.items.map((i, n) => describeItem(i, n, cachedLookup))));
  }

  // Nothing is cleared here: the saved prescription, its tags and the blister counts stay until the new draft is
  // saved in the review (withPrescription replaces them then). A cancelled camera, a failed read (offline, quota)
  // or "रद्द करें" in the review leaves everything as it was, so no confirmation dialog is needed.
  function newPrescription() {
    say(SAY.newPrescription);
    openPrescriptionCamera();
  }

  function setTheme(t: typeof theme) {
    updateNayan((s) => withTheme(s, t));
    say(SAY.theme[t]);
  }

  function setVoice(on: boolean) {
    // say() reads the saved setting at call time, so the confirmation already follows the new choice.
    updateNayan((s) => withSettings(s, { voiceOn: on }));
    say(on ? SAY.voice.on : SAY.voice.off);
  }

  const date = p ? savedOn(p.savedAt) : null;

  return (
    <div className="stack">
      <ScreenTitle sub={p ? `${medCount(p.items.length)}${date ? ` · पर्चा ${date} को सेव हुआ` : ""}` : "अभी कोई पर्चा सेव नहीं है।"}>
        मेरी दवाएँ
      </ScreenTitle>

      {p ? (
        <>
          <Button variant="primary" icon="speaker" onClick={readAll}>
            सारी दवाएँ सुनें
          </Button>
          <ul className="med-list">
            {p.items.map((item, n) => (
              <MedRow key={item.id} item={item} index={n} onSpeak={() => say(describeItem(item, n, cachedLookup))} />
            ))}
          </ul>
          {p.items.some((i) => !i.tag) && (
            <p className="hint">
              <Icon name="hand" size={22} /> जिस दवा पर टैग नहीं है, “जाँचें” में उसका पत्ता जाँचिए — सही होने पर नयन टैग बताएगा।
            </p>
          )}
        </>
      ) : (
        <Button variant="primary" size="xl" icon="camera" stacked aria-disabled={!!busy} whenUnavailable={() => say(SAY.wait)} onClick={openPrescriptionCamera}>
          पर्चे की फ़ोटो लीजिए
        </Button>
      )}

      {noKey && <NoKeyNotice />}

      <section className="card" aria-labelledby="rx-actions-h">
        <h2 id="rx-actions-h">पर्चा</h2>
        <div className="button-list">
          {p && (
            <Button icon="doc" aria-disabled={!!busy} onClick={newPrescription}>
              नया पर्चा
            </Button>
          )}
          <Button icon="play" aria-disabled={!!busy} onClick={rx.startDemo}>
            डेमो पर्चा (Dolo 650, Pan 40, Telma 40)
          </Button>
        </div>
      </section>

      <section className="card" aria-labelledby="theme-h">
        <h2 id="theme-h">रंग</h2>
        <p className="muted">कम रोशनी में गहरा, धूप में हल्का रंग पढ़ने में आसान रहता है।</p>
        <div className="segmented" role="group" aria-labelledby="theme-h">
          <Button icon="moon" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
            गहरा
          </Button>
          <Button icon="sun" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
            हल्का
          </Button>
        </div>
      </section>

      <section className="card" aria-labelledby="voice-h">
        <h2 id="voice-h">नयन की आवाज़</h2>
        <p className="muted">
          TalkBack या VoiceOver चलाते हैं? आवाज़ बंद करने पर नयन की बातें सिर्फ़ स्क्रीन रीडर पढ़ेगा, दो आवाज़ें एक साथ नहीं आएँगी।{" "}
          <span className="en" lang="en">
            (Turn off for screen-reader users.)
          </span>
        </p>
        <div className="segmented" role="group" aria-labelledby="voice-h">
          <Button icon="speaker" aria-pressed={voice} onClick={() => setVoice(true)}>
            चालू
          </Button>
          <Button icon="x" aria-pressed={!voice} onClick={() => setVoice(false)}>
            बंद
          </Button>
        </div>
      </section>

      <Disclaimer />
      <AboutLink />
    </div>
  );
}

function MedRow({ item, index, onSpeak }: { item: PrescriptionItem; index: number; onSpeak: () => void }) {
  const comp = composition(item, cachedLookup);
  const sched = scheduleHi(item.frequency, item.timing);
  return (
    <li className="med-row">
      <div className="med-tag">
        {item.tag ? <TagIcon tag={item.tag} size={60} decorative /> : <NoTagIcon size={60} />}
        <span className="med-tag-name">{item.tag ? tagInfo(item.tag).hi : "टैग नहीं"}</span>
      </div>
      <div className="med-body">
        <p className="med-name">
          <span className="med-num" aria-hidden="true">
            {index + 1}
          </span>
          {item.nameAsWritten}
        </p>
        <p className="med-detail">{comp ?? "यह दवा सूची में नहीं मिली"}</p>
        {(sched || item.durationDays) && (
          <p className="med-detail med-detail--sched">
            <Icon name="clock" size={18} />
            {[sched, item.durationDays ? `${item.durationDays} दिन` : ""].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <button type="button" className="icon-btn" aria-label={`${item.nameAsWritten} सुनें`} onClick={onSpeak}>
        <Icon name="speaker" size={26} />
      </button>
    </li>
  );
}

"use client";
// Settings for the dose reminders (on the "आज" screen): reminders on/off, permission for system notifications,
// and the four slot times. Says plainly that reminders only work while the app is open.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { SLOTS, type Slot } from "@/lib/types";
import { SLOT_HI } from "@/lib/schedule";
import { validateSlotTimes, type SlotTimeError } from "@/lib/today";
import { SAY_TODAY } from "@/lib/today-messages";
import { DEFAULT_SLOT_TIMES, getNayanState, updateNayan, withSettings, withSlotTimes } from "@/lib/store";
import { useApp } from "@/components/app/AppContext";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "./common";

export function ReminderSettings() {
  const { state, say, reminders } = useApp();
  const on = state.settings.remindersOn;

  function setOn(next: boolean) {
    updateNayan((s) => withSettings(s, { remindersOn: next }));
    if (next) reminders.enabled(SAY_TODAY.remindersOn);
    else void say(SAY_TODAY.remindersOff);
  }

  return (
    <>
      <section className="card" aria-labelledby="reminders-h">
        <h2 id="reminders-h">याद दिलाना</h2>
        <p className="muted">दवा के समय नयन बोलकर बताएगा कि कौन-सी दवा लेनी है, और ऊपर एक सूचना दिखाएगा।</p>
        <div className="segmented" role="group" aria-labelledby="reminders-h">
          <Button icon="bell" aria-pressed={on} onClick={() => setOn(true)}>
            चालू
          </Button>
          <Button icon="bellOff" aria-pressed={!on} onClick={() => setOn(false)}>
            बंद
          </Button>
        </div>
        <NotificationPermission />
        <Notice tone="info" title="नयन बंद हो तो याद नहीं दिला सकता">
          <p>
            याद दिलाना तभी काम करता है जब नयन खुला हो। ऐप बंद होने पर, या फ़ोन के ऐप को रोक देने पर, याद दिलाने के लिए
            सर्वर से पुश सूचना चाहिए, जो अभी नहीं है। ज़रूरी दवाओं के लिए फ़ोन का अलार्म भी लगाइए।
          </p>
          <p className="en" lang="en">
            Reminders work only while Nayan is open. Reminders with the app closed would need server push notifications,
            which are not built.
          </p>
        </Notice>
      </section>
      <SlotTimesForm />
    </>
  );
}

function NotificationPermission() {
  const { reminders, say } = useApp();
  const p = reminders.permission;

  async function ask() {
    const answer = await reminders.requestPermission();
    void say(answer === "granted" ? SAY_TODAY.notifyGranted : answer === "unsupported" ? SAY_TODAY.notifyUnsupported : SAY_TODAY.notifyDenied);
  }

  if (p === "granted") {
    return (
      <p className="chip chip--ok">
        <Icon name="check" size={20} /> फ़ोन पर सूचना: चालू
      </p>
    );
  }
  if (p === "default") {
    return (
      <div className="stack stack--tight">
        <Button icon="bell" onClick={ask} aria-describedby="notify-hint">
          फ़ोन पर सूचना भी दिखाएँ
        </Button>
        <p id="notify-hint" className="hint">
          ब्राउज़र अनुमति माँगेगा। तब नयन पीछे खुला हो, तब भी दवा के समय फ़ोन पर सूचना आएगी।
        </p>
      </div>
    );
  }
  return <p className="hint">{p === "denied" ? "फ़ोन पर सूचना बंद है। चाहें तो ब्राउज़र की सेटिंग में अनुमति दे सकते हैं।" : SAY_TODAY.notifyUnsupported}</p>;
}

function SlotTimesForm() {
  const { state, say } = useApp();
  const saved = state.settings.slotTimes;
  const [times, setTimes] = useState<Record<Slot, string>>({ ...saved });
  const [error, setError] = useState<SlotTimeError | null>(null);
  const ids = useId();
  const inputs = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});

  // Saved elsewhere (another tab, or a reset): show what is saved now.
  useEffect(() => {
    setTimes({ ...saved });
    setError(null);
  }, [saved]);

  function save(e: FormEvent) {
    e.preventDefault();
    const err = validateSlotTimes(times);
    setError(err);
    if (err) {
      inputs.current[err.slot]?.focus();
      void say(SAY_TODAY.timeError(err));
      return;
    }
    // withSlotTimes (not withSettings) so the blister counts made under the old times are dropped.
    const before = Object.keys(getNayanState().blisterBaselines).length;
    const after = Object.keys(updateNayan((s) => withSlotTimes(s, times)).blisterBaselines).length;
    void say(SAY_TODAY.timesSaved(times, after < before));
  }

  const errId = `${ids}-err`;
  return (
    <details className="disclosure">
      <summary>
        <Icon name="clock" size={26} />
        दवा का समय बदलें
      </summary>
      <form className="disclosure-body form" onSubmit={save} noValidate>
        <p className="muted">पर्चे में “1-0-1” का मतलब सुबह और रात है। ये खुराकें नीचे के समय पर मानी जाती हैं।</p>
        <div className="time-list">
          {SLOTS.map((s) => (
            <div key={s} className="time-row">
              <label className="field-label" htmlFor={`${ids}-${s}`}>
                {SLOT_HI[s]}
              </label>
              <input
                ref={(el) => {
                  inputs.current[s] = el;
                }}
                id={`${ids}-${s}`}
                className="input input--time"
                type="time"
                required
                value={times[s]}
                aria-invalid={error?.slot === s || undefined}
                aria-describedby={error?.slot === s ? errId : undefined}
                onChange={(e) => setTimes((t) => ({ ...t, [s]: e.target.value.slice(0, 5) }))}
              />
            </div>
          ))}
        </div>
        {error && (
          <p id={errId} className="field-error">
            <Icon name="alert" size={20} /> {SAY_TODAY.timeError(error)}
          </p>
        )}
        <Button type="submit" variant="primary" icon="save">
          समय सेव करें
        </Button>
        <Button
          variant="ghost"
          icon="undo"
          onClick={() => {
            setTimes({ ...DEFAULT_SLOT_TIMES });
            setError(null);
            void say(SAY_TODAY.defaultsFilled);
          }}
        >
          पहले जैसे समय (8, 2, 6, 9 बजे)
        </Button>
      </form>
    </details>
  );
}

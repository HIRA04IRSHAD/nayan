"use client";
// "आज": today's doses from the saved prescription (lib/today.ts), slot by slot, each medicine with its tactile
// tag and a status that is a word and an icon (never colour alone). "मैंने ली" appends store.doseLog (which also
// helps the blister check tell which dose is missing); a mistaken tap can be undone. Below: the dose check
// shortcut and the reminder settings. Works offline: everything here comes from what is saved on the phone.

import { useEffect, useMemo, useState } from "react";
import type { Slot } from "@/lib/types";
import { SLOT_HI, timingHi } from "@/lib/schedule";
import { tagInfo } from "@/lib/tags";
import { pillSchedule, localDate } from "@/lib/blister";
import { todayPlan, type DoseStatus, type ItemRef, type TodayDose, type TodaySlot } from "@/lib/today";
import { SAY_TODAY, todaySpeech } from "@/lib/today-messages";
import { SAY } from "@/lib/messages";
import { addDose, removeDose, updateNayan } from "@/lib/store";
import { useApp } from "@/components/app/AppContext";
import { useNow } from "@/components/app/useClock";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { NoTagIcon, TagIcon } from "@/components/ui/TagIcon";
import { ScreenTitle } from "@/components/ui/ScreenTitle";
import { Disclaimer, Notice } from "./common";
import { DoseCheckEntry } from "./DoseCheckEntry";
import { ReminderSettings } from "./ReminderSettings";

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const rowId = (slot: Slot, itemId: string) => `dose-${slot}-${itemId}`;

export function TodayScreen() {
  const { state, say, goTo } = useApp();
  const now = useNow(30_000);
  const p = state.prescription;
  const plan = useMemo(() => todayPlan(p, state.settings.slotTimes, state.doseLog, now), [p, state.settings.slotTimes, state.doseLog, now]);
  // After marking or undoing, the pressed button is replaced: keep the screen reader on the same row.
  const [focusRow, setFocusRow] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRow) return;
    document.getElementById(focusRow)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  const dateLabel = now.toLocaleDateString("hi-IN", { weekday: "long", day: "numeric", month: "long" });

  if (!p) {
    return (
      <div className="stack">
        <ScreenTitle sub={dateLabel}>आज की दवाएँ</ScreenTitle>
        <Notice title="अभी कोई पर्चा सेव नहीं है">
          <p>पर्चा सेव होने के बाद यहाँ हर खुराक का समय दिखेगा, और दवा लेने पर आप निशान लगा सकेंगे।</p>
        </Notice>
        <Button variant="primary" icon="camera" onClick={() => goTo("check")}>
          पर्चे की फ़ोटो लें
        </Button>
        <ReminderSettings />
      </div>
    );
  }

  function mark(d: TodayDose) {
    const date = plan.date;
    updateNayan((s) => addDose(s, { itemId: d.item.id, slot: d.slot, date, at: new Date().toISOString() }));
    setFocusRow(rowId(d.slot, d.item.id));
    void say(SAY_TODAY.marked(d.item, d.slot));
  }

  function unmark(d: TodayDose) {
    const date = plan.date;
    updateNayan((s) => removeDose(s, d.item.id, d.slot, date));
    setFocusRow(rowId(d.slot, d.item.id));
    void say(SAY_TODAY.unmarked(d.item, d.slot));
  }

  const next = plan.next;
  const remindersOn = state.settings.remindersOn;

  return (
    <div className="stack">
      <ScreenTitle sub={dateLabel}>आज की दवाएँ</ScreenTitle>

      <Button variant="primary" icon="speaker" onClick={() => void say(todaySpeech(plan))}>
        आज की दवाएँ सुनें
      </Button>

      <ul className="today-facts">
        {plan.slots
          .filter((s) => s.doses.some((d) => d.status === "now"))
          .map((s) => (
            <li key={s.slot}>
              <Icon name="bell" size={22} />
              अभी {SLOT_HI[s.slot]} की खुराक का समय
            </li>
          ))}
        {next && (
          <li>
            <Icon name="clock" size={22} />
            {SAY_TODAY.next(next.slot, hhmm(next.at), localDate(next.at) !== plan.date)}
          </li>
        )}
        <li>
          <Icon name={remindersOn ? "bell" : "bellOff"} size={22} />
          याद दिलाना: {remindersOn ? "चालू" : "बंद"}
        </li>
      </ul>

      {plan.slots.length === 0 && (
        <p className="card card--quiet">आज किसी दवा का तय समय नहीं है।</p>
      )}

      {plan.slots.map((slot) => (
        <SlotCard key={slot.slot} slot={slot} onMark={mark} onUnmark={unmark} />
      ))}

      {plan.asNeeded.length > 0 && (
        <ItemListCard id="sos-h" title="ज़रूरत पड़ने पर" note="इनका कोई तय समय नहीं है, इसलिए नयन इनकी याद नहीं दिलाता।" items={plan.asNeeded} />
      )}
      {plan.unscheduled.length > 0 && (
        <ItemListCard
          id="unsched-h"
          title="समय साफ़ नहीं"
          note="पर्चे से इन दवाओं का समय समझ नहीं आया। परिवार या केमिस्ट से पूछिए।"
          items={plan.unscheduled}
        />
      )}
      {plan.finished.length > 0 && (
        <ItemListCard
          id="done-h"
          title="दिन पूरे हुए"
          note="पर्चे में लिखे दिन पूरे हो गए, इसलिए ये आज की सूची में नहीं हैं। डॉक्टर ने आगे लेने को कहा हो तो नया पर्चा सेव कीजिए।"
          items={plan.finished}
          detail={(r) => {
            const f = plan.finished.find((x) => x.index === r.index);
            return f ? `आख़िरी दिन: ${new Date(`${f.lastDay}T12:00:00`).toLocaleDateString("hi-IN", { day: "numeric", month: "long" })}` : null;
          }}
        />
      )}

      <section className="card stack stack--tight" aria-labelledby="dose-check-h">
        <h2 id="dose-check-h">खुराक ली या नहीं?</h2>
        <DoseCheckEntry />
      </section>

      <ReminderSettings />
      <Disclaimer />
    </div>
  );
}

function SlotCard({ slot, onMark, onUnmark }: { slot: TodaySlot; onMark: (d: TodayDose) => void; onUnmark: (d: TodayDose) => void }) {
  const h = `slot-${slot.slot}-h`;
  const anyNow = slot.doses.some((d) => d.status === "now");
  const anyMissed = slot.doses.some((d) => d.status === "missed");
  return (
    <section className={anyNow ? "card dose-slot dose-slot--now" : "card dose-slot"} aria-labelledby={h}>
      <h2 id={h} className="dose-slot-head">
        <span>{SLOT_HI[slot.slot]}</span>
        <span className="dose-slot-time">{slot.time}</span>
      </h2>
      <ul className="dose-list">
        {slot.doses.map((d) => (
          <DoseRow key={d.item.id} d={d} onMark={onMark} onUnmark={onUnmark} />
        ))}
      </ul>
      {anyMissed && (
        <p className="hint">
          <Icon name="info" size={22} /> “दर्ज नहीं” का मतलब है कि निशान नहीं लगा। ली थी तो “मैंने ली थी” दबाइए। नहीं ली, तो उसे
          अगली खुराक के साथ न लें; डॉक्टर या केमिस्ट से पूछिए।
        </p>
      )}
    </section>
  );
}

const STATUS: Record<DoseStatus, { icon: IconName; chip: string; text: string }> = {
  upcoming: { icon: "clock", chip: "chip--muted", text: "बाद में" },
  now: { icon: "bell", chip: "chip--accent", text: "अभी लेने का समय" },
  done: { icon: "check", chip: "chip--ok", text: "ली गई" },
  missed: { icon: "alert", chip: "chip--warn", text: "दर्ज नहीं" },
};

function DoseRow({ d, onMark, onUnmark }: { d: TodayDose; onMark: (d: TodayDose) => void; onUnmark: (d: TodayDose) => void }) {
  const { state, busy, say, dose } = useApp();
  const st = STATUS[d.status];
  const who = (
    <span className="visually-hidden">
      : {d.item.nameAsWritten}, {SLOT_HI[d.slot]}
    </span>
  );
  const details = [
    d.item.tag ? `${tagInfo(d.item.tag).hi} टैग` : "टैग नहीं",
    d.tablets && d.tablets > 1 ? `${d.tablets} ${d.item.form === "capsule" ? "कैप्सूल" : "गोलियाँ"}` : null,
    timingHi(d.item.timing),
  ].filter(Boolean);
  const countable = typeof pillSchedule(d.item.frequency, state.settings.slotTimes) !== "string";
  const taken = d.takenAt ? new Date(d.takenAt) : null;

  return (
    <li id={rowId(d.slot, d.item.id)} tabIndex={-1} className={`dose-row dose-row--${d.status}`}>
      <div className="dose-main">
        {d.item.tag ? <TagIcon tag={d.item.tag} size={52} /> : <NoTagIcon size={52} />}
        <div className="dose-body">
          <p className="dose-name">{d.item.nameAsWritten}</p>
          <p className="dose-detail">{details.join(" · ")}</p>
          <p className={`chip ${st.chip}`}>
            <Icon name={st.icon} size={20} />
            {st.text}
            {d.status === "done" && taken && !isNaN(taken.getTime()) ? ` (${hhmm(taken)})` : ""}
          </p>
        </div>
      </div>
      {d.status === "now" && (
        <div className="dose-actions">
          <Button variant="success" icon="check" onClick={() => onMark(d)}>
            मैंने ली{who}
          </Button>
          {countable && (
            <Button variant="ghost" size="md" icon="blister" aria-disabled={!!busy} whenUnavailable={() => void say(SAY.wait)} onClick={() => dose.start(d.item.id)}>
              पत्ता गिनकर जाँचें{who}
            </Button>
          )}
        </div>
      )}
      {d.status === "missed" && (
        <div className="dose-actions">
          <Button icon="check" onClick={() => onMark(d)}>
            मैंने ली थी{who}
          </Button>
        </div>
      )}
      {d.status === "done" && (
        <div className="dose-actions">
          <Button variant="ghost" size="md" icon="undo" onClick={() => onUnmark(d)}>
            गलती से दबाया? निशान हटाएँ{who}
          </Button>
        </div>
      )}
    </li>
  );
}

function ItemListCard({
  id,
  title,
  note,
  items,
  detail,
}: {
  id: string;
  title: string;
  note: string;
  items: ItemRef[];
  detail?: (r: ItemRef) => string | null;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="muted">{note}</p>
      <ul className="dose-list">
        {items.map((r) => (
          <li key={r.item.id} className="dose-row">
            <div className="dose-main">
              {r.item.tag ? <TagIcon tag={r.item.tag} size={44} /> : <NoTagIcon size={44} />}
              <div className="dose-body">
                <p className="dose-name">{r.item.nameAsWritten}</p>
                <p className="dose-detail">
                  {[r.item.tag ? `${tagInfo(r.item.tag).hi} टैग` : "टैग नहीं", timingHi(r.item.timing), detail?.(r)].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

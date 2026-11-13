"use client";
// In-app reminder at a dose time (components/app/useReminders.ts): which medicines, with their tag drawings,
// and a way to the Today list to mark them. The spoken reminder already went through the "नयन ने कहा" live
// region, so this box is not a live region itself (it would be announced twice) and does not take focus.

import { dueNow } from "@/lib/today";
import { SLOT_HI } from "@/lib/schedule";
import { tagInfo } from "@/lib/tags";
import { useApp } from "@/components/app/AppContext";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { NoTagIcon, TagIcon } from "@/components/ui/TagIcon";

export function ReminderBanner() {
  const { reminders, tab, goTo, rx, dose } = useApp();
  const slot = reminders.banner;
  if (!slot) return null;
  const due = dueNow(slot);
  // Inside a full-screen flow (review, dose check) the tabs are hidden: finish that first.
  const canOpenToday = tab !== "today" && !rx.draft && !dose.active;
  return (
    <section className="reminder" aria-labelledby="reminder-title">
      <p id="reminder-title" className="reminder-title">
        <Icon name="bell" size={28} />
        <span>
          दवा का समय: {SLOT_HI[slot.slot]} <span className="reminder-time">{slot.time}</span>
        </span>
      </p>
      <ul className="reminder-meds">
        {due.map((d) => (
          <li key={d.item.id}>
            {d.item.tag ? <TagIcon tag={d.item.tag} size={36} decorative /> : <NoTagIcon size={36} />}
            <span>
              {d.item.nameAsWritten}
              {d.item.tag && <span className="muted"> · {tagInfo(d.item.tag).hi}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="reminder-note">अगर पहले ही ले ली है, तो दोबारा न लें।</p>
      <div className="reminder-actions">
        {canOpenToday && (
          <Button variant="primary" icon="calendar" onClick={() => goTo("today")}>
            आज की सूची खोलें
          </Button>
        )}
        <Button variant="ghost" icon="x" onClick={reminders.dismiss}>
          बंद करें
        </Button>
      </div>
    </section>
  );
}

"use client";
// Dose reminders while the app is open. Every CHECK_MS (and when the page becomes visible again) the Today plan
// (lib/today.ts) is worked out; when a dose time has come, Nayan speaks a fixed template naming the medicines
// by tag (lib/today-messages.ts), shows an in-app banner, and, if the user allowed it, a system notification.
// Each slot is announced once per day (store.remindersFired), even across reloads and two open tabs.
//
// Honest limit: this runs only while the page is alive. A closed app (or a phone that froze the tab) gets no
// reminder; that needs push notifications sent from a server, which Nayan does not have.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NayanState } from "@/lib/types";
import { dueNow, reminderDue, reminderKey, todayPlan, type TodaySlot } from "@/lib/today";
import { REMINDER_TITLE, reminderText } from "@/lib/today-messages";
import { getNayanState, updateNayan, withReminderFired } from "@/lib/store";
import { notificationPermission, requestNotificationPermission, showSystemNotification, type NotifyPermission } from "@/lib/pwa";
import { useNow } from "./useClock";

/** How often the clock is checked. A reminder comes at most this late. */
export const CHECK_MS = 30_000;

export interface Reminders {
  /** The dose time shown in the in-app banner, while something in it is still due and unmarked. */
  banner: TodaySlot | null;
  dismiss: () => void;
  permission: NotifyPermission;
  /** Ask for system-notification permission (from a tap). Resolves with the answer. */
  requestPermission: () => Promise<NotifyPermission>;
  /** Call right after switching reminders on: speaks the confirmation, followed by a reminder that is due now. */
  enabled: (confirmation: string) => void;
}

interface Deps {
  state: NayanState;
  /** For the reminder spoken inside the user's own tap (switching reminders on). */
  say: (text: string) => Promise<void>;
  /**
   * For reminders that come due on their own: queued until no photo is being read, nothing is being spoken and
   * the microphone is closed, so a reminder never cuts off a verdict (see lib/announce.ts).
   */
  announce: (text: string) => void;
  focusScreenTitle: () => void;
}

export function useReminders({ state, say, announce, focusScreenTitle }: Deps): Reminders {
  const now = useNow(CHECK_MS);
  const [bannerKey, setBannerKey] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>("unsupported");
  const on = state.settings.remindersOn && !!state.prescription;

  // Read in the browser after mount (the server has no Notification API).
  useEffect(() => setPermission(notificationPermission()), []);

  /** Give the due reminder, if any. `prefix` is spoken first (or alone when nothing is due). */
  const check = useCallback(
    (prefix = "") => {
      // Fresh state and clock, not the render's: a dose may have been marked (or a reminder given in another tab).
      const s = getNayanState();
      const at = new Date();
      const plan = todayPlan(s.prescription, s.settings.slotTimes, s.doseLog, at);
      const due = s.settings.remindersOn ? reminderDue(plan, at, s.remindersFired) : null;
      if (!due) {
        if (prefix) void say(prefix);
        return;
      }
      const key = reminderKey(plan.date, due.slot);
      // Saved before speaking, so a second run of the effect (or another tab) sees it and stays quiet.
      updateNayan((st) => withReminderFired(st, key));
      setBannerKey(key);
      const text = reminderText(due);
      if (prefix) void say(`${prefix} ${text}`);
      else announce(text);
      void showSystemNotification(REMINDER_TITLE, text, `nayan-${key}`);
    },
    [say, announce],
  );

  useEffect(() => {
    if (on) check();
  }, [on, now, check]);

  // The banner follows the live plan: it disappears once every due dose is marked or the window has passed.
  const banner = useMemo(() => {
    if (!on || !bannerKey) return null;
    const plan = todayPlan(state.prescription, state.settings.slotTimes, state.doseLog, now);
    const slot = plan.slots.find((s) => reminderKey(plan.date, s.slot) === bannerKey);
    return slot && dueNow(slot).length ? slot : null;
  }, [on, bannerKey, state.prescription, state.settings.slotTimes, state.doseLog, now]);

  const dismiss = useCallback(() => {
    setBannerKey(null);
    // The focused "बंद करें" button is gone: put the screen reader back at the top of the screen.
    focusScreenTitle();
  }, [focusScreenTitle]);

  const requestPermission = useCallback(async () => {
    const p = await requestNotificationPermission();
    setPermission(p);
    return p;
  }, []);

  // Turning reminders on during a dose time: one sentence ("चालू… <reminder>") instead of the reminder cutting
  // off the confirmation. Runs inside the tap, before the effect above, and marks the reminder as given.
  const enabled = useCallback((confirmation: string) => check(confirmation), [check]);

  return { banner, dismiss, permission, requestPermission, enabled };
}

"use client";
// Small browser hooks for the Today screen and the reminders: a clock that ticks, and whether we are online.

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The current time, refreshed every `everyMs` and as soon as the page becomes visible again (timers are slowed
 * down or paused while a phone screen is off, so the first tick after waking may otherwise come late).
 */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, everyMs);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);
  return now;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** navigator.onLine (true on the server). "Online" can still mean a captive or very slow network. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

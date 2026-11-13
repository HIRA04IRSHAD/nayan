"use client";
// The whole front end: provider + shell + the screen for the current state.
//
// Which screen shows is decided here and only here:
//   1. saved state not read yet      → a quiet loading screen (no flash of the setup screen for returning users)
//   2. a prescription review is open → ReviewScreen, full screen without the bottom tabs (one task at a time)
//   3. the dose check (blister) is open → DoseCheckScreen, also full screen with its own "वापस" button
//   4. otherwise the open tab; the "जाँचें" tab shows SetupScreen until a prescription is saved.

import { useEffect, useRef } from "react";
import { AppProvider, useApp } from "@/components/app/AppContext";
import { wantsDemo, withoutDemoParam } from "@/lib/app-url";
import type { TabId } from "@/components/app/tabs";
import { AppShell } from "@/components/shell/AppShell";
import { CheckScreen } from "@/components/screens/CheckScreen";
import { DoseCheckScreen } from "@/components/screens/DoseCheckScreen";
import { FamilyScreen } from "@/components/screens/FamilyScreen";
import { MedicinesScreen } from "@/components/screens/MedicinesScreen";
import { ReviewScreen } from "@/components/screens/ReviewScreen";
import { SetupScreen } from "@/components/screens/SetupScreen";
import { TodayScreen } from "@/components/screens/TodayScreen";
import type { NayanState } from "@/lib/types";

export default function NayanApp() {
  return (
    <AppProvider>
      <Screens />
    </AppProvider>
  );
}

function Screens() {
  const { hydrated, rx, tab, state, dose } = useApp();
  useDemoFromUrl();

  if (!hydrated) {
    return (
      <AppShell nav={false}>
        <p className="loading" role="status">
          नयन खुल रहा है…
        </p>
      </AppShell>
    );
  }

  if (rx.draft) {
    return (
      <AppShell nav={false}>
        <ReviewScreen />
      </AppShell>
    );
  }

  if (dose.active && state.prescription) {
    return (
      <AppShell nav={false}>
        <DoseCheckScreen />
      </AppShell>
    );
  }

  return <AppShell>{screenFor(tab, state)}</AppShell>;
}

/**
 * /app?demo=1 (the website's "Try the demo"): once the saved state is read, start the demo prescription if
 * nothing is saved yet (a saved prescription is never replaced by a link), then drop the parameter from the
 * address so a reload or a home-screen shortcut does not start it again.
 */
function useDemoFromUrl() {
  const { hydrated, rx, state } = useApp();
  const handled = useRef(false);
  useEffect(() => {
    if (!hydrated || handled.current) return;
    handled.current = true;
    if (!wantsDemo(window.location.search)) return;
    window.history.replaceState(window.history.state, "", withoutDemoParam(window.location.href));
    if (!state.prescription && !rx.draft) rx.startDemo();
  }, [hydrated, rx, state.prescription]);
}

/** Add a tab in components/app/tabs.ts and its screen here. */
function screenFor(tab: TabId, state: NayanState) {
  switch (tab) {
    case "check":
      return state.prescription ? <CheckScreen /> : <SetupScreen />;
    case "today":
      return <TodayScreen />;
    case "meds":
      return <MedicinesScreen />;
    case "family":
      return <FamilyScreen />;
  }
}

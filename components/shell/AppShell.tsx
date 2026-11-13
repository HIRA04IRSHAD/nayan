"use client";
// Page frame: "नयन ने कहा" banner on top, the screen, and (outside full-screen flows) the bottom tabs.
// The reading indicator lives here so it shows on whichever screen started the photo.

import type { ReactNode } from "react";
import { BUSY_LABEL, useApp } from "@/components/app/AppContext";
import { ReadingProgress } from "@/components/ui/ReadingProgress";
import { SaidBanner } from "./SaidBanner";
import { BottomNav } from "./BottomNav";
import { OfflineNotice } from "./OfflineNotice";
import { ReminderBanner } from "./ReminderBanner";

export function AppShell({ children, nav = true }: { children: ReactNode; nav?: boolean }) {
  const { busy, hydrated } = useApp();
  return (
    <div className={nav ? "app app--nav" : "app"}>
      <header className="appbar">
        {/* Visual wordmark only: the screen title and "नयन ने कहा" already name the app for screen readers. */}
        <p className="brand" aria-hidden="true">
          <span className="orb" />
          <span className="wordmark">Nayan</span>
          <span className="wordmark-hi">नयन</span>
          <span className="brand-tag">medicine check</span>
        </p>
        <SaidBanner />
      </header>
      <main id="main" className="screen">
        {hydrated && <OfflineNotice />}
        {hydrated && <ReminderBanner />}
        {busy && <ReadingProgress label={BUSY_LABEL[busy]} />}
        {children}
      </main>
      {nav && <BottomNav />}
    </div>
  );
}

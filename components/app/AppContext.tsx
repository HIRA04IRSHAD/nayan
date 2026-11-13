"use client";
// The app controller: what Nayan last said, which tab is open, whether a photo is being read, and the two
// flows (prescription setup, strip check). Screens read it with useApp(); saved data comes from lib/store.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { NayanState } from "@/lib/types";
import { SAY } from "@/lib/messages";
import { isListening, isSpeaking, speak, speechAllowed, stopSpeaking } from "@/lib/speech";
import { createAnnouncer } from "@/lib/announce";
import { ApiError } from "@/lib/client";
import { getNayanState, useHydrated, useNayan } from "@/lib/store";
import { THEME_COLOR } from "@/lib/theme";
import { SCREEN_TITLE_ID } from "@/components/ui/ScreenTitle";
import { DEFAULT_TAB, type TabId } from "./tabs";
import { usePrescriptionFlow, type PrescriptionFlow } from "./usePrescriptionFlow";
import { useStripCheck, type StripCheck } from "./useStripCheck";
import { useCaregiverCases, type CaregiverCases } from "./useCaregiverCases";
import { useBlisterCheck, type DoseCheck } from "./useBlisterCheck";
import { useReminders, type Reminders } from "./useReminders";
import { registerServiceWorker } from "@/lib/pwa";

export type BusyKind = "prescription" | "strip" | "lookup" | "case" | "blister";

export const BUSY_LABEL: Record<BusyKind, string> = {
  prescription: "पर्चा पढ़ा जा रहा है…",
  strip: "पत्ता पढ़ा जा रहा है…",
  lookup: "दवाएँ खोजी जा रही हैं…",
  case: "परिवार के लिए लिंक बन रहा है…",
  blister: "पत्ते के खाने गिने जा रहे हैं…",
};

export interface AppApi {
  /** Saved state (prescription, settings, …). Change it with updateNayan() from lib/store. */
  state: NayanState;
  /** False until the saved state has been read in the browser; screens wait for it. */
  hydrated: boolean;
  /** The last sentence spoken, shown in the "नयन ने कहा" banner. */
  said: string;
  /** Speak Hindi (fixed templates only) and show it in the banner. Resolves when speech ends. */
  say: (text: string) => Promise<void>;
  /**
   * Say something the user did not just ask for (reminder, family answer): it waits until no photo is being
   * read, nothing is being spoken and the microphone is closed, so it never cuts off a verdict.
   */
  announce: (text: string) => void;
  busy: BusyKind | null;
  /** The server has no Gemini key: photo reading is off, demo mode is offered. */
  noKey: boolean;
  /** Speak the right message for a failed photo read (no key / busy / other). */
  speakError: (e: unknown) => void;
  tab: TabId;
  /** Switch tab, say the screen name, and move focus to the new screen's title. */
  goTo: (tab: TabId) => void;
  /** Move focus to the current screen's <h1> after the next render. */
  focusScreenTitle: () => void;
  openPrescriptionCamera: () => void;
  openStripCamera: () => void;
  /** Camera for the back of a strip (dose check). */
  openBlisterCamera: () => void;
  rx: PrescriptionFlow;
  check: StripCheck;
  /** "परिवार से पूछें": caregiver cases (create, share, poll for the answer). */
  family: CaregiverCases;
  /** "खुराक जाँच (ब्लिस्टर)": pocket count of the back of a strip against the schedule. */
  dose: DoseCheck;
  /** Dose reminders while the app is open (banner, speech, system notification). */
  reminders: Reminders;
}

const AppContext = createContext<AppApi | null>(null);

/** Nayan's own voice on? Read from the store at call time, so a just-changed setting applies at once. */
const voiceOn = () => getNayanState().settings.voiceOn;

export function useApp(): AppApi {
  const api = useContext(AppContext);
  if (!api) throw new Error("useApp() must be used inside <AppProvider>");
  return api;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const state = useNayan();
  const hydrated = useHydrated();
  const [said, setSaid] = useState<string>(SAY.welcome);
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const [noKey, setNoKey] = useState(false);
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);
  const [focusTick, setFocusTick] = useState(0);
  const rxInput = useRef<HTMLInputElement>(null);
  const stripInput = useRef<HTMLInputElement>(null);
  const blisterInput = useRef<HTMLInputElement>(null);

  // The voice setting is read at call time and busy through a ref, so say/announce stay stable: the caregiver
  // poller and the reminders depend on them.
  const busyNow = useRef(busy);
  busyNow.current = busy;

  const say = useCallback((text: string) => {
    setSaid(text);
    // Voice off (screen-reader users): the live region and focus announce it; no second voice on top.
    if (!voiceOn()) {
      stopSpeaking();
      return Promise.resolve();
    }
    return speak(text);
  }, []);

  // Background announcements (reminders, family answers) wait for a quiet moment; see lib/announce.ts.
  const announcer = useMemo(
    () =>
      createAnnouncer({
        isBusy: () => !!busyNow.current || isSpeaking() || isListening(),
        canSpeak: () => !voiceOn() || speechAllowed(),
        play: say,
        show: setSaid,
      }),
    [say],
  );
  const announce = useCallback((text: string) => announcer.add(text), [announcer]);
  useEffect(() => {
    const timer = window.setInterval(announcer.pump, 400);
    return () => window.clearInterval(timer);
  }, [announcer]);

  const speakError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code === "no_key") {
        setNoKey(true);
        say(SAY.noKey);
      } else if (e instanceof ApiError && e.code === "busy") {
        say(SAY.busy);
      } else {
        console.error(e);
        say(SAY.readFailed);
      }
    },
    [say],
  );

  const focusScreenTitle = useCallback(() => setFocusTick((n) => n + 1), []);

  const check = useStripCheck({ say, setBusy, speakError });
  // Lives here (not in a screen) so waiting cases are polled and answers spoken on every tab.
  const family = useCaregiverCases({ say, announce, setBusy, busy, getEvidence: check.evidence, cases: state.cases });
  const rx = usePrescriptionFlow({
    say,
    setBusy,
    speakError,
    onClosed: (saved) => {
      if (saved) {
        check.reset();
        setTab("check");
      }
      focusScreenTitle();
    },
  });

  const dose = useBlisterCheck({
    say,
    setBusy,
    speakError,
    focusScreenTitle,
    // Back on the tab the flow was opened from: focus its title and say where the user is.
    onClosed: () => {
      focusScreenTitle();
      void say(SAY.screen[tab]);
    },
  });

  // Lives here (not in the Today screen) so a dose time is announced on whichever screen is open.
  const reminders = useReminders({ state, say, announce, focusScreenTitle });

  // Offline support (public/sw.js), production builds only; see lib/pwa.ts.
  useEffect(() => {
    registerServiceWorker({ production: process.env.NODE_ENV === "production", buildId: process.env.NAYAN_BUILD_ID ?? "dev" });
  }, []);

  // Runs after the render that showed the new screen, so its title exists.
  useEffect(() => {
    if (focusTick) document.getElementById(SCREEN_TITLE_ID)?.focus();
  }, [focusTick]);

  // Theme: the boot script in app/layout.tsx already set it before paint; keep it in sync with the setting.
  // Skipped until hydrated, otherwise the server default (dark) would briefly overwrite a saved light theme.
  const theme = state.settings.theme;
  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  }, [hydrated, theme]);

  function goTo(next: TabId) {
    setTab(next);
    focusScreenTitle();
    // With no prescription the check tab shows the setup screen, so say what to do there instead.
    say(next === "check" && !state.prescription ? SAY.takePrescriptionPhoto : SAY.screen[next]);
  }

  const openCamera = (ref: RefObject<HTMLInputElement | null>) => {
    if (!busy) ref.current?.click();
  };

  const api: AppApi = {
    state,
    hydrated,
    said,
    say,
    announce,
    busy,
    noKey,
    speakError,
    tab,
    goTo,
    focusScreenTitle,
    openPrescriptionCamera: () => openCamera(rxInput),
    openStripCamera: () => openCamera(stripInput),
    openBlisterCamera: () => openCamera(blisterInput),
    rx,
    check,
    family,
    dose,
    reminders,
  };

  return (
    <AppContext.Provider value={api}>
      {children}
      <PhotoInput inputRef={rxInput} label="पर्चे की फ़ोटो" onFile={rx.fromPhoto} />
      <PhotoInput inputRef={stripInput} label="पत्ते की फ़ोटो" onFile={check.fromPhoto} />
      <PhotoInput inputRef={blisterInput} label="पत्ते के पीछे की फ़ोटो" onFile={dose.fromPhoto} />
    </AppContext.Provider>
  );
}

/** Hidden camera input, opened by the big buttons. capture="environment" asks for the back camera. */
function PhotoInput({ inputRef, label, onFile }: { inputRef: RefObject<HTMLInputElement | null>; label: string; onFile: (f: File) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      tabIndex={-1}
      aria-label={label}
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) onFile(f);
      }}
    />
  );
}

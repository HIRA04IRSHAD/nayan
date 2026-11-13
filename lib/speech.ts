// Hindi speech in and out using the browser's built-in engines (no server, no cost).
import { speakable } from "./messages";

let hindiVoice: SpeechSynthesisVoice | null | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  if (hindiVoice !== undefined && hindiVoice !== null) return hindiVoice;
  const voices = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  hindiVoice = voices.find((v) => v.lang === "hi-IN") ?? voices.find((v) => v.lang.startsWith("hi")) ?? null;
  return hindiVoice;
}

// What the speech engines are doing right now, so background announcements (reminders, family answers) can wait
// for a quiet moment instead of cutting off a verdict or being heard by the yes/no microphone.
let speakGen = 0;
let speaking = false;
let listening = 0;

/** True while an utterance started by speak() is playing (or queued in the engine). */
export const isSpeaking = () => speaking;
/** True while listenYesNo() has the microphone open. */
export const isListening = () => listening > 0;

/**
 * Whether the browser will let the page speak. Chrome and Safari silently refuse speechSynthesis until the page
 * has had a user gesture (a tap or key press), so an announcement made on app open would be lost. Browsers
 * without the User Activation API are assumed to allow it.
 */
export function speechAllowed(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

/** Speak Hindi text; resolves when finished, cut off by the next speak(), or immediately if speech is unavailable. */
export function speak(text: string): Promise<void> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  speechSynthesis.cancel();
  const gen = ++speakGen;
  speaking = true;
  return new Promise((resolve) => {
    const done = () => {
      if (gen === speakGen) speaking = false;
      resolve();
    };
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.lang = "hi-IN";
    u.rate = 0.9;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}

export const stopSpeaking = () => typeof speechSynthesis !== "undefined" && speechSynthesis.cancel();

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function makeRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export const canListen = () => typeof window !== "undefined" && makeRecognition() !== null;

const NO = /नहीं|नही|गलत|ग़लत|nahi|nahin|galat|\bno\b|wrong/i;
const YES = /हाँ|हां|हा\b|सही|ठीक|जी|haan|han\b|ha\b|sahi|theek|yes|ok/i;

/** Listen for a Hindi yes/no. "No" is checked first so "सही नहीं" counts as no. */
export function listenYesNo(timeoutMs = 7000): Promise<"yes" | "no" | null> {
  const rec = makeRecognition();
  if (!rec) return Promise.resolve(null);
  listening++;
  return new Promise((done) => {
    let settled = false;
    const finish = (v: "yes" | "no" | null) => {
      if (settled) return;
      settled = true;
      listening--;
      try {
        rec.stop();
      } catch {}
      done(v);
    };
    rec.lang = "hi-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      const heard = Array.from(e.results[0] ?? []).map((a) => a.transcript).join(" ");
      finish(NO.test(heard) ? "no" : YES.test(heard) ? "yes" : null);
    };
    rec.onerror = () => finish(null);
    rec.onend = () => finish(null);
    setTimeout(() => finish(null), timeoutMs);
    try {
      rec.start();
    } catch {
      finish(null); // already started elsewhere, or the microphone is blocked
    }
  });
}

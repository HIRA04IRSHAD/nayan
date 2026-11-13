// Background announcements: things Nayan says that the user did not just ask for (a dose reminder, a family
// member's answer arriving by polling). They must never cut off what the user did ask for: speak() cancels
// whatever is playing, so a reminder fired the moment a photo read finished would silence the verdict, and one
// spoken while the yes/no microphone is open could be heard as the user's answer.
//
// So they wait in a queue until the app is quiet (no photo being read, no speech playing, microphone closed),
// then play one after another. Until the browser allows speech (no tap yet since the app opened), the text is
// only shown in the "नयन ने कहा" live region, so screen readers still get it, and it is spoken after the
// first tap. Pure and timer-free: the caller calls pump() (AppContext does on a short interval).

export interface AnnouncerDeps {
  /** A photo is being read, speech is playing, or the microphone is open. */
  isBusy: () => boolean;
  /** The browser lets the page speak now (or Nayan's voice is off, so nothing needs to be heard). */
  canSpeak: () => boolean;
  /** Speak and show the text; resolves when it has finished (or was cut off). */
  play: (text: string) => Promise<void>;
  /** Show the text without speaking it (live region only). */
  show: (text: string) => void;
}

export interface Announcer {
  add: (text: string) => void;
  /** Play the next announcement if the app is quiet. Safe to call at any time and as often as wanted. */
  pump: () => void;
  /** Announcements not yet played. */
  pending: () => number;
}

export function createAnnouncer(deps: AnnouncerDeps): Announcer {
  const queue: string[] = [];
  let playing = false;
  let shown = "";

  function pump() {
    if (playing || !queue.length || deps.isBusy()) return;
    if (!deps.canSpeak()) {
      const all = queue.join(" ");
      if (all !== shown) {
        shown = all;
        deps.show(all);
      }
      return;
    }
    const text = queue.shift() as string;
    shown = "";
    playing = true;
    let p: Promise<void>;
    try {
      p = deps.play(text);
    } catch {
      p = Promise.resolve();
    }
    p.catch(() => undefined).finally(() => {
      playing = false;
      pump();
    });
  }

  return {
    add(text) {
      if (!text) return;
      queue.push(text);
      pump();
    },
    pump,
    pending: () => queue.length,
  };
}

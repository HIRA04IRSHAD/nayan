import { describe, expect, it } from "vitest";
import { createAnnouncer } from "./announce";

function setup() {
  const st = { busy: false, allowed: true, played: [] as string[], shown: [] as string[], finish: [] as (() => void)[] };
  const a = createAnnouncer({
    isBusy: () => st.busy,
    canSpeak: () => st.allowed,
    play: (t) => {
      st.played.push(t);
      return new Promise<void>((r) => st.finish.push(r));
    },
    show: (t) => st.shown.push(t),
  });
  return { a, st };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createAnnouncer", () => {
  it("plays at once when the app is quiet", () => {
    const { a, st } = setup();
    a.add("reminder");
    expect(st.played).toEqual(["reminder"]);
  });

  it("waits while a verdict is being read or spoken, then plays", () => {
    const { a, st } = setup();
    st.busy = true;
    a.add("reminder");
    a.pump();
    expect(st.played).toEqual([]);
    st.busy = false;
    a.pump();
    expect(st.played).toEqual(["reminder"]);
  });

  it("plays queued announcements one after another, never on top of each other", async () => {
    const { a, st } = setup();
    a.add("one");
    a.add("two");
    a.pump();
    expect(st.played).toEqual(["one"]);
    st.finish[0]();
    await tick();
    expect(st.played).toEqual(["one", "two"]);
    expect(a.pending()).toBe(0);
  });

  it("before the first tap, only shows the text (live region) and speaks it once speech is allowed", () => {
    const { a, st } = setup();
    st.allowed = false;
    a.add("answer");
    a.pump();
    a.pump();
    expect(st.played).toEqual([]);
    expect(st.shown).toEqual(["answer"]); // shown once, not on every pump
    a.add("reminder");
    expect(st.shown).toEqual(["answer", "answer reminder"]);
    st.allowed = true;
    a.pump();
    expect(st.played).toEqual(["answer"]);
  });

  it("ignores empty text", () => {
    const { a, st } = setup();
    a.add("");
    expect(st.played).toEqual([]);
    expect(a.pending()).toBe(0);
  });
});

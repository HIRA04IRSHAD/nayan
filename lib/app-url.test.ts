import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_PATH, DEMO_PATH, wantsDemo, withoutDemoParam } from "./app-url";

describe("app address", () => {
  it("the app is at /app, and the manifest starts and scopes the installed app there", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "public", "manifest.webmanifest"), "utf8"));
    expect(APP_PATH).toBe("/app");
    expect(manifest.start_url).toBe(APP_PATH);
    expect(manifest.scope).toBe(APP_PATH);
    expect(DEMO_PATH).toBe("/app?demo=1");
  });
});

describe("?demo=1", () => {
  it("asks for the demo with demo=1 (and the obvious spellings)", () => {
    expect(wantsDemo("?demo=1")).toBe(true);
    expect(wantsDemo("demo=1")).toBe(true);
    expect(wantsDemo("?demo")).toBe(true);
    expect(wantsDemo("?x=2&demo=true")).toBe(true);
  });

  it("does not ask for it otherwise", () => {
    expect(wantsDemo("")).toBe(false);
    expect(wantsDemo("?demo=0")).toBe(false);
    expect(wantsDemo("?demo=no")).toBe(false);
    expect(wantsDemo("?demonstration=1")).toBe(false);
  });

  it("removes only the demo parameter, keeping the path, other parameters and the fragment", () => {
    expect(withoutDemoParam("https://nayan.example/app?demo=1")).toBe("/app");
    expect(withoutDemoParam("https://nayan.example/app?demo=1&x=2#top")).toBe("/app?x=2#top");
    expect(withoutDemoParam("/app?x=2")).toBe("/app?x=2");
  });
});

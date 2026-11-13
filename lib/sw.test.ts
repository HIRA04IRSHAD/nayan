// The service worker's routing rules (public/sw.js), run in a sandbox with a fake `self`. The key safety rule:
// /api/* is never cached or answered by the worker (a stale API answer must never become a verdict, and a cached
// case poll would hide a family answer).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Route = "pass" | "network-first" | "network-only" | "cache-first" | "refresh";

function loadWorker() {
  const listeners: Record<string, unknown> = {};
  const self = {
    location: { href: "https://nayan.test/sw.js?v=build42", origin: "https://nayan.test" },
    addEventListener: (type: string, fn: unknown) => {
      listeners[type] = fn;
    },
  };
  const sandbox: Record<string, unknown> = { self, URL, Response, Set, Promise };
  runInNewContext(readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8"), sandbox);
  return {
    routeFor: sandbox.routeFor as (r: { method: string; url: string; mode: string }) => Route,
    staticUrlsIn: sandbox.staticUrlsIn as (html: string) => string[],
    listeners,
    /** The worker's global context, to read its top-level constants. */
    context: sandbox,
  };
}

const sw = loadWorker();
const get = (path: string, mode = "cors", origin = "https://nayan.test") => sw.routeFor({ method: "GET", url: origin + path, mode });

describe("service worker routing", () => {
  it("never touches /api/*, whatever the request", () => {
    for (const path of ["/api/extract", "/api/cases/abc", "/api/cases/abc/photo", "/api/drugs/lookup"]) {
      expect(get(path), path).toBe("pass");
      expect(get(path, "navigate"), path).toBe("pass");
    }
    expect(sw.routeFor({ method: "POST", url: "https://nayan.test/api/extract", mode: "cors" })).toBe("pass");
  });

  it("app navigations are network first (the cached app page only when offline)", () => {
    expect(get("/app", "navigate")).toBe("network-first");
    expect(get("/app?demo=1", "navigate")).toBe("network-first");
    expect(get("/app/", "navigate")).toBe("network-first");
  });

  it("the website and family links are network only: never stored, a Hindi offline page instead", () => {
    expect(get("/", "navigate")).toBe("network-only");
    expect(get("/#studio", "navigate")).toBe("network-only");
    expect(get("/c/0123abcd", "navigate")).toBe("network-only");
    expect(get("/apple", "navigate")).toBe("network-only");
  });

  it("never touches the website's external media (video, 3D model, pond images)", () => {
    expect(get("/user/pond.mp4", "cors", "https://d8j0ntlcm91z4.cloudfront.net")).toBe("pass");
    expect(get("/user/koi.glb", "cors", "https://d8j0ntlcm91z4.cloudfront.net")).toBe("pass");
    expect(get("/?url=x", "no-cors", "https://images.higgs.ai")).toBe("pass");
  });

  it("content-hashed static files are cache first; icons and manifest are refreshed in the background", () => {
    expect(get("/_next/static/chunks/main-abc123.js")).toBe("cache-first");
    expect(get("/_next/static/media/font.woff2")).toBe("cache-first");
    expect(get("/manifest.webmanifest")).toBe("refresh");
    expect(get("/icon-192.png")).toBe("refresh");
  });

  it("leaves other origins, other methods and unknown files alone", () => {
    expect(get("/_next/static/x.js", "cors", "https://cdn.example")).toBe("pass");
    expect(sw.routeFor({ method: "POST", url: "https://nayan.test/", mode: "navigate" })).toBe("pass");
    expect(get("/robots.txt")).toBe("pass");
    expect(get("/_next/image?url=x")).toBe("pass");
  });

  it("finds the static files a cached page uses", () => {
    const html = '<script src="/_next/static/chunks/a-1.js"></script><link href="/_next/static/css/b.css"><script src="/_next/static/chunks/a-1.js">';
    expect(sw.staticUrlsIn(html)).toEqual(["/_next/static/chunks/a-1.js", "/_next/static/css/b.css"]);
  });

  it("registers the fetch handler", () => {
    expect(typeof sw.listeners.fetch).toBe("function");
  });

  it("precaches the app page (/app), never the website (/)", () => {
    const shell = runInNewContext("SHELL", sw.context) as string[];
    expect(shell).toContain("/app");
    expect(shell).not.toContain("/");
  });
});

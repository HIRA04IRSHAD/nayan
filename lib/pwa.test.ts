import { afterEach, describe, expect, it, vi } from "vitest";
import { isOurWorker, registerServiceWorker, serviceWorkerUrl } from "./pwa";

afterEach(() => vi.unstubAllGlobals());

describe("service worker registration", () => {
  it("names the worker after the build, so a new build installs a new worker", () => {
    expect(serviceWorkerUrl("abc 1")).toBe("/sw.js?v=abc%201");
  });

  it("recognises only Nayan's worker", () => {
    expect(isOurWorker("https://nayan.test/sw.js?v=1")).toBe(true);
    expect(isOurWorker("https://nayan.test/other-sw.js")).toBe(false);
    expect(isOurWorker(undefined)).toBe(false);
    expect(isOurWorker("not a url")).toBe(false);
  });

  it("in development, removes a leftover Nayan worker and registers nothing", async () => {
    const ours = { active: { scriptURL: "https://nayan.test/sw.js?v=old" }, unregister: vi.fn(async () => true) };
    const other = { active: { scriptURL: "https://nayan.test/push-sw.js" }, unregister: vi.fn(async () => true) };
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations: async () => [ours, other], register } });
    registerServiceWorker({ production: false, buildId: "dev" });
    await new Promise((r) => setTimeout(r, 0));
    expect(ours.unregister).toHaveBeenCalled();
    expect(other.unregister).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("in production, registers the build's worker", () => {
    const register = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal("navigator", { serviceWorker: { register, getRegistrations: vi.fn() } });
    registerServiceWorker({ production: true, buildId: "b7" });
    expect(register).toHaveBeenCalledWith("/sw.js?v=b7", { scope: "/" });
  });

  it("does nothing without service worker support", () => {
    vi.stubGlobal("navigator", {});
    expect(() => registerServiceWorker({ production: true, buildId: "b7" })).not.toThrow();
  });
});

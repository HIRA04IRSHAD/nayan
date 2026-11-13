import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractBlister, generate, MissingKeyError } from "./gemini";

const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const fail = (status: number) => new Response("busy", { status });
const modelOf = (url: string | URL | Request) => String(url).match(/models\/([^:]+)/)![1];

/** A fake fetch where each model answers after `ms` with the next response in its queue. */
function fakeFetch(plan: Record<string, { ms: number; res: () => Response | Error }[]>) {
  const calls: string[] = [];
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const model = modelOf(url);
    calls.push(model);
    const step = plan[model].shift();
    if (!step) return Promise.reject(new Error("no more responses"));
    return new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => {
        const r = step.res();
        if (r instanceof Error) reject(r);
        else resolve(r);
      }, step.ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const deps = (fetch: typeof globalThis.fetch) => ({
  fetch,
  sleep: async () => {},
  models: ["main", "backup", "third"],
  hedgeDelayMs: 50,
  attemptTimeoutMs: 1000,
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("generate (racing models)", () => {
  it("uses the main model when it answers quickly, without starting the backup", async () => {
    const { fn, calls } = fakeFetch({ main: [{ ms: 5, res: () => ok("A") }], backup: [], third: [] });
    await expect(generate("k", "{}", deps(fn))).resolves.toEqual({ text: "A", model: "main" });
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toEqual(["main"]);
  });

  it("starts the backup when the main model is slow, and takes whichever answers first", async () => {
    const { fn, calls } = fakeFetch({ main: [{ ms: 500, res: () => ok("slow") }], backup: [{ ms: 10, res: () => ok("fast") }], third: [] });
    await expect(generate("k", "{}", deps(fn))).resolves.toEqual({ text: "fast", model: "backup" });
    expect(calls).toEqual(["main", "backup"]);
  });

  it("moves on straight away when a model fails, without waiting for the hedge delay", async () => {
    const { fn, calls } = fakeFetch({ main: [{ ms: 1, res: () => fail(400) }], backup: [{ ms: 1, res: () => ok("B") }], third: [] });
    const start = Date.now();
    await expect(generate("k", "{}", deps(fn))).resolves.toMatchObject({ model: "backup" });
    expect(Date.now() - start).toBeLessThan(45);
    expect(calls).toEqual(["main", "backup"]);
  });

  it("retries an overloaded model once", async () => {
    const { fn, calls } = fakeFetch({ main: [{ ms: 1, res: () => fail(503) }, { ms: 1, res: () => ok("again") }], backup: [{ ms: 500, res: () => ok("late") }], third: [] });
    await expect(generate("k", "{}", deps(fn))).resolves.toEqual({ text: "again", model: "main" });
    expect(calls).toEqual(["main", "main"]);
  });

  it("does not retry a model whose quota is used up", async () => {
    const quota = () => new Response('{"error":{"code":429,"message":"You exceeded your current quota"}}', { status: 429 });
    const { fn, calls } = fakeFetch({ main: [{ ms: 1, res: quota }], backup: [{ ms: 1, res: () => ok("B") }], third: [] });
    await expect(generate("k", "{}", deps(fn))).resolves.toMatchObject({ model: "backup" });
    expect(calls).toEqual(["main", "backup"]);
  });

  it("reports every model's error when all of them fail", async () => {
    const { fn } = fakeFetch({
      main: [{ ms: 1, res: () => fail(400) }],
      backup: [{ ms: 1, res: () => new Error("network down") }],
      third: [{ ms: 1, res: () => fail(503) }, { ms: 1, res: () => fail(503) }],
    });
    await expect(generate("k", "{}", deps(fn))).rejects.toThrow(/main 400.*backup.*third 503/);
  });

  it("gives up on a hung model after the attempt timeout", async () => {
    const { fn } = fakeFetch({ main: [{ ms: 10_000, res: () => ok("never") }], backup: [{ ms: 10_000, res: () => ok("never") }], third: [{ ms: 10_000, res: () => ok("never") }] });
    await expect(generate("k", "{}", { ...deps(fn), attemptTimeoutMs: 80 })).rejects.toThrow(/TimeoutError|AbortError/);
  });
});

describe("extractBlister (two independent pocket counts, fetch mocked)", () => {
  const count = (empty: number, total = 10) =>
    ok(JSON.stringify({ total_pockets: total, empty_pockets: empty, whole_strip_visible: true, confidence: 0.95 }));
  const promptOf = (init?: RequestInit) => JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
  const oneModel = (fetch: typeof globalThis.fetch) => ({ fetch, sleep: async () => {}, models: ["main"], hedgeDelayMs: 1000, attemptTimeoutMs: 1000 });

  beforeEach(() => vi.stubEnv("GEMINI_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("sends two requests with different counting methods and returns both reads", async () => {
    const inits: RequestInit[] = [];
    const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      inits.push(init!);
      return count(inits.length === 1 ? 3 : 4);
    }) as unknown as typeof fetch;
    const res = await extractBlister("aGk=", "image/jpeg", oneModel(fn));
    expect(fn).toHaveBeenCalledTimes(2);
    const [a, b] = inits.map(promptOf);
    expect(a).not.toBe(b);
    for (const p of [a, b]) {
      expect(p).toContain("Only count");
      expect(p).toMatch(/Do NOT say or guess whether a dose was\s+taken/);
    }
    const body = JSON.parse(String(inits[0].body));
    expect(body.generationConfig.responseSchema.required).toEqual(["total_pockets", "empty_pockets", "whole_strip_visible", "confidence"]);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: "image/jpeg", data: "aGk=" });
    expect(res.reads.map((r) => r?.empty_pockets)).toEqual([3, 4]);
  });

  it("returns null for a read that failed or broke the schema, so the rules say not sure", async () => {
    const failSecond = vi.fn(async (_u: string | URL | Request, init?: RequestInit) =>
      promptOf(init).includes("FULL pockets") ? fail(400) : count(2),
    ) as unknown as typeof fetch;
    expect((await extractBlister("aGk=", "image/jpeg", oneModel(failSecond))).reads).toEqual([
      { total_pockets: 10, empty_pockets: 2, whole_strip_visible: true, confidence: 0.95 },
      null,
    ]);

    const badSchema = vi.fn(async (_u: string | URL | Request, init?: RequestInit) =>
      promptOf(init).includes("FULL pockets") ? count(-1) : count(2),
    ) as unknown as typeof fetch;
    expect((await extractBlister("aGk=", "image/jpeg", oneModel(badSchema))).reads[1]).toBeNull();
  });

  it("throws the model error when both reads fail, so 'busy' reaches the user", async () => {
    const busy = vi.fn(async () => fail(503)) as unknown as typeof fetch;
    await expect(extractBlister("aGk=", "image/jpeg", oneModel(busy))).rejects.toThrow(/main 503/);
  });

  it("refuses without an API key and never calls the network", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fn = vi.fn() as unknown as typeof fetch;
    await expect(extractBlister("aGk=", "image/jpeg", oneModel(fn))).rejects.toBeInstanceOf(MissingKeyError);
    expect(fn).not.toHaveBeenCalled();
  });
});

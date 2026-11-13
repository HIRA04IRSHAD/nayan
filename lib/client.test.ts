// Browser-side photo reads with a mocked fetch (never the real API).
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, readBlister, type PreparedImage } from "./client";

const IMG: PreparedImage = { base64: "aGk=", mimeType: "image/jpeg", blob: new Blob() };
const good = { total_pockets: 10, empty_pockets: 3, whole_strip_visible: true, confidence: 0.95 };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("readBlister", () => {
  it("posts kind 'blister' and returns both reads", async () => {
    const f = mockFetch(200, { reads: [good, { ...good, empty_pockets: 4 }] });
    const reads = await readBlister(IMG);
    expect(reads.map((r) => r?.empty_pockets)).toEqual([3, 4]);
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ kind: "blister", image: "aGk=", mimeType: "image/jpeg" });
  });

  it("turns a missing or malformed read into null (the rules then say not sure)", async () => {
    mockFetch(200, { reads: [good, null] });
    expect(await readBlister(IMG)).toEqual([good, null]);
    mockFetch(200, { reads: [{ total_pockets: "10" }, good] });
    expect(await readBlister(IMG)).toEqual([null, good]);
    mockFetch(200, {});
    expect(await readBlister(IMG)).toEqual([null, null]);
  });

  it("passes server errors on as ApiError codes", async () => {
    mockFetch(503, { error: "busy" });
    await expect(readBlister(IMG)).rejects.toEqual(new ApiError("busy"));
  });
});

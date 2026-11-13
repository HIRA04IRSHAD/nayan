import { describe, expect, it, vi } from "vitest";
import { handleExtract, MAX_BASE64, type ExtractDeps } from "./extract-api";
import { MissingKeyError } from "./gemini";

// Fake extractors only: these tests never reach Gemini.
function deps(over: Partial<ExtractDeps> = {}): ExtractDeps {
  return {
    extract: vi.fn(async () => ({ ok: true }) as never),
    extractBlister: vi.fn(async () => ({ reads: [null, null] }) as never),
    ...over,
  };
}

const post = (body: string) => new Request("http://localhost/api/extract", { method: "POST", body, headers: { "content-type": "application/json" } });
const ok = (over: Record<string, unknown> = {}) => JSON.stringify({ kind: "strip", image: "aGVsbG8=", mimeType: "image/jpeg", ...over });

describe("handleExtract", () => {
  it("passes a valid request to the right extractor", async () => {
    const d = deps();
    const res = await handleExtract(post(ok()), d);
    expect(res.status).toBe(200);
    expect(d.extract).toHaveBeenCalledWith("strip", "aGVsbG8=", "image/jpeg");
    const b = deps();
    await handleExtract(post(ok({ kind: "blister" })), b);
    expect(b.extractBlister).toHaveBeenCalledWith("aGVsbG8=", "image/jpeg");
  });

  it("defaults a missing type to JPEG", async () => {
    const d = deps();
    await handleExtract(post(JSON.stringify({ kind: "prescription", image: "aGVsbG8=" })), d);
    expect(d.extract).toHaveBeenCalledWith("prescription", "aGVsbG8=", "image/jpeg");
  });

  it("answers 400 (not 500) for malformed bodies, and never calls the model", async () => {
    for (const body of ["x", "null", "[]", "42", ok({ kind: "selfie" }), ok({ image: "" }), ok({ image: "<script>" }), ok({ extra: 1 })]) {
      const d = deps();
      const res = await handleExtract(post(body), d);
      expect(res.status, body).toBe(400);
      expect(d.extract).not.toHaveBeenCalled();
      expect(d.extractBlister).not.toHaveBeenCalled();
    }
  });

  it("refuses a mime type Gemini should not get", async () => {
    const d = deps();
    const res = await handleExtract(post(ok({ kind: "blister", mimeType: "text/html" })), d);
    expect(res.status).toBe(400);
    expect(d.extractBlister).not.toHaveBeenCalled();
  });

  it("refuses an oversized image with 413", async () => {
    const res = await handleExtract(post(ok({ image: "A".repeat(MAX_BASE64 + 4) })), deps());
    expect(res.status).toBe(413);
  });

  it("maps a missing key, a busy service and other failures", async () => {
    const noKey = await handleExtract(post(ok()), deps({ extract: vi.fn(async () => Promise.reject(new MissingKeyError())) as never }));
    expect([noKey.status, (await noKey.json()).error]).toEqual([503, "no_key"]);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const busy = await handleExtract(post(ok()), deps({ extract: vi.fn(async () => Promise.reject(new Error("gemini 429 quota"))) as never }));
    expect([busy.status, (await busy.json()).error]).toEqual([503, "busy"]);
    const other = await handleExtract(post(ok()), deps({ extract: vi.fn(async () => Promise.reject(new Error("boom"))) as never }));
    expect([other.status, (await other.json()).error]).toEqual([502, "extract_failed"]);
    err.mockRestore();
  });
});

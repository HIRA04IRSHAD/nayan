// Browser-side case API calls with a mocked fetch: status codes map to the outcomes the UI handles.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCase, fetchCase, fetchCasePhoto, sendAnswer } from "./case-client";
import { ApiError } from "./client";

const ID = "b".repeat(32);
const TOKEN = "T".repeat(32);
const VIEW = {
  id: ID,
  createdAt: "2026-11-09T10:00:00.000Z",
  expiresAt: "2026-11-11T10:00:00.000Z",
  caregiverName: "",
  itemLines: ["1. Dolo 650"],
  whatNayanRead: "",
  verdictText: "",
  status: "waiting",
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("case client", () => {
  it("creates a case and validates the response", async () => {
    const f = mockFetch(201, { id: ID, token: TOKEN, url: `http://localhost:3000/c/${ID}#t=${TOKEN}`, expiresAt: "x" });
    const c = await createCase({ photo: "AAAA", mime: "image/jpeg", itemLines: ["a"], whatNayanRead: "", verdictText: "" });
    expect(c.id).toBe(ID);
    expect(f).toHaveBeenCalledWith("/api/cases", expect.objectContaining({ method: "POST" }));
  });

  it("turns a server error into an ApiError with its code", async () => {
    mockFetch(503, { error: "store_full" });
    await expect(createCase({ photo: "AAAA", mime: "image/jpeg", itemLines: ["a"], whatNayanRead: "", verdictText: "" })).rejects.toEqual(
      new ApiError("store_full"),
    );
  });

  it("polls: ok, gone (404) and expired (410)", async () => {
    const f = mockFetch(200, VIEW);
    expect(await fetchCase(ID, TOKEN)).toEqual({ kind: "ok", view: VIEW });
    // The token travels in a header, never in the URL (URLs end up in access logs).
    expect(f).toHaveBeenCalledWith(`/api/cases/${ID}`, { cache: "no-store", headers: { "x-case-token": TOKEN } });
    mockFetch(404, { error: "not_found" });
    expect(await fetchCase(ID, TOKEN)).toEqual({ kind: "gone", expired: false });
    mockFetch(410, { error: "expired" });
    expect(await fetchCase(ID, TOKEN)).toEqual({ kind: "gone", expired: true });
    mockFetch(500, {});
    await expect(fetchCase(ID, TOKEN)).rejects.toBeInstanceOf(ApiError);
  });

  it("answers: ok, and 409 returns the earlier answer", async () => {
    const answered = { ...VIEW, status: "answered", answer: "correct", itemIndex: null, note: "", answeredAt: "t" };
    mockFetch(200, answered);
    expect(await sendAnswer(ID, { t: TOKEN, answer: "correct" })).toEqual({ kind: "ok", view: answered });
    mockFetch(409, { error: "already_answered", case: answered });
    expect(await sendAnswer(ID, { t: TOKEN, answer: "wrong" })).toEqual({ kind: "already", view: answered });
    mockFetch(410, { error: "expired" });
    expect(await sendAnswer(ID, { t: TOKEN, answer: "wrong" })).toEqual({ kind: "gone", expired: true });
  });

  it("fetches the photo with the token in a header, not the URL", async () => {
    const fn = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fn);
    const blob = await fetchCasePhoto(ID, TOKEN);
    expect(blob).toBeInstanceOf(Blob);
    expect(fn).toHaveBeenCalledWith(`/api/cases/${ID}/photo`, { cache: "no-store", headers: { "x-case-token": TOKEN } });
    mockFetch(404, { error: "not_found" });
    expect(await fetchCasePhoto(ID, TOKEN)).toBe("gone");
  });
});

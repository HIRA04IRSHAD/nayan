// The real route handlers (app/api/cases/**/route.ts) called with Request objects. The file store writes to a
// temp directory chosen through NAYAN_CASES_DIR, so nothing touches data/cases/.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as createRoute } from "@/app/api/cases/route";
import { GET as getRoute } from "@/app/api/cases/[id]/route";
import { GET as photoRoute } from "@/app/api/cases/[id]/photo/route";
import { POST as answerRoute } from "@/app/api/cases/[id]/answer/route";
import { CASE_TTL_MS, MAX_PHOTO_BYTES, caseViewZ, createdCaseZ, type CreateCaseBody } from "./case-schema";
import { decodePhoto, sniffMatches } from "./case-api";

const ORIGIN = "http://localhost:3000";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 9, 9, 9, 9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

const body = (over: Partial<Record<keyof CreateCaseBody, unknown>> & Record<string, unknown> = {}) => ({
  photo: JPEG.toString("base64"),
  mime: "image/jpeg",
  itemLines: ["1. Dolo 650, Paracetamol 650 mg, सुबह और रात।", "2. Pan 40, Pantoprazole 40 mg।"],
  whatNayanRead: "नाम: Dolo 6?0 · नमक: Paracetamol 6?0 mg",
  verdictText: "पक्का नहीं कह सकते।",
  caregiverName: "प्रिया",
  ...over,
});

const post = (url: string, data: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof data === "string" ? data : JSON.stringify(data) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createOk(over = {}) {
  const res = await createRoute(post(`${ORIGIN}/api/cases`, body(over)));
  expect(res.status).toBe(201);
  return createdCaseZ.parse(await res.json());
}
// The token goes in the x-case-token header (the client never puts it in the URL, which access logs keep).
const getCase = (id: string, t: string) => getRoute(new Request(`${ORIGIN}/api/cases/${id}`, { headers: { "x-case-token": t } }), ctx(id));
const answer = (id: string, data: unknown) => answerRoute(post(`${ORIGIN}/api/cases/${id}/answer`, data), ctx(id));

let dir: string;
const savedEnv = { dir: process.env.NAYAN_CASES_DIR, url: process.env.NAYAN_PUBLIC_URL };
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "nayan-api-"));
  process.env.NAYAN_CASES_DIR = dir;
  delete process.env.NAYAN_PUBLIC_URL;
});
afterAll(() => {
  process.env.NAYAN_CASES_DIR = savedEnv.dir;
  if (savedEnv.dir === undefined) delete process.env.NAYAN_CASES_DIR;
  if (savedEnv.url !== undefined) process.env.NAYAN_PUBLIC_URL = savedEnv.url;
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.NAYAN_PUBLIC_URL;
});

describe("POST /api/cases", () => {
  it("creates a case and returns id, token and a link with the token in the #fragment", async () => {
    const c = await createOk();
    expect(c.url).toBe(`${ORIGIN}/c/${c.id}#t=${c.token}`);
    expect(Date.parse(c.expiresAt) - Date.now()).toBeGreaterThan(CASE_TTL_MS - 60_000);
  });

  it("uses NAYAN_PUBLIC_URL for the link when set", async () => {
    process.env.NAYAN_PUBLIC_URL = "https://nayan.example.org/";
    const c = await createOk();
    expect(c.url).toBe(`https://nayan.example.org/c/${c.id}#t=${c.token}`);
  });

  it("accepts PNG and WebP photos", async () => {
    await createOk({ photo: PNG.toString("base64"), mime: "image/png" });
    await createOk({ photo: WEBP.toString("base64"), mime: "image/webp" });
  });

  it.each([
    ["no prescription lines", { itemLines: [] }],
    ["too many prescription lines", { itemLines: Array.from({ length: 31 }, (_, i) => `line ${i}`) }],
    ["a blank prescription line", { itemLines: ["   "] }],
    ["a too long line", { itemLines: ["x".repeat(301)] }],
    ["a too long caregiver name", { caregiverName: "x".repeat(61) }],
    ["a too long verdict text", { verdictText: "x".repeat(601) }],
    ["an unsupported mime type", { mime: "image/gif" }],
    ["a photo that is not base64", { photo: "not base64!!" }],
    ["an unknown field", { patientPhone: "9999999999" }],
    ["a missing photo", { photo: undefined }],
  ])("rejects %s with 400", async (_name, over) => {
    const res = await createRoute(post(`${ORIGIN}/api/cases`, body(over)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid");
  });

  it("rejects bytes that do not match the claimed image type", async () => {
    const res = await createRoute(post(`${ORIGIN}/api/cases`, body({ photo: PNG.toString("base64"), mime: "image/jpeg" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_photo");
    const html = await createRoute(post(`${ORIGIN}/api/cases`, body({ photo: Buffer.from("<html>").toString("base64") })));
    expect(html.status).toBe(400);
  });

  it("rejects a photo over 2 MB after decoding with 413", async () => {
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 3, 0);
    JPEG.copy(big);
    const res = await createRoute(post(`${ORIGIN}/api/cases`, body({ photo: big.toString("base64") })));
    expect([400, 413]).toContain(res.status); // over the base64 length limit (400) or the decoded limit (413)
    const res2 = await createRoute(post(`${ORIGIN}/api/cases`, "{}", { "content-length": String(10 * 1024 * 1024) }));
    expect(res2.status).toBe(413);
  });

  it("rejects broken JSON", async () => {
    const res = await createRoute(post(`${ORIGIN}/api/cases`, "{nope"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_json");
  });

  it("strips control characters and trims text", async () => {
    const c = await createOk({ caregiverName: "  प्रिया\u0007 ", itemLines: ["1. Dolo\u0000 650"] });
    const view = caseViewZ.parse(await (await getCase(c.id, c.token)).json());
    expect(view.caregiverName).toBe("प्रिया");
    expect(view.itemLines).toEqual(["1. Dolo 650"]);
  });
});

describe("GET /api/cases/[id] and /photo", () => {
  it("returns the case without photo bytes or token, marked no-store", async () => {
    const c = await createOk();
    const res = await getCase(c.id, c.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const raw = await res.json();
    const view = caseViewZ.parse(raw);
    expect(view).toMatchObject({ id: c.id, status: "waiting", caregiverName: "प्रिया" });
    expect(JSON.stringify(raw)).not.toContain(c.token);
    expect(JSON.stringify(raw)).not.toMatch(/tokenHash|photo/);
  });

  it("answers 404 without the right token, for unknown ids and for path tricks", async () => {
    const c = await createOk();
    const other = await createOk();
    expect((await getCase(c.id, "")).status).toBe(404);
    expect((await getCase(c.id, other.token)).status).toBe(404);
    expect((await getCase("0".repeat(32), c.token)).status).toBe(404);
    expect((await getCase("..%2F..%2Fpackage", c.token)).status).toBe(404);
  });

  it("answers 410 once the case has expired", async () => {
    const c = await createOk();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + CASE_TTL_MS + 1000);
    const res = await getCase(c.id, c.token);
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("expired");
  });

  it("serves the photo bytes with their type, only with the token", async () => {
    const c = await createOk();
    const photoReq = (t: string) => new Request(`${ORIGIN}/api/cases/${c.id}/photo`, { headers: { "x-case-token": t } });
    const res = await photoRoute(photoReq(c.token), ctx(c.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG)).toBe(true);
    const denied = await photoRoute(photoReq("wrongwrongwrongwrong"), ctx(c.id));
    expect(denied.status).toBe(404);
    expect((await photoRoute(new Request(`${ORIGIN}/api/cases/${c.id}/photo`), ctx(c.id))).status).toBe(404);
  });

  it("still accepts the token in ?t= from a page loaded before the header change", async () => {
    const c = await createOk();
    const res = await getRoute(new Request(`${ORIGIN}/api/cases/${c.id}?t=${encodeURIComponent(c.token)}`), ctx(c.id));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/cases/[id]/answer", () => {
  it("accepts one answer, then refuses the second with 409 and the first answer", async () => {
    const c = await createOk();
    const res = await answer(c.id, { t: c.token, answer: "correct", itemIndex: 1, note: "यही दवा है" });
    expect(res.status).toBe(200);
    expect(caseViewZ.parse(await res.json())).toMatchObject({ status: "answered", answer: "correct", itemIndex: 1, note: "यही दवा है" });

    const again = await answer(c.id, { t: c.token, answer: "wrong" });
    expect(again.status).toBe(409);
    const j = await again.json();
    expect(j.error).toBe("already_answered");
    expect(j.case).toMatchObject({ answer: "correct" });

    const polled = caseViewZ.parse(await (await getCase(c.id, c.token)).json());
    expect(polled).toMatchObject({ status: "answered", answer: "correct", itemIndex: 1 });
  });

  it("drops 'which medicine' from a 'wrong' answer", async () => {
    const c = await createOk();
    const res = await answer(c.id, { t: c.token, answer: "wrong", itemIndex: 0 });
    expect(caseViewZ.parse(await res.json())).toMatchObject({ answer: "wrong", itemIndex: null });
  });

  it("needs the token", async () => {
    const c = await createOk();
    expect((await answer(c.id, { t: "x".repeat(32), answer: "correct" })).status).toBe(404);
    expect((await answer(c.id, { answer: "correct" })).status).toBe(400);
  });

  it.each([
    ["an unknown answer", { answer: "maybe" }],
    ["a negative itemIndex", { answer: "correct", itemIndex: -1 }],
    ["a fractional itemIndex", { answer: "correct", itemIndex: 0.5 }],
    ["a too long note", { answer: "correct", note: "x".repeat(301) }],
    ["an unknown field", { answer: "correct", extra: 1 }],
  ])("rejects %s with 400", async (_name, over) => {
    const c = await createOk();
    expect((await answer(c.id, { t: c.token, ...over })).status).toBe(400);
  });

  it("rejects an itemIndex beyond this case's prescription lines", async () => {
    const c = await createOk();
    const res = await answer(c.id, { t: c.token, answer: "correct", itemIndex: 2 });
    expect(res.status).toBe(400);
    // Nothing was recorded, so a valid answer still works.
    expect((await answer(c.id, { t: c.token, answer: "correct", itemIndex: 0 })).status).toBe(200);
  });

  it("answers 410 after expiry", async () => {
    const c = await createOk();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + CASE_TTL_MS + 1000);
    expect((await answer(c.id, { t: c.token, answer: "correct" })).status).toBe(410);
  });
});

describe("photo checks", () => {
  it("recognises JPEG, PNG and WebP signatures", () => {
    expect(sniffMatches(JPEG, "image/jpeg")).toBe(true);
    expect(sniffMatches(PNG, "image/png")).toBe(true);
    expect(sniffMatches(WEBP, "image/webp")).toBe(true);
    expect(sniffMatches(JPEG, "image/png")).toBe(false);
    expect(sniffMatches(Buffer.from("RIFF0000WAVE"), "image/webp")).toBe(false);
  });

  it("decodePhoto enforces the decoded size limit", () => {
    const big = Buffer.alloc(MAX_PHOTO_BYTES + 1);
    JPEG.copy(big);
    expect(decodePhoto(big.toString("base64"), "image/jpeg")).toEqual({ ok: false, error: "photo_too_large" });
    expect(decodePhoto("", "image/jpeg")).toEqual({ ok: false, error: "bad_photo" });
    expect(decodePhoto(JPEG.toString("base64"), "image/jpeg").ok).toBe(true);
  });
});

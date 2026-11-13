// FileCaseStore against a real temp directory: create / get / answer once / expiry / token checks.
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CASE_TTL_MS } from "./case-schema";
import { CaseStoreFullError, FileCaseStore, hashToken, newCaseToken, tokenMatches, toView, type NewCase } from "./case-store";

const JPEG =Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 1, 2, 3, 4]);
const INPUT: NewCase = {
  itemLines: ["1. Dolo 650, Paracetamol 650 mg।", "2. Pan 40, Pantoprazole 40 mg।"],
  whatNayanRead: "नाम: Dolo 6?0",
  verdictText: "पक्का नहीं कह सकते।",
  caregiverName: "प्रिया",
};
const T0 = new Date("2026-11-09T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

let dir: string;
let store: FileCaseStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "nayan-cases-"));
  store = new FileCaseStore(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const create = (now = T0) => store.create(INPUT, { bytes: JPEG, mime: "image/jpeg" }, now);

describe("ids and tokens", () => {
  it("makes a 128-bit hex id and a >=128-bit base64url token", async () => {
    const { record, token } = await create();
    expect(record.id).toMatch(/^[0-9a-f]{32}$/);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24 random bytes = 192 bits
    expect(newCaseToken()).not.toBe(newCaseToken());
  });

  it("stores only a hash of the token, never the token itself", async () => {
    const { record, token } = await create();
    const raw = readFileSync(path.join(dir, `${record.id}.json`), "utf8");
    expect(raw).not.toContain(token);
    expect(JSON.parse(raw).tokenHash).toBe(hashToken(token).toString("hex"));
  });

  it("tokenMatches is false for malformed tokens or hashes", () => {
    const t = newCaseToken();
    const h = hashToken(t).toString("hex");
    expect(tokenMatches(t, h)).toBe(true);
    expect(tokenMatches(t + "x", h)).toBe(false);
    expect(tokenMatches("short", h)).toBe(false);
    expect(tokenMatches(t, "abcd")).toBe(false);
  });
});

describe("create and get", () => {
  it("writes the record and the photo as .jpg, and returns the case with the right token", async () => {
    const { record, token } = await create();
    expect(readdirSync(dir).sort()).toEqual([`${record.id}.jpg`, `${record.id}.json`].sort());
    const got = await store.get(record.id, token, at(1000));
    expect(got).toEqual({ ok: true, value: record });
    expect(record.expiresAt).toBe(at(CASE_TTL_MS).toISOString());
    const photo = await store.getPhoto(record.id, token, at(1000));
    expect(photo.ok && photo.value.bytes.equals(JPEG) && photo.value.mime).toBe("image/jpeg");
  });

  it("refuses a wrong token, another case's token, and malformed ids, all as not_found", async () => {
    const a = await create();
    const b = await create();
    expect(await store.get(a.record.id, newCaseToken(), T0)).toEqual({ ok: false, reason: "not_found" });
    expect(await store.get(a.record.id, b.token, T0)).toEqual({ ok: false, reason: "not_found" });
    expect(await store.get("../../etc/passwd", a.token, T0)).toEqual({ ok: false, reason: "not_found" });
    expect(await store.get(a.record.id.toUpperCase(), a.token, T0)).toEqual({ ok: false, reason: "not_found" });
    expect(await store.get(a.record.id, "", T0)).toEqual({ ok: false, reason: "not_found" });
    expect(await store.getPhoto(a.record.id, b.token, T0)).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses new cases when the store is full", async () => {
    const small = new FileCaseStore(dir, { maxCases: 2 });
    const photo = { bytes: JPEG, mime: "image/jpeg" as const };
    await small.create(INPUT, photo, T0);
    await small.create(INPUT, photo, T0);
    await expect(small.create(INPUT, photo, T0)).rejects.toBeInstanceOf(CaseStoreFullError);
  });
});

describe("answer", () => {
  it("records the first answer and refuses a second one", async () => {
    const { record, token } = await create();
    const first = await store.answer(record.id, token, { answer: "correct", itemIndex: 1, note: "यही है" }, at(60_000));
    expect(first.ok).toBe(true);
    const second = await store.answer(record.id, token, { answer: "wrong", itemIndex: null, note: "" }, at(120_000));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_answered");
    const got = await store.get(record.id, token, at(180_000));
    expect(got.ok && got.value.answer).toEqual({ answer: "correct", itemIndex: 1, note: "यही है", answeredAt: at(60_000).toISOString() });
  });

  it("lets exactly one of two simultaneous answers win", async () => {
    const { record, token } = await create();
    const results = await Promise.all([
      store.answer(record.id, token, { answer: "correct", itemIndex: null, note: "" }, T0),
      store.answer(record.id, token, { answer: "wrong", itemIndex: null, note: "" }, T0),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "already_answered")).toHaveLength(1);
  });

  it("needs the token to answer", async () => {
    const { record } = await create();
    expect(await store.answer(record.id, newCaseToken(), { answer: "correct", itemIndex: null, note: "" }, T0)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("shows the answer in the public view, without token or photo", async () => {
    const { record, token } = await create();
    const r = await store.answer(record.id, token, { answer: "wrong", itemIndex: null, note: "" }, T0);
    const view = r.ok ? toView(r.value) : null;
    expect(view).toMatchObject({ status: "answered", answer: "wrong", itemIndex: null });
    expect(JSON.stringify(view)).not.toMatch(/tokenHash|photoMime/);
    expect(toView(record)).toMatchObject({ status: "waiting" });
    expect(toView(record).answer).toBeUndefined();
  });
});

describe("expiry", () => {
  it("serves a case until 48 h, then reports expired and deletes its files", async () => {
    const { record, token } = await create();
    expect((await store.get(record.id, token, at(CASE_TTL_MS - 1))).ok).toBe(true);
    expect(await store.get(record.id, token, at(CASE_TTL_MS))).toEqual({ ok: false, reason: "expired" });
    expect(readdirSync(dir)).toEqual([]);
    expect(await store.get(record.id, token, at(CASE_TTL_MS))).toEqual({ ok: false, reason: "not_found" });
  });

  it("does not accept an answer after expiry", async () => {
    const { record, token } = await create();
    const r = await store.answer(record.id, token, { answer: "correct", itemIndex: null, note: "" }, at(CASE_TTL_MS + 1));
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("expire() sweeps expired cases (and old orphan files) and keeps live ones", async () => {
    const old = await create(T0);
    const live = await create(at(CASE_TTL_MS / 2));
    await store.answer(old.record.id, old.token, { answer: "correct", itemIndex: null, note: "" }, at(1000));
    // A half-written case from a crash: a photo with no record, last touched long ago.
    const orphan = path.join(dir, `${"a".repeat(32)}.jpg`);
    writeFileSync(orphan, JPEG);
    const longAgo = (T0.getTime() - CASE_TTL_MS) / 1000;
    utimesSync(orphan, longAgo, longAgo);
    writeFileSync(path.join(dir, "README.txt"), "not a case");

    const removed = await store.expire(at(CASE_TTL_MS + 1));
    expect(removed).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(["README.txt", `${live.record.id}.jpg`, `${live.record.id}.json`].sort());
  });

  it("sweeps opportunistically when a new case is created", async () => {
    const old = await create(T0);
    const s2 = new FileCaseStore(dir); // fresh instance: its first create() sweeps
    await s2.create(INPUT, { bytes: JPEG, mime: "image/jpeg" }, at(CASE_TTL_MS + 5));
    expect(readdirSync(dir).some((n) => n.startsWith(old.record.id))).toBe(false);
  });

  it("returns 0 when the directory does not exist yet", async () => {
    expect(await new FileCaseStore(path.join(dir, "missing")).expire(T0)).toBe(0);
  });
});

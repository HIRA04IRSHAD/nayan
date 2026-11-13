// Server-side storage for caregiver cases ("परिवार से पूछें").
//
// CaseStore is the seam: the API routes only talk to this interface. FileCaseStore keeps each case as files
// under data/cases/ (works locally and on a normal Node server with a disk). Serverless hosting such as Vercel
// has no persistent disk (each request may land on a fresh instance), so production there needs a database
// implementation of the same interface (Supabase is the planned option; see README "Family confirmation").
//
// Security model:
// - id: 128 random bits (hex). token: 192 random bits (base64url), given only to the patient's phone, which
//   puts it in the caregiver's link. Viewing, the photo and answering all need the token.
// - Only a SHA-256 hash of the token is stored, so a copy of data/cases/ alone cannot answer a case. The hash
//   is compared in constant time.
// - A wrong token, an unknown id and a malformed id all look the same ("not_found"); "expired" is only
//   reported to someone who holds the right token.
// - Cases expire after 48 h: never served after that, deleted when touched, and swept opportunistically.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CASE_ID_RE, CASE_TTL_MS, TOKEN_RE, type CaseAnswer, type CaseView, type CreateCaseInput, type PhotoMime } from "./case-schema";

export interface CasePhoto {
  bytes: Buffer;
  mime: PhotoMime;
}

/** Everything about a case except the photo bytes and the token hash. */
export interface CaseRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  photoMime: PhotoMime;
  caregiverName: string;
  itemLines: string[];
  whatNayanRead: string;
  verdictText: string;
  answer?: StoredAnswer;
}

export interface StoredAnswer {
  answer: CaseAnswer;
  itemIndex: number | null;
  note: string;
  answeredAt: string;
}

export type NewCase = Omit<CreateCaseInput, "photo" | "mime">;
export type AnswerInput = Omit<StoredAnswer, "answeredAt">;

export type Found<T> = { ok: true; value: T } | { ok: false; reason: "not_found" | "expired" };
export type AnswerResult = Found<CaseRecord> | { ok: false; reason: "already_answered"; value: CaseRecord };

export interface CaseStore {
  create(input: NewCase, photo: CasePhoto, now?: Date): Promise<{ record: CaseRecord; token: string }>;
  get(id: string, token: string, now?: Date): Promise<Found<CaseRecord>>;
  getPhoto(id: string, token: string, now?: Date): Promise<Found<CasePhoto>>;
  /** Record the caregiver's answer. Only the first answer counts; later ones get "already_answered". */
  answer(id: string, token: string, input: AnswerInput, now?: Date): Promise<AnswerResult>;
  /** Delete every expired case. Returns how many were removed. */
  expire(now?: Date): Promise<number>;
}

/** Too many live cases on disk: refuse new ones instead of filling the disk (anyone can call POST /api/cases). */
export class CaseStoreFullError extends Error {
  constructor() {
    super("case store full");
  }
}

export function newCaseId(): string {
  return randomBytes(16).toString("hex");
}

export function newCaseToken(): string {
  return randomBytes(24).toString("base64url");
}

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest();

/** Constant-time check of a presented token against the stored hash (hex). */
export function tokenMatches(token: string, storedHashHex: string): boolean {
  if (!TOKEN_RE.test(token) || !/^[0-9a-f]{64}$/.test(storedHashHex)) return false;
  return timingSafeEqual(hashToken(token), Buffer.from(storedHashHex, "hex"));
}

export const isExpired = (r: Pick<CaseRecord, "expiresAt">, now: Date) => now.getTime() >= Date.parse(r.expiresAt);

/** The public view of a case (no photo bytes, no token hash). */
export function toView(r: CaseRecord): CaseView {
  const base: CaseView = {
    id: r.id,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    caregiverName: r.caregiverName,
    itemLines: r.itemLines,
    whatNayanRead: r.whatNayanRead,
    verdictText: r.verdictText,
    status: r.answer ? "answered" : "waiting",
  };
  if (!r.answer) return base;
  return { ...base, answer: r.answer.answer, itemIndex: r.answer.itemIndex, note: r.answer.note, answeredAt: r.answer.answeredAt };
}

const EXT: Record<PhotoMime, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

interface RecordFile extends Omit<CaseRecord, "answer"> {
  tokenHash: string;
}

export interface FileCaseStoreOptions {
  /** Refuse new cases while this many are stored (expired ones are swept first). */
  maxCases?: number;
  /** Sweep expired cases on create() at most this often. */
  sweepEveryMs?: number;
}

/**
 * One case = three files in `dir`:
 *   <id>.json         the record (with the token hash), written atomically (temp file + rename)
 *   <id>.jpg|png|webp the photo
 *   <id>.answer.json  the answer, created with the exclusive "wx" flag, so even two processes racing to
 *                     answer cannot both succeed: the file system decides who was first.
 */
export class FileCaseStore implements CaseStore {
  private lastSweep = 0;
  private readonly maxCases: number;
  private readonly sweepEveryMs: number;

  constructor(
    readonly dir: string,
    opts: FileCaseStoreOptions = {},
  ) {
    this.maxCases = opts.maxCases ?? 500;
    this.sweepEveryMs = opts.sweepEveryMs ?? 10 * 60 * 1000;
  }

  private file(id: string, suffix: string) {
    return path.join(this.dir, `${id}${suffix}`);
  }

  async create(input: NewCase, photo: CasePhoto, now = new Date()) {
    await mkdir(this.dir, { recursive: true });
    if (now.getTime() - this.lastSweep >= this.sweepEveryMs) {
      this.lastSweep = now.getTime();
      await this.expire(now).catch(() => 0);
    }
    if ((await this.recordIds()).length >= this.maxCases) throw new CaseStoreFullError();

    const id = newCaseId();
    const token = newCaseToken();
    const record: CaseRecord = {
      id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CASE_TTL_MS).toISOString(),
      photoMime: photo.mime,
      caregiverName: input.caregiverName,
      itemLines: input.itemLines,
      whatNayanRead: input.whatNayanRead,
      verdictText: input.verdictText,
    };
    const onDisk: RecordFile = { ...record, tokenHash: hashToken(token).toString("hex") };
    // Photo first, record last: a case becomes visible only once both are complete.
    await writeFile(this.file(id, `.${EXT[photo.mime]}`), photo.bytes, { flag: "wx" });
    const tmp = this.file(id, ".json.tmp");
    await writeFile(tmp, JSON.stringify(onDisk), { flag: "wx" });
    await rename(tmp, this.file(id, ".json"));
    return { record, token };
  }

  /** The record if the id is well-formed, the token is right and the case has not expired. */
  private async open(id: string, token: string, now: Date): Promise<Found<CaseRecord>> {
    if (!CASE_ID_RE.test(id) || !TOKEN_RE.test(token)) return { ok: false, reason: "not_found" };
    const raw = await this.readRecordFile(id);
    if (!raw || !tokenMatches(token, raw.tokenHash)) return { ok: false, reason: "not_found" };
    if (isExpired(raw, now)) {
      await this.remove(id).catch(() => undefined);
      return { ok: false, reason: "expired" };
    }
    const { tokenHash: _hash, ...record } = raw;
    const answer = await this.readAnswer(id);
    return { ok: true, value: answer ? { ...record, answer } : record };
  }

  get(id: string, token: string, now = new Date()) {
    return this.open(id, token, now);
  }

  async getPhoto(id: string, token: string, now = new Date()): Promise<Found<CasePhoto>> {
    const found = await this.open(id, token, now);
    if (!found.ok) return found;
    try {
      const bytes = await readFile(this.file(id, `.${EXT[found.value.photoMime]}`));
      return { ok: true, value: { bytes, mime: found.value.photoMime } };
    } catch {
      return { ok: false, reason: "not_found" };
    }
  }

  async answer(id: string, token: string, input: AnswerInput, now = new Date()): Promise<AnswerResult> {
    const found = await this.open(id, token, now);
    if (!found.ok) return found;
    if (found.value.answer) return { ok: false, reason: "already_answered", value: found.value };
    const stored: StoredAnswer = { ...input, answeredAt: now.toISOString() };
    try {
      await writeFile(this.file(id, ".answer.json"), JSON.stringify(stored), { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const again = await this.open(id, token, now);
      if (again.ok && again.value.answer) return { ok: false, reason: "already_answered", value: again.value };
      return again.ok ? { ok: false, reason: "not_found" } : again;
    }
    return { ok: true, value: { ...found.value, answer: stored } };
  }

  async expire(now = new Date()): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    const ids = new Set(names.map((n) => n.slice(0, 32)).filter((id) => CASE_ID_RE.test(id)));
    let removed = 0;
    for (const id of ids) {
      const rec = await this.readRecordFile(id);
      // No readable record (half-written or damaged): remove its files once they are older than the TTL.
      const gone = rec ? isExpired(rec, now) : await this.allOlderThan(id, names, now.getTime() - CASE_TTL_MS);
      if (gone) {
        await this.remove(id, names).catch(() => undefined);
        removed++;
      }
    }
    return removed;
  }

  private async recordIds(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((n) => /^[0-9a-f]{32}\.json$/.test(n)).map((n) => n.slice(0, 32));
    } catch {
      return [];
    }
  }

  private async readRecordFile(id: string): Promise<RecordFile | null> {
    try {
      const r = JSON.parse(await readFile(this.file(id, ".json"), "utf8")) as RecordFile;
      return typeof r?.tokenHash === "string" && typeof r.expiresAt === "string" && r.id === id ? r : null;
    } catch {
      return null;
    }
  }

  private async readAnswer(id: string): Promise<StoredAnswer | undefined> {
    try {
      return JSON.parse(await readFile(this.file(id, ".answer.json"), "utf8")) as StoredAnswer;
    } catch {
      return undefined;
    }
  }

  private async allOlderThan(id: string, names: string[], cutoffMs: number): Promise<boolean> {
    for (const n of names.filter((x) => x.startsWith(id))) {
      try {
        if ((await stat(path.join(this.dir, n))).mtimeMs > cutoffMs) return false;
      } catch {
        /* already gone */
      }
    }
    return true;
  }

  private async remove(id: string, names?: string[]) {
    const all = names ?? (await readdir(this.dir));
    await Promise.all(all.filter((n) => n.startsWith(id)).map((n) => rm(path.join(this.dir, n), { force: true })));
  }
}

/** Where cases live: NAYAN_CASES_DIR (tests, custom deployments) or data/cases/ in the project. */
export function casesDir(): string {
  return process.env.NAYAN_CASES_DIR || path.join(process.cwd(), "data", "cases");
}

const stores = new Map<string, CaseStore>();
/** The store the API routes use. One instance per directory, so the sweep timer is shared between requests. */
export function getCaseStore(): CaseStore {
  const dir = casesDir();
  let s = stores.get(dir);
  if (!s) {
    s = new FileCaseStore(dir);
    stores.set(dir, s);
  }
  return s;
}

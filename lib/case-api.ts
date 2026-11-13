// HTTP handlers for caregiver cases. The route files under app/api/cases/ are one-line wrappers around these,
// so tests can call them with plain Request objects and a store in a temp directory.
//
// Every response is no-store: a case is private and changes when it is answered.

import { ZodError } from "zod";
import {
  answerCaseZ,
  caseUrl,
  createCaseZ,
  MAX_CREATE_BODY,
  MAX_PHOTO_BYTES,
  type CreatedCase,
  type PhotoMime,
} from "./case-schema";
import { CaseStoreFullError, toView, type CaseStore, type Found } from "./case-store";

const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

/** Unknown id and wrong token look the same; "expired" is only told to someone holding the right token. */
function notFound(r: Extract<Found<unknown>, { ok: false }>): Response {
  return r.reason === "expired" ? fail("expired", 410) : fail("not_found", 404);
}

/** Read a JSON body with a size limit (checked on the header and again on the text actually received). */
export async function readJson(req: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, res: fail("too_large", 413) };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, res: fail("bad_body", 400) };
  }
  if (text.length > maxBytes) return { ok: false, res: fail("too_large", 413) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: fail("bad_json", 400) };
  }
}

const issues = (e: ZodError) => e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`);

/** Does the file really start like the image type it claims to be? (The mime field alone is just a claim.) */
export function sniffMatches(bytes: Uint8Array, mime: PhotoMime): boolean {
  const at = (i: number, ...b: number[]) => b.every((v, k) => bytes[i + k] === v);
  switch (mime) {
    case "image/jpeg":
      return at(0, 0xff, 0xd8, 0xff);
    case "image/png":
      return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50); // "RIFF" .... "WEBP"
  }
}

/** Base64 → bytes, enforcing the size limit and the image signature. */
export function decodePhoto(base64: string, mime: PhotoMime): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) return { ok: false, error: "bad_photo" };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: "photo_too_large" };
  if (!sniffMatches(bytes, mime)) return { ok: false, error: "bad_photo" };
  return { ok: true, bytes };
}

/** Origin for the caregiver link: NAYAN_PUBLIC_URL when set (behind a proxy), else the request's own origin. */
function publicOrigin(req: Request): string {
  const configured = process.env.NAYAN_PUBLIC_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : new URL(req.url).origin;
}

/** POST /api/cases → 201 { id, token, url, expiresAt } */
export async function createCase(req: Request, store: CaseStore): Promise<Response> {
  const read = await readJson(req, MAX_CREATE_BODY);
  if (!read.ok) return read.res;
  const parsed = createCaseZ.safeParse(read.body);
  if (!parsed.success) return fail("invalid", 400, { issues: issues(parsed.error) });
  const { photo, mime, ...input } = parsed.data;
  const decoded = decodePhoto(photo, mime);
  if (!decoded.ok) return fail(decoded.error, decoded.error === "photo_too_large" ? 413 : 400);
  try {
    const { record, token } = await store.create(input, { bytes: decoded.bytes, mime });
    const body: CreatedCase = { id: record.id, token, url: caseUrl(publicOrigin(req), record.id, token), expiresAt: record.expiresAt };
    return json(body, 201);
  } catch (e) {
    if (e instanceof CaseStoreFullError) return fail("store_full", 503);
    console.error(e);
    return fail("store_failed", 500);
  }
}

/** Request header that carries the case token (see tokenParam). */
export const CASE_TOKEN_HEADER = "x-case-token";

/**
 * The token comes in a header, not the URL: request URLs (query included) end up in server, proxy and host access
 * logs, and a logged token would let anyone reading them view and answer the case. "?t=" is still accepted so a
 * page loaded before this change keeps working, but Nayan's own clients no longer send it.
 */
const tokenParam = (req: Request) => req.headers.get(CASE_TOKEN_HEADER) ?? new URL(req.url).searchParams.get("t") ?? "";

/** GET /api/cases/[id] (token in the x-case-token header) → the case without photo bytes. */
export async function getCase(req: Request, id: string, store: CaseStore): Promise<Response> {
  const found = await store.get(id, tokenParam(req));
  return found.ok ? json(toView(found.value)) : notFound(found);
}

/** GET /api/cases/[id]/photo (token in the x-case-token header) → the image bytes. */
export async function getCasePhoto(req: Request, id: string, store: CaseStore): Promise<Response> {
  const found = await store.getPhoto(id, tokenParam(req));
  if (!found.ok) return notFound(found);
  return new Response(new Uint8Array(found.value.bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      "content-type": found.value.mime,
      "content-length": String(found.value.bytes.length),
      "content-disposition": "inline",
      // The bytes are only ever shown as an image; forbid anything else even if a browser sniffed them.
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}

/** POST /api/cases/[id]/answer { t, answer, itemIndex?, note? } → the answered case; a second answer → 409. */
export async function answerCase(req: Request, id: string, store: CaseStore): Promise<Response> {
  const read = await readJson(req, 8 * 1024);
  if (!read.ok) return read.res;
  const parsed = answerCaseZ.safeParse(read.body);
  if (!parsed.success) return fail("invalid", 400, { issues: issues(parsed.error) });
  const { t, answer, itemIndex, note } = parsed.data;

  const found = await store.get(id, t);
  if (!found.ok) return notFound(found);
  if (itemIndex != null && itemIndex >= found.value.itemLines.length) return fail("invalid", 400, { issues: ["itemIndex: out of range"] });

  // "Which medicine is it?" only means something for a "correct" answer.
  const res = await store.answer(id, t, { answer, itemIndex: answer === "correct" ? (itemIndex ?? null) : null, note: note ?? "" });
  if (res.ok) return json(toView(res.value));
  if (res.reason === "already_answered") return fail("already_answered", 409, { case: toView(res.value) });
  return notFound(res);
}

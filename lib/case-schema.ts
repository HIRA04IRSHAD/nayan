// The caregiver case ("परिवार से पूछें") as it crosses the network: limits, request schemas and the public view.
//
// Shared by the API (lib/case-api.ts), the file store (lib/case-store.ts), the patient's phone and the
// caregiver page, so both sides agree on one definition. No Node-only imports here: this file is bundled
// into the browser too.

import { z } from "zod";

/** A case (its photo, text and answer) lives this long, then it is no longer served and is deleted. */
export const CASE_TTL_MS = 48 * 60 * 60 * 1000;

/** Photo limit after base64 decoding. The phone sends a ~1600px JPEG (usually 300–700 KB). */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Base64 length of MAX_PHOTO_BYTES (4 characters per 3 bytes, plus padding). */
export const MAX_PHOTO_BASE64 = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;
/** Whole request body limit for POST /api/cases: the photo plus a little text. Checked before parsing. */
export const MAX_CREATE_BODY = MAX_PHOTO_BASE64 + 64 * 1024;

export const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoMime = (typeof PHOTO_MIMES)[number];

export const LIMITS = {
  /** Prescription lines sent with a case. */
  lines: 30,
  line: 300,
  whatNayanRead: 600,
  verdictText: 600,
  caregiverName: 60,
  note: 300,
  token: 128,
} as const;

/** Case ids are 128 random bits in lowercase hex: safe as a file name on every OS (Windows is case-insensitive). */
export const CASE_ID_RE = /^[0-9a-f]{32}$/;
/** Tokens are base64url. Checked before any hashing or disk access. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

// Control characters other than newline and tab are never meaningful here and can confuse logs or rendering.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const clean = (s: string) => s.replace(CONTROL_CHARS, "").trim();
/** A string limited before cleaning (so huge input is rejected cheaply) and trimmed after. */
const text = (max: number) => z.string().max(max).transform(clean);
const nonEmptyText = (max: number) => text(max).pipe(z.string().min(1));

export const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** POST /api/cases body. Unknown keys are refused so a typo never silently drops data. */
export const createCaseZ = z
  .object({
    photo: z.string().min(1).max(MAX_PHOTO_BASE64).regex(BASE64_RE, "photo must be base64"),
    mime: z.enum(PHOTO_MIMES),
    itemLines: z.array(nonEmptyText(LIMITS.line)).min(1).max(LIMITS.lines),
    whatNayanRead: text(LIMITS.whatNayanRead),
    verdictText: text(LIMITS.verdictText),
    caregiverName: text(LIMITS.caregiverName).default(""),
  })
  .strict();
export type CreateCaseBody = z.input<typeof createCaseZ>;
export type CreateCaseInput = z.output<typeof createCaseZ>;

export const CASE_ANSWERS = ["correct", "wrong"] as const;
export type CaseAnswer = (typeof CASE_ANSWERS)[number];

/** POST /api/cases/[id]/answer body. */
export const answerCaseZ = z
  .object({
    t: z.string().min(1).max(LIMITS.token),
    answer: z.enum(CASE_ANSWERS),
    itemIndex: z.number().int().min(0).max(LIMITS.lines - 1).nullable().optional(),
    note: text(LIMITS.note).optional(),
  })
  .strict();
export type AnswerCaseBody = z.input<typeof answerCaseZ>;

/** What the server returns from POST /api/cases. */
export const createdCaseZ = z.object({
  id: z.string().regex(CASE_ID_RE),
  token: z.string().regex(TOKEN_RE),
  url: z.string().url(),
  expiresAt: z.string(),
});
export type CreatedCase = z.infer<typeof createdCaseZ>;

/** The case as shown to the caregiver and polled by the patient's phone. Never contains the photo or the token. */
export const caseViewZ = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  caregiverName: z.string(),
  itemLines: z.array(z.string()),
  whatNayanRead: z.string(),
  verdictText: z.string(),
  status: z.enum(["waiting", "answered"]),
  answer: z.enum(CASE_ANSWERS).optional(),
  /** Which prescription line the caregiver says the strip is (only kept with a "correct" answer). */
  itemIndex: z.number().int().nullable().optional(),
  note: z.string().optional(),
  answeredAt: z.string().optional(),
});
export type CaseView = z.infer<typeof caseViewZ>;

/**
 * The caregiver's link. The token goes in the #fragment: browsers never send it to the server with the page
 * request or in a Referer, and WhatsApp's link-preview fetch never sees it. The page reads it from the fragment.
 */
export function caseUrl(origin: string, id: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/c/${id}#t=${token}`;
}

/** Read the token from the caregiver link: "#t=…" (current) or "?t=…" (typed/forwarded by hand). */
export function tokenFromLocation(hash: string, search: string): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  const t = fromHash ?? new URLSearchParams(search).get("t");
  return t && TOKEN_RE.test(t) ? t : null;
}

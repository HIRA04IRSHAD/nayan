// POST /api/extract: photo → Gemini → fixed JSON fields. app/api/extract/route.ts is a one-line wrapper around
// handleExtract, so tests can call it with plain Request objects and fake extractors (no real Gemini calls).
//
// The body is untrusted: it is read with a size limit, validated with zod (known kind, base64 image within the
// limit, an image type Gemini accepts), and anything else gets a 400 instead of an unhandled 500 or an
// arbitrary mime type forwarded upstream.

import { z } from "zod";
import { readJson } from "./case-api";
import { extract, extractBlister, MissingKeyError } from "./gemini";

/** Base64 length limit for the photo (~6 MB of image). The phone sends a resized JPEG well under this. */
export const MAX_BASE64 = 8 * 1024 * 1024;
/** The whole JSON body: the image plus a little room for the other fields. */
const MAX_BODY = MAX_BASE64 + 4096;

/** Image types Gemini reads. The phone always sends JPEG; the eval script may send PNG, WebP or HEIC. */
export const EXTRACT_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

export const extractRequestZ = z
  .object({
    kind: z.enum(["prescription", "strip", "blister"]),
    image: z
      .string()
      .min(1)
      .max(MAX_BASE64)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "not base64"),
    // Older clients sent no type: the phone's photos are JPEG.
    mimeType: z.enum(EXTRACT_MIMES).optional().default("image/jpeg"),
  })
  .strict();

export interface ExtractDeps {
  extract: typeof extract;
  extractBlister: typeof extractBlister;
}

const DEFAULT_DEPS: ExtractDeps = { extract, extractBlister };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function handleExtract(req: Request, deps: ExtractDeps = DEFAULT_DEPS): Promise<Response> {
  const read = await readJson(req, MAX_BODY);
  if (!read.ok) return read.res;
  const parsed = extractRequestZ.safeParse(read.body);
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((i) => i.path[0] === "image" && i.code === "too_big");
    return json({ error: tooBig ? "image too large" : "bad request" }, tooBig ? 413 : 400);
  }
  const { kind, image, mimeType } = parsed.data;
  try {
    // "blister" = two independent pocket counts of the same photo; the phone's rules need both to agree.
    return json(kind === "blister" ? await deps.extractBlister(image, mimeType) : await deps.extract(kind, image, mimeType));
  } catch (e) {
    if (e instanceof MissingKeyError) return json({ error: "no_key" }, 503);
    console.error(e);
    // Every model refused because the service is overloaded or the free quota is used up: not the user's fault.
    const busy = e instanceof Error && / (429|503)\b/.test(e.message) && !/ 400\b/.test(e.message);
    return json({ error: busy ? "busy" : "extract_failed" }, busy ? 503 : 502);
  }
}

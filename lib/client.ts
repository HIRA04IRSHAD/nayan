// Browser-side helpers: image capture, API calls, cached medicine lookups.
import type { BlisterReading, PrescriptionItem, StripReading } from "./types";
import { lookupFromMap, type BrandMatch, type DrugLookup } from "./drugdb";
import { newId } from "./id";

export interface PreparedImage {
  base64: string;
  mimeType: string;
  blob: Blob;
}

/** Downscale to keep uploads small on mobile data; text stays legible at 1600px. */
export async function prepareImage(file: File, maxSide = 1600): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return encodeCanvas(canvas);
}

async function encodeCanvas(canvas: HTMLCanvasElement): Promise<PreparedImage> {
  const blob: Blob = await new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("encode"))), "image/jpeg", 0.88));
  const dataUrl: string = await new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = () => fail(new Error("encode"));
    r.readAsDataURL(blob);
  });
  return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg", blob };
}

/**
 * A stand-in "photo" for the demo strips (which have no camera photo), so the whole family loop can be tried
 * without a camera or Gemini. It is clearly labelled as a demo picture, not a real strip.
 */
export async function drawDemoStripPhoto(title: string, lines: string[]): Promise<PreparedImage> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 260 + lines.length * 70;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#e9edf2";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#ffffff";
  g.fillRect(40, 40, canvas.width - 80, canvas.height - 80);
  g.fillStyle = "#12141a";
  g.font = "bold 56px sans-serif";
  g.fillText(title, 80, 130);
  g.font = "40px sans-serif";
  lines.forEach((l, i) => g.fillText(l, 80, 210 + i * 70, canvas.width - 160));
  g.fillStyle = "#8f5d00";
  g.font = "bold 34px sans-serif";
  g.fillText("DEMO / डेमो — not a real photo", 80, canvas.height - 70);
  return encodeCanvas(canvas);
}

export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function post<T>(kind: "prescription" | "strip" | "blister", img: PreparedImage): Promise<T> {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, image: img.base64, mimeType: img.mimeType }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `http_${res.status}`);
  return body as T;
}

type RawPrescription = { items: (Omit<PrescriptionItem, "id"> & { confidence: number })[] };

export async function readPrescription(img: PreparedImage): Promise<(PrescriptionItem & { confidence: number })[]> {
  const data = await post<RawPrescription>("prescription", img);
  return data.items.map((i) => ({ ...i, id: newId() }));
}

export const readStrip = (img: PreparedImage) => post<StripReading>("strip", img);

/** Two independent pocket counts of the back of a strip (null where one read failed). lib/blister.ts decides. */
export async function readBlister(img: PreparedImage): Promise<[BlisterReading | null, BlisterReading | null]> {
  const { reads } = await post<{ reads?: unknown }>("blister", img);
  const ok = (r: unknown): r is BlisterReading =>
    typeof r === "object" &&
    r !== null &&
    typeof (r as BlisterReading).total_pockets === "number" &&
    typeof (r as BlisterReading).empty_pockets === "number" &&
    typeof (r as BlisterReading).whole_strip_visible === "boolean" &&
    typeof (r as BlisterReading).confidence === "number";
  const list = Array.isArray(reads) ? reads : [];
  // Anything malformed counts as a failed read, which the rules turn into "not sure".
  return [ok(list[0]) ? list[0] : null, ok(list[1]) ? list[1] : null];
}

// Brand lookups come from the server (the full medicine index is too big for a phone). Answers are cached.
const lookupCache = new Map<string, BrandMatch | null>();
export const cachedLookup: DrugLookup = lookupFromMap(lookupCache);

/** Make sure these names have been looked up. On a network error the names stay unknown ("not sure"). */
export async function fetchLookups(names: (string | null | undefined)[]): Promise<DrugLookup> {
  const missing = [...new Set(names.filter((n): n is string => !!n && !lookupCache.has(n)))].slice(0, 50);
  if (missing.length) {
    try {
      const res = await fetch("/api/drugs/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ names: missing }),
      });
      if (res.ok) {
        const { results } = (await res.json()) as { results: Record<string, BrandMatch | null> };
        for (const name of missing) lookupCache.set(name, results[name] ?? null);
      }
    } catch {
      /* offline: leave uncached so a later attempt can succeed */
    }
  }
  return cachedLookup;
}

// The prescription and everything else saved on the phone live in lib/store.ts (key "nayan.state.v2").

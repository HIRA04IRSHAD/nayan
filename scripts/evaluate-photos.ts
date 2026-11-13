// Run real photos through the same pipeline the app uses: /api/extract (Gemini) → rule engine.
//
//   npm run dev                         (in another terminal)
//   npm run eval -- ../test-photos      (folder of photos)
//
// Files whose name contains "rx", "prescription" or "parcha" are read as prescriptions; everything
// else is read as a strip. With no prescription photo the demo prescription (Dolo 650, Pan 40, Telma 40) is used.
// Results go to <folder>/results.json for the accuracy tables in the evaluation plan.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { PrescriptionItem, StripReading } from "@/lib/types";
import { checkAgainstPrescription } from "@/lib/rules";
import { serverLookup } from "@/lib/drugdb-server";
import { describeItem, verdictEnglish, verdictText } from "@/lib/messages";
import { DEMO_PRESCRIPTION } from "@/lib/fixtures";

const BASE = process.env.NAYAN_URL ?? "http://localhost:3000";
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic" };
const isPrescription = (name: string) => /rx|prescription|parcha|parchi/i.test(name);

async function extract(kind: "prescription" | "strip", file: string) {
  const image = readFileSync(file).toString("base64");
  const t = Date.now();
  const res = await fetch(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, image, mimeType: MIME[extname(file).toLowerCase()] }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body.error}`);
  return { body, ms: Date.now() - t };
}

async function main() {
  const dir = resolve(process.argv[2] ?? "../test-photos");
  const files = readdirSync(dir).filter((f) => MIME[extname(f).toLowerCase()]).sort();
  const results: Record<string, unknown>[] = [];
  let items: PrescriptionItem[] = DEMO_PRESCRIPTION;
  let rxSource = "demo prescription";

  for (const f of files.filter(isPrescription)) {
    console.log(`\n=== Prescription: ${f}`);
    try {
      const { body, ms } = await extract("prescription", join(dir, f));
      items = (body.items as (PrescriptionItem & { confidence: number })[]).map((i, n) => ({ ...i, id: `rx${n + 1}` }));
      rxSource = f;
      console.log(`(${ms} ms)`);
      body.items.forEach((i: PrescriptionItem & { confidence: number }, n: number) =>
        console.log(`  ${describeItem(items[n], n, serverLookup)}   [confidence ${i.confidence}]`),
      );
      results.push({ file: f, kind: "prescription", ms, reading: body });
    } catch (e) {
      console.log(`  FAILED: ${(e as Error).message}`);
      results.push({ file: f, kind: "prescription", error: (e as Error).message });
    }
  }
  console.log(`\nStrips are checked against: ${rxSource} (treated as confirmed)`);

  for (const f of files.filter((f) => !isPrescription(f))) {
    console.log(`\n=== Strip: ${f}`);
    try {
      const { body, ms } = await extract("strip", join(dir, f));
      const reading = body as StripReading;
      const res = checkAgainstPrescription(items, [reading], serverLookup);
      const item = items.find((i) => i.id === res.itemId);
      console.log(`(${ms} ms)`);
      console.log(`  brand:       ${reading.brand.value}  [${reading.brand.confidence}]`);
      console.log(`  ingredients: ${reading.ingredients.value.map((i) => `${i.salt} ${i.strength ?? "?"}`).join(" + ") || "—"}  [${reading.ingredients.confidence}]`);
      console.log(`  form:        ${reading.form.value}  [${reading.form.confidence}]`);
      console.log(`  expiry:      ${reading.expiry.value}  [${reading.expiry.confidence}]`);
      console.log(`  → ${verdictEnglish(res)}`);
      console.log(`  → ${verdictText(res, item)}`);
      results.push({ file: f, kind: "strip", ms, reading, verdict: res });
    } catch (e) {
      console.log(`  FAILED: ${(e as Error).message}`);
      results.push({ file: f, kind: "strip", error: (e as Error).message });
    }
  }

  writeFileSync(join(dir, "results.json"), JSON.stringify({ prescription: rxSource, items, results }, null, 2));
  console.log(`\nSaved ${join(dir, "results.json")}`);
}

main();

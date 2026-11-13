// Server only. Loads the full medicine index built by data/build_drugdb.py (≈254k medicines, 4.4 MB gzipped)
// once per server process.
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { DosageForm } from "./types";
import { buildIndex, lookupInIndex, type BrandMatch, type DrugEntry, type DrugIndex } from "./drugdb";

interface CompactEntry {
  b: string;
  n: string;
  f: DosageForm;
  v?: string;
  i: [string, string | null][];
  c?: 0;
  d?: 1;
}

export const INDEX_PATH = path.join(process.cwd(), "data", "medicines.json.gz");

const cache = globalThis as unknown as { __nayanDrugIndex?: { index: DrugIndex; count: number } };

export function loadServerIndex(file = INDEX_PATH): { index: DrugIndex; count: number } {
  if (cache.__nayanDrugIndex) return cache.__nayanDrugIndex;
  const data = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as { medicines: CompactEntry[] };
  const entries: DrugEntry[] = data.medicines.map((m) => ({
    brand: m.b,
    form: m.f,
    variant: m.v ?? null,
    ingredients: m.i.map(([salt, strength]) => ({ salt, strength })),
    discontinued: m.d === 1,
    complete: m.c !== 0,
  }));
  cache.__nayanDrugIndex = { index: buildIndex(entries), count: entries.length };
  return cache.__nayanDrugIndex;
}

export function serverLookup(name: string | null | undefined): BrandMatch | null {
  return lookupInIndex(loadServerIndex().index, name);
}

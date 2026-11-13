// Brand → salts lookup. Pure functions over an index, so the same code runs on the server (full Kaggle index,
// lib/drugdb-server.ts) and in tests (the small seed list in data/drugs.json).
import type { DosageForm, Ingredient } from "./types";
import { compositionKey, levenshtein, normalizeMedicineName } from "./normalize";

export interface DrugEntry {
  brand: string;
  form: DosageForm;
  /** Release type (sr, er, dt …): a different product even with the same salt. */
  variant?: string | null;
  ingredients: Ingredient[];
  discontinued?: boolean;
  /** False when the source dropped a 3rd salt or a kit's drugs — never use such an entry to confirm a match. */
  complete?: boolean;
}

export interface BrandMatch {
  entry: DrugEntry;
  /** 1 for an exact (normalised) name match or an exact strength-derived match, lower for a fuzzy one. */
  score: number;
}

/** What the rules need: given a printed or written name, the medicine it identifies (or null). */
export type DrugLookup = (name: string | null | undefined) => BrandMatch | null;

export interface DrugIndex {
  byName: Map<string, DrugEntry[]>;
  /** Fuzzy candidates grouped by the numbers in their name ("telma 40" → "40"). */
  byDigits: Map<string, { key: string; letters: string }[]>;
}

const FUZZY_MIN = 0.85;

const tokens = (key: string) => key.split(" ");
const isNum = (t: string) => /^[0-9]/.test(t);
const digitsOf = (key: string) => tokens(key).filter(isNum).join(" ");
const lettersOf = (key: string) => tokens(key).filter((t) => !isNum(t)).join(" ");

export function buildIndex(entries: Iterable<DrugEntry>): DrugIndex {
  const byName = new Map<string, DrugEntry[]>();
  for (const e of entries) {
    const key = normalizeMedicineName(e.brand);
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(e);
    else byName.set(key, [e]);
  }
  const byDigits = new Map<string, { key: string; letters: string }[]>();
  for (const key of byName.keys()) {
    const d = digitsOf(key);
    const list = byDigits.get(d);
    const item = { key, letters: lettersOf(key) };
    if (list) list.push(item);
    else byDigits.set(d, [item]);
  }
  return { byName, byDigits };
}

/**
 * One medicine for a name, or null when there is none or the name is ambiguous (several different
 * compositions under the same name). Discontinued and incomplete entries are used only if nothing else fits.
 */
function pick(entries: DrugEntry[]): DrugEntry | null {
  const usable = entries.filter((e) => e.complete !== false);
  const active = usable.filter((e) => !e.discontinued);
  const pool = active.length ? active : usable;
  if (!pool.length) return null;
  const identity = (e: DrugEntry) => `${compositionKey(e.ingredients)}|${e.form}|${e.variant ?? ""}`;
  const first = identity(pool[0]);
  return pool.every((e) => identity(e) === first) ? pool[0] : null;
}

/** Strength numbers of a single-salt entry: "40mg" → ["40"]. */
function strengthNumbers(e: DrugEntry): string[] {
  return e.ingredients.map((i) => (i.strength ?? "").match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? "");
}

export function lookupInIndex(index: DrugIndex, name: string | null | undefined): BrandMatch | null {
  if (!name) return null;
  const key = normalizeMedicineName(name);
  if (!key) return null;

  // 1. Exact name.
  const exact = index.byName.get(key);
  if (exact) {
    const entry = pick(exact);
    return entry ? { entry, score: 1 } : null;
  }

  const digits = digitsOf(key);
  const letters = lettersOf(key);

  // 2. Brand whose database name has no number ("Pantocid Tablet") written with its strength ("Pantocid 40").
  //    Accepted only when that number is exactly the medicine's strength — still an exact identification.
  if (digits && letters) {
    const plain = index.byName.get(letters);
    const entry = plain ? pick(plain) : null;
    if (entry && entry.ingredients.length === 1 && strengthNumbers(entry)[0] === digits) return { entry, score: 1 };
  }

  // 3. Small spelling differences in the letters. Numbers must match exactly ("Telma 40" never becomes "Telma 80").
  if (!letters) return null;
  const scored = (index.byDigits.get(digits) ?? [])
    .map((c) => ({ key: c.key, score: 1 - levenshtein(letters, c.letters) / Math.max(letters.length, c.letters.length, 1) }))
    .filter((c) => c.score >= FUZZY_MIN)
    .sort((a, b) => b.score - a.score);
  if (!scored.length || (scored.length > 1 && scored[1].score === scored[0].score)) return null;
  const entry = pick(index.byName.get(scored[0].key)!);
  return entry ? { entry, score: scored[0].score } : null;
}

export const lookupWith = (index: DrugIndex): DrugLookup => (name) => lookupInIndex(index, name);

/** Lookup backed by answers fetched from the server (the browser cannot hold 250k medicines). */
export function lookupFromMap(results: Map<string, BrandMatch | null>): DrugLookup {
  return (name) => (name ? (results.get(name) ?? null) : null);
}

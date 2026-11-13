// The rule engine. The vision model only fills fields; every verdict is decided here, the same way every time.
// Safety invariant: "match" is returned only when salt(s), strength(s), form and expiry were all read
// confidently (or identically in two scans) and all agree with the confirmed prescription.

import type { CheckResult, Confident, DosageForm, Ingredient, PrescriptionItem, Reason, StripReading } from "./types";
import { compareStrength, isExpired, normalizeSalt, parseExpiry, type YearMonth } from "./normalize";
import type { DrugLookup } from "./drugdb";

export const CONFIDENCE_THRESHOLD = 0.85;

interface Resolved {
  ingredients: Ingredient[];
  form: DosageForm | null;
}

interface StripField<T> {
  value: T | null;
  reason?: Reason;
}

export interface MergedStrip {
  brand: string | null;
  ingredients: StripField<Ingredient[]>;
  form: StripField<DosageForm>;
  expiry: StripField<YearMonth>;
}

/** Salts and form of a confirmed prescription line, from what the doctor wrote or from the brand database. */
export function resolvePrescribed(item: PrescriptionItem, lookup: DrugLookup): Resolved | null {
  if (item.ingredients.length) {
    return { ingredients: item.ingredients, form: item.form ?? lookup(item.nameAsWritten)?.entry.form ?? null };
  }
  const brand = lookup(item.nameAsWritten);
  if (!brand || brand.score < 1) return null;
  return { ingredients: brand.entry.ingredients, form: item.form ?? brand.entry.form };
}

const ingredientsKey = (list: Ingredient[]) =>
  list
    .map((i) => `${normalizeSalt(i.salt)}:${compareKey(i.strength)}`)
    .sort()
    .join("|");
const compareKey = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "");

/**
 * Combine one or two scans of the same strip. A field is accepted if read with high confidence,
 * or read the same way in two scans. Confident readings that disagree make the field unusable.
 */
function mergeField<T>(fields: Confident<T | null>[], key: (v: T) => string, field: string): StripField<T> {
  const present = fields.filter((f): f is Confident<T> => f.value != null && key(f.value) !== "");
  if (!present.length) return { value: null, reason: { code: "missing_field", detail: { field } } };
  const confident = present.filter((f) => f.confidence >= CONFIDENCE_THRESHOLD);
  const pool = confident.length ? confident : present.length >= 2 ? present : null;
  if (!pool) return { value: null, reason: { code: "low_confidence", detail: { field } } };
  const k = key(pool[0].value);
  if (pool.some((f) => key(f.value) !== k)) return { value: null, reason: { code: "readings_disagree", detail: { field } } };
  return { value: pool[0].value };
}

export function mergeReadings(readings: StripReading[], lookup: DrugLookup): MergedStrip {
  const brand = mergeField(readings.map((r) => r.brand), (v) => v.trim().toLowerCase(), "brand");
  let ingredients = mergeField(
    readings.map((r) => r.ingredients),
    (v) => (v.length ? ingredientsKey(v) : ""),
    "ingredients",
  );
  let form = mergeField(readings.map((r) => r.form), (v) => v, "form");
  const expiryParsed = readings.map((r) => ({ value: parseExpiry(r.expiry.value), confidence: r.expiry.confidence }));
  const expiry = mergeField(expiryParsed, (v) => `${v.year}-${v.month}`, "expiry");

  // No composition on the strip at all, but brand read confidently: fall back to the database (exact name only).
  // A composition that was printed but read poorly is NOT replaced by the database; that stays "not sure".
  if (ingredients.reason?.code === "missing_field" && brand.value) {
    const hit = lookup(brand.value);
    if (hit && hit.score === 1) {
      ingredients = { value: hit.entry.ingredients };
      if (form.value == null) form = { value: hit.entry.form };
    } else {
      ingredients = { value: null, reason: { code: "unknown_drug", detail: { side: "strip", name: brand.value } } };
    }
  }
  return { brand: brand.value, ingredients, form, expiry };
}

export interface ItemCheck extends CheckResult {
  /** True only when every salt was read and equals the prescribed salts. */
  saltsAgree: boolean;
}

export function checkItem(item: PrescriptionItem, strip: MergedStrip, today: Date, lookup: DrugLookup): ItemCheck {
  const definite: Reason[] = [];
  const uncertain: Reason[] = [];
  let saltsAgree = false;
  const pres = resolvePrescribed(item, lookup);
  if (!pres) uncertain.push({ code: "unknown_drug", detail: { side: "prescription", name: item.nameAsWritten } });

  const stripIng = strip.ingredients.value;
  if (!stripIng) uncertain.push(strip.ingredients.reason!);
  if (pres && stripIng) {
    const pSalts = [...new Set(pres.ingredients.map((i) => normalizeSalt(i.salt)))].sort();
    const sSalts = [...new Set(stripIng.map((i) => normalizeSalt(i.salt)))].sort();
    if (pSalts.join("+") !== sSalts.join("+")) {
      definite.push({
        code: "salt_differs",
        detail: { prescribed: pres.ingredients.map((i) => i.salt).join(" + "), strip: stripIng.map((i) => i.salt).join(" + ") },
      });
    } else {
      saltsAgree = true;
      for (const p of pres.ingredients) {
        const s = stripIng.find((x) => normalizeSalt(x.salt) === normalizeSalt(p.salt))!;
        const cmp = compareStrength(p.strength, s.strength);
        if (cmp === "differs") {
          definite.push({ code: "strength_differs", detail: { salt: p.salt, prescribed: p.strength ?? "", strip: s.strength ?? "" } });
        } else if (cmp === "unknown") {
          uncertain.push({ code: "missing_field", detail: { field: "strength", salt: p.salt } });
        }
      }
    }
  }

  const sForm = strip.form.value;
  if (!sForm) uncertain.push(strip.form.reason!);
  else if (pres && !pres.form) uncertain.push({ code: "missing_field", detail: { field: "prescribed_form" } });
  else if (pres?.form && pres.form !== sForm) {
    definite.push({ code: "form_differs", detail: { prescribed: pres.form, strip: sForm } });
  }

  const exp = strip.expiry.value;
  if (!exp) uncertain.push(strip.expiry.reason!);
  else if (isExpired(exp, today)) {
    definite.push({ code: "expired", detail: { expiry: `${String(exp.month).padStart(2, "0")}/${exp.year}` } });
  }

  // Definite reasons first; uncertain ones are kept so callers know what else was not verified.
  if (definite.length) return { verdict: "no_match", reasons: [...definite, ...uncertain], itemId: item.id, saltsAgree };
  if (uncertain.length) return { verdict: "not_sure", reasons: uncertain, itemId: item.id, saltsAgree };
  return { verdict: "match", reasons: [], itemId: item.id, saltsAgree };
}

const has = (r: CheckResult, code: Reason["code"]) => r.reasons.some((x) => x.code === code);
const toResult = ({ saltsAgree: _s, ...r }: ItemCheck): CheckResult => r;

/** Which prescription line (if any) does this strip belong to? */
export function checkAgainstPrescription(
  items: PrescriptionItem[],
  readings: StripReading[],
  lookup: DrugLookup,
  today = new Date(),
): CheckResult {
  if (!items.length) return { verdict: "not_sure", reasons: [{ code: "no_prescription" }] };
  const merged = mergeReadings(readings, lookup);
  const results = items.map((item) => checkItem(item, merged, today, lookup));

  const match = results.find((r) => r.verdict === "match");
  if (match) return toResult(match);

  // Expired is unsafe whatever the medicine is. Name the line only if the salts were confirmed to agree.
  const expiredReason = results.flatMap((r) => r.reasons).find((x) => x.code === "expired");
  if (expiredReason) {
    const line = results.find((r) => r.saltsAgree);
    return { verdict: "no_match", reasons: [expiredReason], itemId: line?.itemId };
  }

  // Same salt as a prescribed line but a different strength or form: name that line.
  const sameSalt = results.find((r) => r.verdict === "no_match" && r.saltsAgree);
  if (sameSalt) return toResult(sameSalt);

  const unsure = results.filter((r) => r.verdict === "not_sure" || !has(r, "salt_differs"));
  if (unsure.length) {
    const reasons = dedupe(unsure.flatMap((r) => r.reasons.filter((x) => x.code !== "form_differs")));
    return { verdict: "not_sure", reasons, itemId: unsure.length === 1 ? unsure[0].itemId : undefined };
  }
  return { verdict: "no_match", reasons: [{ code: "salt_differs" }] };
}

function dedupe(reasons: Reason[]): Reason[] {
  const seen = new Set<string>();
  return reasons.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

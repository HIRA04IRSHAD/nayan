// Deterministic text normalisation shared by the drug database and the rule engine.

const PHARMACOPOEIA = new Set(["ip", "bp", "usp", "ph", "eur"]);

// Trailing salt-form words that do not change the active moiety as labelled in India.
// Deliberately conservative: succinate/tartrate etc. are NOT stripped because they are different products.
const SALT_FORM_SUFFIXES = new Set([
  "hydrochloride",
  "hcl",
  "sodium",
  "potassium",
  "besylate",
  "besilate",
  "calcium",
  "magnesium",
  "monohydrate",
  "dihydrate",
  "trihydrate",
]);

const SALT_SYNONYMS: Record<string, string> = {
  acetaminophen: "paracetamol",
  thyroxine: "levothyroxine",
  amoxycillin: "amoxicillin",
  clavulanate: "clavulanic acid",
  "potassium clavulanate": "clavulanic acid",
  "diluted potassium clavulanate": "clavulanic acid",
  "acetylsalicylic acid": "aspirin",
  albuterol: "salbutamol",
  "vitamin d3": "cholecalciferol",
};

function words(s: string): string[] {
  // NFKC turns ligatures like "ﬁ" into "fi" and odd hyphens/spaces into plain ones (seen in the Kaggle file).
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Indian strips often print the salt form and then the active moiety the strength refers to:
// "Pantoprazole Sodium IP eq. to Pantoprazole", "Amlodipine Besilate equivalent to Amlodipine".
const EQUIVALENT_TO = /\b(?:eq(?:uivalent|uiv)?\.?\s*to|eqv\.?\s*to)\b/i;

export function normalizeSalt(raw: string): string {
  const parts = raw.split(EQUIVALENT_TO);
  const active = parts.length > 1 && parts[parts.length - 1].trim() ? parts[parts.length - 1] : raw;
  let w = words(active).filter((x) => !PHARMACOPOEIA.has(x));
  const joined = w.join(" ");
  if (SALT_SYNONYMS[joined]) return SALT_SYNONYMS[joined];
  while (w.length > 1 && SALT_FORM_SUFFIXES.has(w[w.length - 1])) w = w.slice(0, -1);
  const name = w.join(" ");
  return SALT_SYNONYMS[name] ?? name;
}

export interface Strength {
  num: number;
  /** null when the text had no unit, e.g. "Paracetamol 650". */
  unit: string | null;
}

const MASS_TO_MG: Record<string, number> = { mg: 1, g: 1000, gm: 1000, mcg: 0.001, ug: 0.001, "µg": 0.001 };

export function parseStrength(raw: string | null | undefined): Strength | null {
  if (!raw) return null;
  let compact = raw.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/,/g, "");
  compact = compact.replace(/i\.u\.?/g, "iu"); // "75 I.U." → "75iu"
  compact = compact.replace(/^(\d+(?:\.\d+)?)miu$/, "$1millioniu"); // "3miu" = 3 million IU
  // "% w/w", "% w/v", "% v/v" name the kind of percentage; they are not a "per" denominator.
  const qualifier = /%(w\/w|w\/v|v\/v)$/.exec(compact)?.[1] ?? null;
  if (qualifier) compact = compact.slice(0, -qualifier.length);
  // "1Million IU" → "1000000iu"
  const big = /^(\d+(?:\.\d+)?)(million|billion)(.*)$/.exec(compact);
  if (big) compact = `${formatNumber(Number(big[1]) * (big[2] === "million" ? 1e6 : 1e9))}${big[3]}`;
  const [first, ...rest] = compact.split("/");
  const m = /^(\d+(?:\.\d+)?)(mg|mcg|µg|ug|gm|g|ml|iu|units?|%)?$/.exec(first);
  if (!m) return null;
  let num = Number(m[1]);
  let unit: string | null = m[2] ?? null;
  if (unit && unit in MASS_TO_MG) {
    num = num * MASS_TO_MG[unit];
    unit = "mg";
  } else if (unit === "unit" || unit === "units") {
    unit = "iu";
  }
  num = Math.round(num * 1e6) / 1e6;
  if (rest.length) unit = `${unit ?? ""}/${rest.join("/")}`;
  if (qualifier && unit === "%") unit = `%${qualifier}`;
  return { num, unit };
}

/** Fixed-point number text without trailing zeros: 650 → "650", 0.05 → "0.05". Python uses the same rule. */
export function formatNumber(n: number): string {
  return n.toFixed(6).replace(/\.?0+$/, "");
}

/** Canonical strength used inside database keys: "0.5 g" → "500mg", "50 mcg" → "0.05mg", "650" → "650", unreadable → "?". */
export function canonicalStrength(raw: string | null | undefined): string {
  const s = parseStrength(raw);
  return s ? `${formatNumber(s.num)}${s.unit ?? ""}` : "?";
}

export interface Ingredient {
  salt: string;
  strength: string | null;
}

/** "paracetamol" or "amoxicillin+clavulanic acid": sorted, de-duplicated salts. */
export function saltKey(ingredients: Ingredient[]): string {
  return [...new Set(ingredients.map((i) => normalizeSalt(i.salt)).filter(Boolean))].sort().join("+");
}

/**
 * "amoxicillin:500mg+clavulanic acid:125mg" — the key that links bill lines, medicines and NPPA ceiling prices.
 * Must match data/nayan_normalize.py exactly (both are tested against data/normalize_cases.json).
 */
export function compositionKey(ingredients: Ingredient[]): string {
  const parts = ingredients
    .map((i) => ({ salt: normalizeSalt(i.salt), strength: canonicalStrength(i.strength) }))
    .filter((p) => p.salt)
    .map((p) => `${p.salt}:${p.strength}`);
  return [...new Set(parts)].sort().join("+");
}

export type StrengthComparison = "equal" | "differs" | "unknown";

/** Exact comparison after unit conversion. A missing unit on one side compares by number only (how a pharmacist reads "Paracetamol 650"). */
export function compareStrength(a: string | null, b: string | null): StrengthComparison {
  const pa = parseStrength(a);
  const pb = parseStrength(b);
  if (!pa || !pb) return "unknown";
  if (pa.num !== pb.num) return "differs";
  if (pa.unit && pb.unit && pa.unit !== pb.unit) return "differs";
  return "equal";
}

export function formatStrength(raw: string | null): string {
  const s = parseStrength(raw);
  if (!s) return raw ?? "?";
  return s.unit ? `${s.num} ${s.unit}` : String(s.num);
}

export interface YearMonth {
  year: number;
  month: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Accepts "2027-08", "08/2027", "08/27", "AUG 2027", "Exp. Aug-27". */
export function parseExpiry(raw: string | null | undefined): YearMonth | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/exp(iry)?\.?(date)?:?/g, "").trim();
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  let ym: YearMonth | null = null;
  if (m) ym = { year: Number(m[1]), month: Number(m[2]) };
  if (!ym && (m = /^(\d{1,2})\s*[-/. ]\s*(\d{4}|\d{2})$/.exec(s))) ym = { year: year(m[2]), month: Number(m[1]) };
  if (!ym && (m = /^([a-z]{3})[a-z]*\s*[-/. ]?\s*(\d{4}|\d{2})$/.exec(s))) {
    const idx = MONTHS.indexOf(m[1]);
    if (idx >= 0) ym = { year: year(m[2]), month: idx + 1 };
  }
  if (!ym || ym.month < 1 || ym.month > 12 || ym.year < 2000 || ym.year > 2100) return null;
  return ym;
}

/** Medicines are usable through the last day of the printed expiry month. */
export function isExpired(expiry: YearMonth, today: Date): boolean {
  const now = today.getFullYear() * 12 + today.getMonth();
  const exp = expiry.year * 12 + (expiry.month - 1);
  return now > exp;
}

const splitLettersDigits = (raw: string) => raw.replace(/([a-zA-Z])(\d)/g, "$1 $2").replace(/(\d)([a-zA-Z])/g, "$1 $2");

export function normalizeBrand(raw: string): string {
  return words(splitLettersDigits(raw))
    .filter((w, i) => !(i === 0 && ["tab", "tablet", "cap", "capsule", "syp", "syrup", "inj"].includes(w)))
    .join(" ");
}

// Dosage-form words that appear on bills and in the medicine database but are not part of the brand.
// Release types (sr, er, dt …) are kept: they are different products.
const FORM_WORDS = new Set([
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "syp", "syrup", "inj", "injection",
  "susp", "suspension", "cream", "gel", "oint", "ointment", "drop", "drops", "lotion", "sachet",
]);

/** Key for fuzzy-matching a printed bill line to a medicine: "TAB DOLO-650" and "Dolo 650 Tablet" → "dolo 650". */
const UNIT_WORDS = new Set(["mg", "mcg", "gm", "g", "ml", "iu"]);

/**
 * Tokens are letter runs and numbers. Decimals are kept ("12.5" must never become "125"), and a unit right
 * after a number is dropped so "Calpol 500mg Tablet" and a doctor's "Calpol 500" give the same key.
 */
export function normalizeMedicineName(raw: string): string {
  const tokens = raw.normalize("NFKC").toLowerCase().match(/[0-9]+(?:\.[0-9]+)?|[a-z]+/g) ?? [];
  const out: string[] = [];
  for (const t of tokens) {
    if (FORM_WORDS.has(t)) continue;
    if (UNIT_WORDS.has(t) && out.length && /^[0-9]/.test(out[out.length - 1])) continue;
    out.push(t);
  }
  return out.join(" ");
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

// The caregiver's "salt and strength" text box on the review screen, e.g.
// "Paracetamol 650 mg + Caffeine 50 mg", turned into ingredients and back.
import type { Ingredient } from "./types";

/** Split on "+"; the last number (with its unit, e.g. "650 mg" or "5 mg/5 ml") of each part is its strength. */
export function parseComposition(text: string): Ingredient[] {
  return text
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^(.*?)\s+(\d[\d.]*\s*[a-zA-Zµ%]*(?:\/\s*\d*\s*[a-zA-Z]+)?)$/.exec(p);
      return m ? { salt: m[1].trim(), strength: m[2].trim() } : { salt: p, strength: null };
    });
}

export const compositionText = (ing: Ingredient[]) => ing.map((i) => `${i.salt}${i.strength ? " " + i.strength : ""}`).join(" + ");

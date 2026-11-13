// Runs the cases shared with data/nayan_normalize.py (see data/normalize_cases.json).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalStrength,
  compositionKey,
  normalizeBrand,
  normalizeMedicineName,
  normalizeSalt,
  saltKey,
  type Ingredient,
} from "./normalize";

interface Cases {
  salt: [string, string][];
  brand: [string, string][];
  medicine_name: [string, string][];
  strength: [string | null, string][];
  composition: { ingredients: Ingredient[]; salt_key: string; composition_key: string }[];
}

const cases: Cases = JSON.parse(readFileSync(path.resolve(__dirname, "../data/normalize_cases.json"), "utf8"));

describe("shared cases (TypeScript side)", () => {
  it.each(cases.salt)("salt %j → %j", (raw, out) => expect(normalizeSalt(raw)).toBe(out));
  it.each(cases.brand)("brand %j → %j", (raw, out) => expect(normalizeBrand(raw)).toBe(out));
  it.each(cases.medicine_name)("medicine name %j → %j", (raw, out) => expect(normalizeMedicineName(raw)).toBe(out));
  it.each(cases.strength)("strength %j → %j", (raw, out) => expect(canonicalStrength(raw)).toBe(out));
  it.each(cases.composition)("composition $composition_key", (c) => {
    expect(saltKey(c.ingredients)).toBe(c.salt_key);
    expect(compositionKey(c.ingredients)).toBe(c.composition_key);
  });
});

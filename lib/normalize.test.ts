import { describe, expect, it } from "vitest";
import { compareStrength, isExpired, normalizeSalt, parseExpiry, parseStrength } from "./normalize";
import { buildIndex, lookupInIndex, type DrugEntry } from "./drugdb";
import { SEED_INDEX } from "./seed-drugs";
import { parseFrequency, scheduleHi } from "./schedule";

describe("normalizeSalt", () => {
  it.each([
    ["Paracetamol I.P.", "paracetamol"],
    ["Acetaminophen", "paracetamol"],
    ["Metformin Hydrochloride IP", "metformin"],
    ["Pantoprazole Sodium", "pantoprazole"],
    ["Potassium Clavulanate", "clavulanic acid"],
    ["Clavulanate Potassium", "clavulanic acid"],
    ["Metoprolol Succinate", "metoprolol succinate"],
    ["Calcium Carbonate", "calcium carbonate"],
    ["Pantoprazole Sodium IP eq. to Pantoprazole", "pantoprazole"],
    ["Amlodipine Besilate IP equivalent to Amlodipine", "amlodipine"],
    ["Atorvastatin Calcium Eq. To Atorvastatin", "atorvastatin"],
    ["Rosuvastatin Calcium IP equiv. to Rosuvastatin", "rosuvastatin"],
  ])("%s → %s", (raw, out) => expect(normalizeSalt(raw)).toBe(out));
});

describe("strength", () => {
  it("parses units", () => {
    expect(parseStrength("650 mg")).toEqual({ num: 650, unit: "mg" });
    expect(parseStrength("1 g")).toEqual({ num: 1000, unit: "mg" });
    expect(parseStrength("50 mcg")).toEqual({ num: 0.05, unit: "mg" });
    expect(parseStrength("125mg/5ml")).toEqual({ num: 125, unit: "mg/5ml" });
    expect(parseStrength("6?0 mg")).toBeNull();
  });
  it("compares exactly", () => {
    expect(compareStrength("500 mg", "650 mg")).toBe("differs");
    expect(compareStrength("650", "650 mg")).toBe("equal");
    expect(compareStrength("50 mcg", "50 mg")).toBe("differs");
    expect(compareStrength(null, "650 mg")).toBe("unknown");
  });
});

describe("expiry", () => {
  it.each([
    ["2027-08", { year: 2027, month: 8 }],
    ["08/2027", { year: 2027, month: 8 }],
    ["08/27", { year: 2027, month: 8 }],
    ["EXP. AUG 2027", { year: 2027, month: 8 }],
    ["Exp: Aug-27", { year: 2027, month: 8 }],
  ])("%s", (raw, out) => expect(parseExpiry(raw)).toEqual(out));
  it("rejects junk", () => expect(parseExpiry("13/2027")).toBeNull());
  it("expires after the month ends", () => {
    expect(isExpired({ year: 2026, month: 10 }, new Date(2026, 9, 31))).toBe(false);
    expect(isExpired({ year: 2026, month: 10 }, new Date(2026, 10, 1))).toBe(true);
  });
});

describe("brand lookup (seed index)", () => {
  const find = (name: string) => lookupInIndex(SEED_INDEX, name);
  it("exact and spacing variants", () => {
    expect(find("Tab. DOLO-650")?.entry.brand).toBe("Dolo 650");
    expect(find("dolo650")?.score).toBe(1);
  });
  it("numbers must match exactly", () => {
    expect(find("Telma 60")).toBeNull();
  });
  it("small spelling errors are fuzzy hits with score < 1", () => {
    const hit = find("Pantocide 40");
    expect(hit?.entry.brand).toBe("Pantocid 40");
    expect(hit!.score).toBeLessThan(1);
  });
});

describe("brand lookup rules", () => {
  const tab = (brand: string, salt: string, strength: string, extra: Partial<DrugEntry> = {}): DrugEntry => ({
    brand, form: "tablet", ingredients: [{ salt, strength }], ...extra,
  });
  const index = buildIndex([
    tab("Pantocid Tablet", "Pantoprazole", "40mg"),
    tab("Thyronorm 12.5mcg Tablet", "Thyroxine", "12.5mcg"),
    tab("Thyronorm 125mcg Tablet", "Thyroxine", "125mcg"),
    tab("Calpol 500mg Tablet", "Paracetamol", "500mg"),
    tab("Twin 10 Tablet", "Cetirizine", "10mg"),
    tab("Twin 10 Tablet", "Levocetirizine", "10mg"),
    tab("Oldbrand 5 Tablet", "Amlodipine", "5mg", { discontinued: true }),
    tab("Kitmed 4 Kit", "Isoniazid", "300mg", { complete: false }),
  ]);
  const find = (name: string) => lookupInIndex(index, name);

  it("a doctor's 'Calpol 500' finds 'Calpol 500mg Tablet'", () => expect(find("Calpol 500")?.entry.brand).toBe("Calpol 500mg Tablet"));
  it("keeps decimals apart: 12.5 mcg is not 125 mcg", () => {
    expect(find("Thyronorm 12.5")?.entry.ingredients[0].strength).toBe("12.5mcg");
    expect(find("Thyronorm 125")?.entry.ingredients[0].strength).toBe("125mcg");
  });
  it("'Pantocid 40' finds 'Pantocid Tablet' only because 40 is its strength", () => {
    expect(find("Pantocid 40")).toMatchObject({ score: 1, entry: { brand: "Pantocid Tablet" } });
    expect(find("Pantocid 20")).toBeNull();
  });
  it("returns nothing for a name shared by different medicines", () => expect(find("Twin 10")).toBeNull());
  it("still finds a discontinued medicine when it is the only one", () => expect(find("Oldbrand 5")?.entry.brand).toBe("Oldbrand 5 Tablet"));
  it("never uses an entry whose composition is incomplete", () => expect(find("Kitmed 4")).toBeNull());
});

describe("schedule", () => {
  it.each([
    ["1-0-1", ["morning", "night"]],
    ["1-1-1", ["morning", "afternoon", "night"]],
    ["0-0-1", ["night"]],
    ["BD", ["morning", "night"]],
    ["HS", ["night"]],
  ])("%s", (raw, slots) => expect(parseFrequency(raw)?.slots).toEqual(slots));
  it("reads in Hindi", () => expect(scheduleHi("1-0-1", "after food")).toBe("सुबह और रात, खाना खाने के बाद"));
});

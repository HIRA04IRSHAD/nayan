import { describe, expect, it } from "vitest";
import { checkAgainstPrescription, checkItem, mergeReadings } from "./rules";
import { verdictText } from "./messages";
import { DEMO_PRESCRIPTION, DEMO_STRIPS, strip } from "./fixtures";
import { SEED_LOOKUP } from "./seed-drugs";
import type { PrescriptionItem } from "./types";

const TODAY = new Date(2026, 9, 21);
const rx = DEMO_PRESCRIPTION;
const check = (reading: ReturnType<typeof strip>, items: PrescriptionItem[] = rx) =>
  checkAgainstPrescription(items, [reading], SEED_LOOKUP, TODAY);

describe("match", () => {
  it("same brand, salt, strength, form", () => {
    const r = check(strip("Dolo 650", [{ salt: "Paracetamol IP", strength: "650 mg" }], "tablet", "08/2028"));
    expect(r).toMatchObject({ verdict: "match", itemId: "rx1" });
  });

  it("different brand with the same salt and strength is accepted", () => {
    const r = check(strip("Pantocid 40", [{ salt: "Pantoprazole Sodium", strength: "40mg" }], "tablet", "2027-11"));
    expect(r).toMatchObject({ verdict: "match", itemId: "rx2" });
  });

  it("understands 'X eq. to Y' salt wording (found in a real end-to-end test)", () => {
    const r = check(strip("PANTOCID 40", [{ salt: "Pantoprazole Sodium IP eq. to Pantoprazole", strength: "40 mg" }], "tablet", "04/2028"));
    expect(r).toMatchObject({ verdict: "match", itemId: "rx2" });
  });

  it("uses the drug database when the strip shows only the brand", () => {
    const r = check(strip("Telma 40", [], "tablet", "05/2028"));
    expect(r).toMatchObject({ verdict: "match", itemId: "rx3" });
  });

  it("prescription written as salt + strength without unit", () => {
    const items: PrescriptionItem[] = [
      { id: "a", nameAsWritten: "Paracetamol 650", ingredients: [{ salt: "Paracetamol", strength: "650" }], form: "tablet", frequency: "1-0-1", timing: null, durationDays: 3 },
    ];
    expect(check(strip("Dolo 650", [{ salt: "Acetaminophen", strength: "650 mg" }], "tablet", "08/2028"), items).verdict).toBe("match");
  });

  it("strength in grams equals the same strength in mg", () => {
    const items: PrescriptionItem[] = [
      { id: "a", nameAsWritten: "Paracetamol", ingredients: [{ salt: "Paracetamol", strength: "0.5 g" }], form: "tablet", frequency: null, timing: null, durationDays: null },
    ];
    expect(check(strip("Calpol 500", [{ salt: "Paracetamol", strength: "500 mg" }], "tablet", "08/2028"), items).verdict).toBe("match");
  });
});

describe("does not match", () => {
  it("500 mg is not 650 mg", () => {
    const r = check(strip("Calpol 500", [{ salt: "Paracetamol", strength: "500 mg" }], "tablet", "03/2028"));
    expect(r.verdict).toBe("no_match");
    expect(r.itemId).toBe("rx1");
    expect(r.reasons[0]).toMatchObject({ code: "strength_differs", detail: { prescribed: "650 mg", strip: "500 mg" } });
  });

  it("different salt", () => {
    const r = check(strip("Azithral 500", [{ salt: "Azithromycin", strength: "500 mg" }], "tablet", "06/2028"));
    expect(r).toMatchObject({ verdict: "no_match", reasons: [{ code: "salt_differs" }] });
  });

  it("form differs (capsule vs tablet)", () => {
    const r = check(strip("Pan 40", [{ salt: "Pantoprazole", strength: "40 mg" }], "capsule", "06/2028"));
    expect(r).toMatchObject({ verdict: "no_match", itemId: "rx2", reasons: [{ code: "form_differs" }] });
  });

  it("combination: every salt must match", () => {
    const items: PrescriptionItem[] = [
      { id: "a", nameAsWritten: "Glycomet GP 1", ingredients: [], form: null, frequency: "1-0-1", timing: null, durationDays: 30 },
    ];
    const onlyMetformin = strip("Glycomet 500", [{ salt: "Metformin Hydrochloride", strength: "500 mg" }], "tablet", "06/2028");
    expect(check(onlyMetformin, items).verdict).toBe("no_match");
    const gp2 = strip("Glycomet GP 2", [{ salt: "Metformin", strength: "500 mg" }, { salt: "Glimepiride", strength: "2 mg" }], "tablet", "06/2028");
    expect(check(gp2, items).reasons[0]).toMatchObject({ code: "strength_differs", detail: { salt: "Glimepiride" } });
    const gp1 = strip("Glycomet GP 1", [{ salt: "Glimepiride", strength: "1 mg" }, { salt: "Metformin HCl", strength: "500 mg" }], "tablet", "06/2028");
    expect(check(gp1, items).verdict).toBe("match");
  });

  it("expired strip of the right medicine", () => {
    const r = check(strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "09/2026"));
    expect(r).toMatchObject({ verdict: "no_match", itemId: "rx1", reasons: [{ code: "expired", detail: { expiry: "09/2026" } }] });
  });

  it("strip is usable through the end of its expiry month", () => {
    expect(check(strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "10/2026")).verdict).toBe("match");
  });
});

describe("not sure", () => {
  it("low-confidence read is never a match", () => {
    const r = check(strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "08/2028", 0.6));
    expect(r.verdict).toBe("not_sure");
  });

  it("two low-confidence scans that agree are accepted", () => {
    const a = strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "08/2028", 0.6);
    const b = strip("Dolo 650", [{ salt: "Paracetamol IP", strength: "650mg" }], "tablet", "08/28", 0.7);
    // Salt names normalise differently in the raw key ("IP"), so ingredients must still agree after normalisation.
    expect(checkAgainstPrescription(rx, [a, b], SEED_LOOKUP, TODAY).verdict).toBe("match");
  });

  it("two scans that disagree stay not sure", () => {
    const a = strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "08/2028", 0.6);
    const b = strip("Dolo 500", [{ salt: "Paracetamol", strength: "500 mg" }], "tablet", "08/2028", 0.6);
    expect(checkAgainstPrescription(rx, [a, b], SEED_LOOKUP, TODAY).verdict).toBe("not_sure");
  });

  it("missing expiry is not sure, and the user is told to show the EXP side", () => {
    const r = check(strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", null));
    expect(r.verdict).toBe("not_sure");
    expect(verdictText(r)).toContain("EXP");
  });

  it("unknown brand with no composition printed is not sure", () => {
    const r = check(strip("Xyzzol 40", [], "tablet", "06/2028"));
    expect(r.verdict).toBe("not_sure");
    expect(r.reasons[0]).toMatchObject({ code: "unknown_drug", detail: { side: "strip" } });
  });

  it("prescription brand not in database is not sure, never a match", () => {
    const items: PrescriptionItem[] = [
      { id: "a", nameAsWritten: "Unknownex 10", ingredients: [], form: "tablet", frequency: null, timing: null, durationDays: null },
    ];
    expect(check(strip("Unknownex 10", [{ salt: "Something", strength: "10 mg" }], "tablet", "06/2028"), items).verdict).toBe("not_sure");
  });

  it("fuzzy strip brand is not used to fill in the composition", () => {
    const m = mergeReadings([strip("Dolo 65O", [], "tablet", "08/2028")], SEED_LOOKUP);
    expect(m.ingredients.value).toBeNull();
  });
});

describe("safety invariant", () => {
  it("a match never comes from any field below the confidence threshold in a single scan", () => {
    const base = strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "08/2028");
    for (const field of ["ingredients", "form", "expiry"] as const) {
      const reading = { ...base, [field]: { ...base[field], confidence: 0.5 } };
      expect(checkItem(rx[0], mergeReadings([reading], SEED_LOOKUP), TODAY, SEED_LOOKUP).verdict, field).not.toBe("match");
    }
  });

  it("demo strips give the expected verdicts", () => {
    const verdicts = DEMO_STRIPS.map((d) => check(d.reading).verdict);
    expect(verdicts).toEqual(["match", "match", "no_match", "no_match", "no_match", "no_match", "not_sure"]);
  });
});

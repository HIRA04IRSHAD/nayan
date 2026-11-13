// Integration tests against the real medicine index (data/medicines.json.gz, built by data/build_drugdb.py).
// Skipped when the index has not been built.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDEX_PATH, loadServerIndex, serverLookup } from "./drugdb-server";
import { strip } from "./fixtures";
import { checkAgainstPrescription } from "./rules";
import type { PrescriptionItem } from "./types";

const TODAY = new Date(2026, 10, 4);
const item = (id: string, nameAsWritten: string): PrescriptionItem => ({
  id, nameAsWritten, ingredients: [], form: "tablet", frequency: "1-0-0", timing: null, durationDays: 30,
});
const RX = [item("rx1", "Rosuvas 10"), item("rx2", "Nexpro 40"), item("rx3", "Cilacar 10")];

describe.skipIf(!existsSync(INDEX_PATH))("full medicine index", () => {
  it("loads about 254k medicines", () => {
    expect(loadServerIndex().count).toBeGreaterThan(250_000);
  }, 30_000);

  it("finds common brands, including ones outside the old seed list", () => {
    expect(serverLookup("Rosuvas 10")?.entry.ingredients).toEqual([{ salt: "Rosuvastatin", strength: "10mg" }]);
    expect(serverLookup("Nexpro 40")?.entry.ingredients).toEqual([{ salt: "Esomeprazole", strength: "40mg" }]);
    expect(serverLookup("Thyronorm 12.5")?.entry.ingredients[0].strength).toBe("12.5mcg");
    expect(serverLookup("Pantocid 40")?.entry.brand).toBe("Pantocid Tablet");
  });

  it("refuses ambiguous or unknown names", () => {
    expect(serverLookup("Crocin")).toBeNull(); // many different Crocin products
    expect(serverLookup("Shelcal 500")).toBeNull(); // not in the dataset
  });

  it("matches a strip that shows only the brand name (no composition printed)", () => {
    const res = checkAgainstPrescription(RX, [strip("NEXPRO 40", [], "tablet", "03/2028")], serverLookup, TODAY);
    expect(res).toMatchObject({ verdict: "match", itemId: "rx2" });
  });

  it("matches 'eq. to' wording and catches a wrong strength with real brands", () => {
    const eq = strip("ROSUVAS 10", [{ salt: "Rosuvastatin Calcium IP eq. to Rosuvastatin", strength: "10 mg" }], "tablet", "05/2028");
    expect(checkAgainstPrescription(RX, [eq], serverLookup, TODAY)).toMatchObject({ verdict: "match", itemId: "rx1" });
    const wrong = strip("CILACAR 20", [{ salt: "Cilnidipine", strength: "20 mg" }], "tablet", "01/2028");
    expect(checkAgainstPrescription(RX, [wrong], serverLookup, TODAY)).toMatchObject({
      verdict: "no_match",
      itemId: "rx3",
      reasons: [{ code: "strength_differs" }],
    });
  });
});

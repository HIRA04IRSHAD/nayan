import { describe, expect, it } from "vitest";
import { parseFrequency, tabletsPerSlot } from "./schedule";
import { doseLineHi } from "./today-messages";
import type { PrescriptionItem } from "./types";

describe("parseFrequency", () => {
  it("reads codes with or without dots and spaces", () => {
    expect(parseFrequency("B.D.")).toEqual({ slots: ["morning", "night"], asNeeded: false });
    expect(parseFrequency(" o d ")).toEqual({ slots: ["morning"], asNeeded: false });
    expect(parseFrequency("S.O.S")).toEqual({ slots: [], asNeeded: true });
  });

  it("reads dose patterns with spaces and a trailing dot", () => {
    expect(parseFrequency("1 - 0 - 1")?.slots).toEqual(["morning", "night"]);
    expect(parseFrequency("1-0-1.")?.slots).toEqual(["morning", "night"]);
    expect(parseFrequency("1-1-1-1")?.slots).toEqual(["morning", "afternoon", "evening", "night"]);
  });

  // Regression: dots used to be removed before the pattern was read, so "0.5" became "05" (5 tablets).
  it("keeps decimal doses as part doses in the right slots", () => {
    expect(parseFrequency("0.5-0-0.5")?.slots).toEqual(["morning", "night"]);
    expect(parseFrequency("1.5-0-1.5")?.slots).toEqual(["morning", "night"]);
    expect(parseFrequency("0.5-0.5-0.5")?.slots).toEqual(["morning", "afternoon", "night"]);
    expect(parseFrequency("1-0.0-1")?.slots).toEqual(["morning", "night"]);
  });
});

describe("tabletsPerSlot: decimals are never whole tablets", () => {
  it("returns null (part dose) for decimal doses", () => {
    expect(tabletsPerSlot("0.5-0-0.5")).toBeNull();
    expect(tabletsPerSlot("1.5-0-1.5")).toBeNull();
    expect(tabletsPerSlot("0.5-0.5-0.5")).toBeNull();
    expect(tabletsPerSlot(".5-0-.5")).toBeNull();
  });

  it("still reads whole tablets and treats 0.0 as no dose", () => {
    expect(tabletsPerSlot("2-0-1")).toEqual({ morning: 2, night: 1 });
    expect(tabletsPerSlot("1-0.0-1")).toEqual({ morning: 1, night: 1 });
    expect(tabletsPerSlot("B.D.")).toEqual({ morning: 1, night: 1 });
  });
});

describe("doseLineHi with a decimal dose", () => {
  const item = { nameAsWritten: "Dolo 650", tag: null, form: "tablet", timing: null } as unknown as PrescriptionItem;
  it("never says a tablet count for half a tablet", () => {
    for (const f of ["0.5-0-0.5", "1.5-0-1.5", "0.5-0.5-0.5"]) {
      const text = doseLineHi({ item: { ...item, frequency: f }, tablets: tabletsPerSlot(f)?.morning ?? null });
      expect(text, f).toBe("Dolo 650");
      expect(text, f).not.toMatch(/\d+ गोलियाँ/);
    }
  });
});

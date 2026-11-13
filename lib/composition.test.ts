import { describe, expect, it } from "vitest";
import { compositionText, parseComposition } from "./composition";

describe("parseComposition", () => {
  it("reads salts with strengths", () => {
    expect(parseComposition("Paracetamol 650 mg + Caffeine 50mg")).toEqual([
      { salt: "Paracetamol", strength: "650 mg" },
      { salt: "Caffeine", strength: "50mg" },
    ]);
  });

  it("keeps per-volume strengths and decimals", () => {
    expect(parseComposition("Amoxycillin 250 mg/5 ml")).toEqual([{ salt: "Amoxycillin", strength: "250 mg/5 ml" }]);
    expect(parseComposition("Levothyroxine 12.5 mcg")).toEqual([{ salt: "Levothyroxine", strength: "12.5 mcg" }]);
  });

  it("a salt with no number has no strength", () => {
    expect(parseComposition("Pantoprazole")).toEqual([{ salt: "Pantoprazole", strength: null }]);
  });

  it("ignores empty parts", () => {
    expect(parseComposition(" + Telmisartan 40 mg + ")).toEqual([{ salt: "Telmisartan", strength: "40 mg" }]);
  });

  it("round-trips through compositionText", () => {
    const text = "Paracetamol 650 mg + Caffeine 50 mg";
    expect(compositionText(parseComposition(text))).toBe(text);
  });
});

// Sample data for demo mode (no API key) and for unit tests.
import type { Confident, DosageForm, Ingredient, PrescriptionItem, StripReading } from "./types";

export const DEMO_PRESCRIPTION: PrescriptionItem[] = [
  { id: "rx1", nameAsWritten: "Dolo 650", ingredients: [], form: "tablet", frequency: "1-0-1", timing: "after food", durationDays: 5 },
  { id: "rx2", nameAsWritten: "Pan 40", ingredients: [], form: "tablet", frequency: "1-0-0", timing: "before food", durationDays: 30 },
  { id: "rx3", nameAsWritten: "Telma 40", ingredients: [], form: "tablet", frequency: "OD", timing: null, durationDays: 30 },
];

const c = <T>(value: T, confidence = 0.95): Confident<T> => ({ value, confidence });

export function strip(
  brand: string | null,
  ingredients: Ingredient[],
  form: DosageForm | null,
  expiry: string | null,
  confidence = 0.95,
): StripReading {
  return { brand: c(brand, confidence), ingredients: c(ingredients, confidence), form: c(form, confidence), expiry: c(expiry, confidence) };
}

export const DEMO_STRIPS: { label: string; reading: StripReading }[] = [
  { label: "Dolo 650 (सही)", reading: strip("Dolo 650", [{ salt: "Paracetamol IP", strength: "650 mg" }], "tablet", "08/2028") },
  { label: "Pantocid 40 (दूसरा ब्रांड, वही नमक)", reading: strip("Pantocid 40", [{ salt: "Pantoprazole Sodium", strength: "40 mg" }], "tablet", "2027-11") },
  { label: "Calpol 500 (ताकत अलग)", reading: strip("Calpol 500", [{ salt: "Paracetamol", strength: "500 mg" }], "tablet", "03/2028") },
  { label: "Telma 80 (ताकत अलग)", reading: strip("Telma 80", [{ salt: "Telmisartan", strength: "80 mg" }], "tablet", "05/2028") },
  { label: "Dolo 650 (एक्सपायर)", reading: strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "01/2026") },
  { label: "Azithral 500 (पर्चे में नहीं)", reading: strip("Azithral 500", [{ salt: "Azithromycin", strength: "500 mg" }], "tablet", "06/2028") },
  { label: "धुंधली फ़ोटो (अस्पष्ट)", reading: strip("Dolo 6?0", [{ salt: "Paracetamol", strength: "6?0 mg" }], "tablet", "08/2028", 0.4) },
];

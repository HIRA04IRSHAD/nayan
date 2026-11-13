import type { PrescriptionItem, TactileTagId } from "./types";

/** The stick-on tactile kit. Order = the order tags are handed out. */
export const TAGS: { id: TactileTagId; hi: string; en: string }[] = [
  { id: "one_dot", hi: "एक बिंदु", en: "One bump" },
  { id: "two_dots", hi: "दो बिंदु", en: "Two bumps" },
  { id: "three_dots", hi: "तीन बिंदु", en: "Three bumps" },
  { id: "line", hi: "एक लकीर", en: "Line" },
  { id: "triangle", hi: "त्रिकोण", en: "Triangle" },
  { id: "circle", hi: "गोला", en: "Ring" },
  { id: "cross", hi: "क्रॉस", en: "Cross" },
  { id: "square", hi: "चौकोर", en: "Square" },
];

export const tagInfo = (id: TactileTagId) => TAGS.find((t) => t.id === id)!;

export function nextFreeTag(items: PrescriptionItem[]): TactileTagId | null {
  const used = new Set(items.map((i) => i.tag).filter(Boolean));
  return TAGS.find((t) => !used.has(t.id))?.id ?? null;
}

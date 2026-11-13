// Hindi text for everything Nayan says. Fixed templates only, never model-generated text.

import type { CheckResult, DosageForm, PrescriptionItem, TactileTagId } from "./types";
import { formatStrength } from "./normalize";
import type { DrugLookup } from "./drugdb";
import { resolvePrescribed } from "./rules";
import { scheduleHi } from "./schedule";
import { tagInfo } from "./tags";

export const FORM_HI: Record<DosageForm, string> = {
  tablet: "गोली",
  capsule: "कैप्सूल",
  syrup: "सिरप",
  suspension: "घोल",
  injection: "इंजेक्शन",
  drops: "ड्रॉप्स",
  cream: "क्रीम",
  ointment: "मलहम",
  gel: "जेल",
  solution: "लिक्विड",
  inhaler: "इनहेलर",
  powder: "पाउडर",
  other: "दवा",
};

/** Make units pronounceable by a hi-IN voice. Display text keeps "mg". */
export function speakable(text: string): string {
  return text
    .replace(/(\d)\s*mcg\b/gi, "$1 माइक्रोग्राम")
    .replace(/(\d)\s*mg\b/gi, "$1 मिलीग्राम")
    .replace(/(\d)\s*ml\b/gi, "$1 एम एल")
    .replace(/(\d)\s*iu\b/gi, "$1 यूनिट");
}

const noLookup: DrugLookup = () => null;

export function composition(item: PrescriptionItem, lookup: DrugLookup = noLookup): string | null {
  const r = resolvePrescribed(item, lookup);
  if (!r) return null;
  return r.ingredients.map((i) => `${i.salt} ${formatStrength(i.strength)}`).join(" + ");
}

export function describeItem(item: PrescriptionItem, index?: number, lookup: DrugLookup = noLookup): string {
  const parts: string[] = [];
  parts.push(`${index != null ? `${index + 1}. ` : ""}${item.nameAsWritten}`);
  const comp = composition(item, lookup);
  parts.push(comp ? comp : "यह दवा सूची में नहीं मिली");
  const sch = scheduleHi(item.frequency, item.timing);
  if (sch) parts.push(sch);
  if (item.durationDays) parts.push(`${item.durationDays} दिन`);
  if (item.tag) parts.push(`${tagInfo(item.tag).hi} वाला टैग`);
  return parts.join(", ") + "।";
}

export function tagInstruction(tag: TactileTagId, item: PrescriptionItem): string {
  const t = tagInfo(tag).hi;
  const sch = scheduleHi(item.frequency, item.timing);
  return `इस डिब्बे पर ${t} वाला टैग लगाइए। ${t} वाली दवा: ${sch || item.nameAsWritten}।`;
}

export function verdictText(result: CheckResult, item?: PrescriptionItem): string {
  const first = result.reasons[0];
  const name = item ? item.nameAsWritten : "";
  if (result.verdict === "match") return `हाँ, यह सही दवा है। पर्चे की ${name} से मेल खाती है।`;

  if (result.verdict === "no_match") {
    switch (first?.code) {
      case "expired":
        return `रुकिए, यह दवा एक्सपायर हो चुकी है, तारीख ${first.detail?.expiry}। इसे न लें, केमिस्ट से पूछें।`;
      case "strength_differs":
        return `रुकिए, यह दवा मेल नहीं खाती। ताकत अलग है। पर्चे में ${formatStrength(first.detail?.prescribed ?? null)} है, पर इस पत्ते पर ${formatStrength(first.detail?.strip ?? null)} है। इसे न लें, केमिस्ट से बदलवाइए।`;
      case "form_differs": {
        const p = FORM_HI[first.detail?.prescribed as DosageForm] ?? "";
        const s = FORM_HI[first.detail?.strip as DosageForm] ?? "";
        return `रुकिए, यह दवा मेल नहीं खाती। पर्चे में ${p} है, पर यह ${s} है।`;
      }
      default:
        return "रुकिए, यह दवा पर्चे की किसी भी दवा से मेल नहीं खाती। इसे न लें।";
    }
  }

  const unknown = result.reasons.find((r) => r.code === "unknown_drug");
  if (unknown?.detail?.side === "strip") return "पक्का नहीं कह सकते। यह दवा हमारी सूची में नहीं मिली। परिवार वाले या केमिस्ट से पूछिए।";
  if (unknown?.detail?.side === "prescription") return `पक्का नहीं कह सकते। पर्चे की दवा ${unknown.detail.name} हमारी सूची में नहीं मिली।`;
  // Only the expiry is missing (everything else was read): tell the user which side of the strip to show.
  const onlyExpiryMissing =
    result.reasons.length > 0 && result.reasons.every((r) => r.detail?.field === "expiry");
  if (onlyExpiryMissing) return "पक्का नहीं कह सकते। एक्सपायरी तारीख नहीं दिखी। पत्ते को पलटकर वह हिस्सा दिखाइए जहाँ EXP लिखा होता है।";
  return "पक्का नहीं कह सकते। पत्ते को रोशनी में, सीधा और पास रखकर, लिखे हुए हिस्से की फ़ोटो दोबारा लीजिए।";
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** "1 दवा" / "3 दवाएँ". */
export const medCount = (n: number) => `${n} ${plural(n, "दवा", "दवाएँ")}`;

/**
 * Everything else the app says out loud (prompts, progress, errors). Kept here, next to the verdict
 * templates, so all spoken Hindi stays in one reviewed place and never comes from a model.
 */
export const SAY = {
  welcome: "नमस्ते। मैं नयन हूँ। मैं पर्चे से आपकी दवा मिलाकर बताता हूँ।",
  noKey: "सर्वर पर Gemini API key नहीं लगी है। नीचे डेमो से आज़माइए।",
  busy: "अभी पढ़ने की सेवा व्यस्त है। कुछ मिनट बाद दोबारा कोशिश कीजिए।",
  readFailed: "फ़ोटो पढ़ी नहीं जा सकी। इंटरनेट देखकर दोबारा कोशिश कीजिए।",
  readingPrescription: "पर्चा पढ़ा जा रहा है, कृपया रुकिए।",
  readingStrip: "पत्ता पढ़ा जा रहा है, कृपया रुकिए।",
  noMedicinesFound: "पर्चे में कोई दवा नहीं मिली। रोशनी में, पूरा पर्चा दिखाकर दोबारा फ़ोटो लीजिए।",
  cancelled: "रद्द कर दिया।",
  wait: "कृपया रुकिए, अभी पिछला काम चल रहा है।",
  newPrescription:
    "नए पर्चे की फ़ोटो लीजिए। जब तक नया पर्चा सेव नहीं होता, पुराना पर्चा और उसके टैग बने रहेंगे। नया पर्चा सेव करने पर पुराने टैग हट जाएँगे।",
  reviewCancelConfirm: "पढ़ा हुआ पर्चा मिट जाएगा और फ़ोटो फिर से पढ़वानी होगी। क्या रद्द करना है?",
  reviewCancelKept: "ठीक है, पर्चे की जाँच जारी है।",
  readyForNextStrip: "ठीक है। अगले पत्ते की फ़ोटो लीजिए।",
  allTagsUsed: "सारे टैग इस्तेमाल हो चुके हैं।",
  canSendToFamily: "चाहें तो परिवार से पूछें बटन दबाकर यह फ़ोटो परिवार वाले को भेज सकते हैं।",
  takePrescriptionPhoto: "पहले डॉक्टर के पर्चे की फ़ोटो लीजिए। पर्चे को रोशनी में, समतल जगह पर रखिए।",

  // Review of a newly read prescription, one medicine at a time.
  reviewIntro: (n: number) => `पर्चे में ${medCount(n)} ${plural(n, "मिली", "मिलीं")}। हर दवा सुनिए और पुष्टि कीजिए।`,
  reviewStep: (i: number, n: number, description: string) => `दवा ${i}, कुल ${n} में से। ${description}`,
  confirmQuestion: (description: string) => `${description} क्या यह सही है? हाँ या नहीं बोलिए।`,
  okAck: "ठीक है।",
  removedAck: "ठीक है, यह दवा हटा दी गई।",
  restored: "यह दवा वापस जोड़ दी गई। इसे फिर से जाँचिए।",
  voiceRemoved: "ठीक है, यह दवा हटा दी गई। परिवार वाले बदलें में ठीक करके वापस ला सकते हैं।",
  voiceNotUnderstood: "आवाज़ समझ नहीं आई। बटन से बताइए।",
  allReviewed: "सारी दवाएँ देख ली गईं। अब सेव कीजिए।",
  reviewSummary: (ok: number, removed: number, pending: number) => {
    if (pending) return `अभी ${medCount(pending)} बाकी ${plural(pending, "है", "हैं")}। हर दवा को सही या हटाएँ कीजिए।`;
    if (!ok) return "कोई दवा सही नहीं बताई गई। दोबारा पर्चे की फ़ोटो लीजिए या रद्द कीजिए।";
    const gone = removed ? `, ${medCount(removed)} ${plural(removed, "हटाई गई", "हटाई गईं")}` : "";
    return `${medCount(ok)} सही${gone}। सेव करने के लिए सेव करें दबाइए।`;
  },
  saved: (n: number) => `${medCount(n)} सेव हो ${plural(n, "गई", "गईं")}। अब हर दवा का पत्ता एक-एक करके जाँचिए।`,

  // Strip check and tactile tags.
  tagShouldBe: (tag: TactileTagId) => `इस डिब्बे पर ${tagInfo(tag).hi} वाला टैग होना चाहिए।`,
  medicineList: (lines: string[]) => `आपकी ${medCount(lines.length)}। ${lines.join(" ")}`,

  // Screens and settings.
  screen: { check: "दवा जाँचिए", today: "आज की दवाएँ", meds: "मेरी दवाएँ", family: "परिवार" },
  theme: { dark: "गहरा रंग चालू।", light: "हल्का रंग चालू।" },
  voice: {
    on: "नयन की आवाज़ चालू।",
    off: "नयन की आवाज़ बंद। अब नयन की हर बात स्क्रीन के ऊपर लिखी आएगी, और स्क्रीन रीडर उसे पढ़ेगा।",
  },
} as const;

// Family confirmation ("परिवार से पूछें") text lives in lib/caregiver-messages.ts.

/** Short English line for caregivers and debugging. */
export function verdictEnglish(result: CheckResult): string {
  const head = { match: "MATCH", no_match: "DOES NOT MATCH", not_sure: "NOT SURE" }[result.verdict];
  const why = result.reasons.map((r) => r.code + (r.detail ? ` ${JSON.stringify(r.detail)}` : "")).join("; ");
  return why ? `${head}: ${why}` : head;
}

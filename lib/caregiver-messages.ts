// Fixed Hindi text for the family confirmation loop ("परिवार से पूछें"). Never model-generated.
//
// Safety: a caregiver's answer is the family member's opinion. These templates always say who said it and,
// for "सही", that Nayan did not check it. Nothing here produces a rule-engine verdict or a tactile tag.

import type { Caregiver, CaregiverCaseRef, StripReading } from "./types";
import { FORM_HI } from "./messages";
import { formatStrength } from "./normalize";

/** Relations offered when setting up the family member (a free choice is still possible: "कोई और"). */
export const RELATIONS = ["बेटा", "बेटी", "पति", "पत्नी", "माँ", "पिता", "भाई", "बहन", "पोता", "पोती", "बहू", "दामाद", "दोस्त", "पड़ोसी"] as const;

/** "बेटी प्रिया", "प्रिया", or "परिवार वाले" when nobody is set up. */
export function caregiverWho(c: Caregiver | null | undefined): string {
  const name = c?.name.trim() ?? "";
  const rel = c?.relation.trim() ?? "";
  if (!name) return rel || "परिवार वाले";
  return rel ? `${rel} ${name}` : name;
}

const endSentence = (s: string) => (/[।.!?]$/.test(s) ? s : `${s}।`);

const DAY_MS = 24 * 60 * 60_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * When the case was asked, in words: "आज दोपहर 3 बजकर 10 मिनट पर", "कल रात 9 बजे पर" style (local time).
 * Empty when the time is unreadable or in the future (a wrong phone clock): better no time than a wrong one.
 */
export function askedWhenHi(createdAt: string | undefined, now: Date): string {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t) || t > now.getTime() + 60_000) return "";
  const d = new Date(t);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  const day = days <= 0 ? "आज" : days === 1 ? "कल" : days === 2 ? "परसों" : `${days} दिन पहले`;
  const h = d.getHours();
  const part = h >= 4 && h < 12 ? "सुबह" : h >= 12 && h < 16 ? "दोपहर" : h >= 16 && h < 19 ? "शाम" : "रात";
  const h12 = h % 12 || 12;
  const min = d.getMinutes();
  return `${day} ${part} ${min ? `${h12} बजकर ${min} मिनट` : `${h12} बजे`}`;
}

/**
 * What Nayan says when a family member's answer arrives, e.g.
 * "आज दोपहर 3 बजकर 10 मिनट पर पूछे गए पत्ते के बारे में बेटी प्रिया ने बताया: वह दवा सही है। उनके हिसाब से वह
 * पर्चे की दवा 2 है। यह उनकी राय है, नयन की जाँच नहीं।"
 *
 * The answer arrives by polling, seconds to 48 h later, while the user may be holding another strip. So it never
 * says "यह दवा" (this medicine): it names the case by when it was asked and, when the rules had matched it to a
 * confirmed prescription line, by that line's name (askedAbout). Both are ours, never model output.
 * The prescription line the helper picked is left out when the prescription was replaced after the case was
 * created: its number would point into a different list.
 *
 * The optional note is the family member's own words (not model output); it is read out after "उन्होंने लिखा:",
 * so it is always heard as theirs. A blind user cannot read it any other way.
 */
export function caregiverAnswerText(
  c: Pick<CaregiverCaseRef, "answer" | "askedWho" | "answerItemIndex" | "note"> & Partial<Pick<CaregiverCaseRef, "createdAt" | "askedAbout">>,
  opts: { now?: Date; prescriptionSavedAt?: string | null } = {},
): string {
  const now = opts.now ?? new Date();
  const who = c.askedWho?.trim() || "परिवार वाले";
  const when = askedWhenHi(c.createdAt, now);
  const about = c.askedAbout?.trim();
  const subject = `${when ? `${when} पर ` : ""}पूछे गए ${about ? `${about} वाले ` : ""}पत्ते के बारे में`;
  const created = c.createdAt ? Date.parse(c.createdAt) : NaN;
  const saved = opts.prescriptionSavedAt ? Date.parse(opts.prescriptionSavedAt) : NaN;
  const rxReplaced = Number.isFinite(created) && Number.isFinite(saved) && saved > created;
  const line = c.answerItemIndex != null && !rxReplaced ? ` उनके हिसाब से वह पर्चे की दवा ${c.answerItemIndex + 1} है।` : "";
  let text =
    c.answer === "correct"
      ? `${subject} ${who} ने बताया: वह दवा सही है।${line} यह उनकी राय है, नयन की जाँच नहीं।`
      : `${subject} ${who} ने बताया: वह दवा गलत है, उसे न लें।`;
  const note = c.note?.trim();
  if (note) text += ` उन्होंने लिखा: ${endSentence(note)}`;
  return text;
}

/** Message sent with the caregiver's link (WhatsApp / share sheet). The prescription itself is behind the link. */
export function caseShareText(caregiverName: string): string {
  const hello = caregiverName.trim() ? `${caregiverName.trim()} जी, ` : "";
  return `${hello}नयन ऐप से दवा जाँची गई है। कृपया इस लिंक पर दवा के पत्ते की फ़ोटो देखकर बताइए कि यह पर्चे की दवा है या नहीं: "सही है" या "गलत है" दबाइए। लिंक 48 घंटे चलेगा।`;
}

/** wa.me link that opens WhatsApp with the message and link filled in (the user picks the contact). */
export function whatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
}

/**
 * "What Nayan read" on the strip, shown to the caregiver next to the photo. Display only, never spoken:
 * the values are transcriptions, so the caregiver can see if a misread caused the "not sure".
 */
export function stripReadingText(r: StripReading): string {
  const none = "नहीं पढ़ा गया";
  const salts = r.ingredients.value.map((i) => `${i.salt}${i.strength ? ` ${formatStrength(i.strength)}` : ""}`).join(" + ");
  return [
    `नाम: ${r.brand.value || none}`,
    `नमक: ${salts || none}`,
    `रूप: ${r.form.value ? FORM_HI[r.form.value] : none}`,
    `एक्सपायरी: ${r.expiry.value || none}`,
  ].join(" · ");
}

export const CASE_STATUS_HI: Record<CaregiverCaseRef["status"], string> = {
  waiting: "जवाब का इंतज़ार",
  answered: "जवाब आ गया",
  expired: "समय खत्म, जवाब नहीं आया",
};

/** Short label of an answer for the history list (text + icon, never colour alone). */
export const ANSWER_HI = { correct: "सही बताया", wrong: "गलत बताया" } as const;

export const SAY_FAMILY = {
  creating: "परिवार के लिए लिंक बन रहा है, कृपया रुकिए।",
  created: (who: string) => `लिंक बन गया। इसे ${who} को भेजिए। जवाब आते ही मैं बोलकर बताऊँगा।`,
  failed: "लिंक नहीं बन सका। इंटरनेट देखकर दोबारा कोशिश कीजिए।",
  noPhoto: "पहले पत्ते की फ़ोटो लीजिए, फिर परिवार से पूछिए।",
  linkCopied: "लिंक कॉपी हो गया। अब WhatsApp या मैसेज में चिपकाइए।",
  copyFailed: "लिंक कॉपी नहीं हो सका। WhatsApp वाला बटन दबाइए।",
  openingWhatsapp: "WhatsApp खुल रहा है। परिवार वाले को चुनकर भेजिए।",
  caregiverSaved: (who: string) => `परिवार वाले सेव हो गए: ${who}। नयन पक्का न हो, तो इनसे पूछ सकते हैं।`,
  caregiverRemoved: "परिवार वाले का नाम हटा दिया गया।",
  nameNeeded: "पहले नाम लिखिए।",
  noCases: "अभी तक परिवार से कुछ नहीं पूछा गया।",
  waiting: (who: string) => `${who} के जवाब का इंतज़ार है।`,
  expired: (who: string) => `${who} का जवाब 48 घंटे में नहीं आया। ज़रूरत हो तो दोबारा पूछिए।`,
} as const;

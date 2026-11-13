// Hindi text for the blister dose check ("खुराक जाँच"). Fixed templates only, never model-generated text.
//
// Safety wording, checked by lib/blister-messages.test.ts:
// - A count is only ever "लगता है" (seems): it relies on a photo.
// - Never "take more/extra" or "take the missed ones together". A missed dose points to the doctor or chemist.
// - "Take now" is never an instruction; it restates that the prescription's dose time has come and the count
//   suggests it is still in the strip.

import type { PrescriptionItem } from "./types";
import { localDate, type BlisterResult, type NotSureReason } from "./blister";
import { SLOT_HI } from "./schedule";
import { tagInfo } from "./tags";

/** How the medicine is named aloud: by its tactile tag when it has one ("दो बिंदु वाली दवा"), else by name. */
export function medicineLabel(item: Pick<PrescriptionItem, "nameAsWritten" | "tag">): string {
  return item.tag ? `${tagInfo(item.tag).hi} वाली दवा` : item.nameAsWritten;
}

/** "1 खाना ज़्यादा खाली है" / "2 खाने ज़्यादा खाली हैं" (pockets avoid the गोली/कैप्सूल gender split). */
const pockets = (n: number) => (n === 1 ? "1 खाना" : `${n} खाने`);
const isAre = (n: number) => (n === 1 ? "है" : "हैं");
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const RETAKE = "पत्ते को पलटकर, रोशनी में, सीधा और पूरा दिखाकर दोबारा फ़ोटो लीजिए।";
const TAP_AFTER = "अगर आप अभी गोली लेते हैं, तो लेने के बाद 'मैंने अभी ली' दबाइए।";

const NOT_SURE: Record<NotSureReason, string> = {
  missing_read: `पक्का नहीं कह सकते। खाने दो बार गिनने होते हैं, पर एक बार की गिनती नहीं हो सकी। ${RETAKE}`,
  no_strip: "पक्का नहीं कह सकते। फ़ोटो में पत्ता नहीं दिखा। पत्ते को पलटकर, पूरा पत्ता कैमरे के सामने रखिए।",
  impossible: `पक्का नहीं कह सकते। खानों की गिनती ठीक नहीं लगी। ${RETAKE}`,
  not_whole:
    "पक्का नहीं कह सकते। पूरा पत्ता फ़ोटो में नहीं आया, या पत्ता कटा-फटा है। कटे या फटे पत्ते की गिनती भरोसे से नहीं हो सकती। एक बार में एक ही पूरा पत्ता दिखाइए।",
  disagree: `पक्का नहीं कह सकते। दो बार गिनने पर खाली खानों की गिनती अलग-अलग आई। ${RETAKE}`,
  low_confidence: `पक्का नहीं कह सकते। खाने साफ़ नहीं दिखे। ${RETAKE}`,
  no_schedule: "इस दवा का रोज़ का तय समय नहीं है, इसलिए खाने गिनकर खुराक की जाँच नहीं हो सकती।",
  part_dose: "इस दवा की खुराक में आधी गोली है, इसलिए खाने गिनकर खुराक की जाँच नहीं हो सकती।",
  which_dose:
    "पक्का नहीं कह सकते। गिनती में एक खुराक कम है, पर यह नहीं पता कि अभी की खुराक बाकी है या पहले की कोई खुराक छूटी थी। गोली लेने से पहले परिवार से पूछिए। आगे से गोली लेने के बाद 'मैंने अभी ली' दबाइए, तो गिनती साफ़ रहेगी।",
  log_disagrees:
    "पक्का नहीं कह सकते। आपकी सूची में अभी की खुराक ली हुई दर्ज है, पर पत्ते में एक खुराक कम निकली है। दोबारा लेने से पहले परिवार से पूछिए।",
  count_before_dose:
    "पक्का नहीं कह सकते। गिनती में एक खुराक कम है, पर पिछली गिनती दवा के समय से कुछ ही घंटे पहले हुई थी। हो सकता है यह खुराक उससे पहले ही ले ली गई हो। गोली लेने से पहले परिवार से पूछिए। आगे से दवा के समय पर ही पत्ता गिनवाइए।",
  part_taken: "पक्का नहीं कह सकते। गिनती से लगता है कि अभी की खुराक की सिर्फ़ कुछ गोलियाँ निकली हैं। और लेने से पहले परिवार से पूछिए।",
};

/** Exactly what Nayan says for a dose-check result. `now` decides "आज" for the current dose. */
export function blisterText(r: BlisterResult, item: Pick<PrescriptionItem, "nameAsWritten" | "tag">, now: Date): string {
  const p = `${medicineLabel(item)}: `;
  const cur = r.current;
  const slot = cur ? SLOT_HI[cur.slot] : "";
  const count = r.observed ? `${r.observed.total} में से ${r.observed.empty} खाने खाली` : "";
  const finished = r.finished ? " यह पत्ता अब खाली है।" : "";
  const tapNote = r.canMarkTaken && cur ? ` अभी ${slot} की खुराक का समय है। पहली गिनती से यह पता नहीं चलता कि यह खुराक ली गई या नहीं। ${TAP_AFTER}` : "";

  switch (r.outcome) {
    case "not_sure":
      return p + NOT_SURE[(r.reason as NotSureReason | null) ?? "impossible"];
    case "baseline_set": {
      const head = r.reason === "stale" ? "पिछली गिनती बहुत पुरानी थी, इसलिए नई गिनती शुरू की" : "इस पत्ते की पहली गिनती सेव हो गई";
      return `${p}${head}: ${count} हैं। अगली बार नयन इसी गिनती से मिलाकर बताएगा।${finished}${tapNote}`;
    }
    case "new_strip":
      return `${p}लगता है नया पत्ता खोला गया है। इस पत्ते की गिनती नई शुरू हुई: ${count} हैं।${finished}${tapNote}`;
    case "ok_take_now": {
      const dose = cur && cur.tablets > 1 ? `${slot} की खुराक (${cur.tablets} गोलियाँ)` : `${slot} की खुराक`;
      const after = r.canMarkTaken ? " लेने के बाद 'मैंने अभी ली' दबाइए।" : " पर यह पत्ता खाली है।";
      return `${p}गिनती ठीक है। पर्चे के हिसाब से अभी ${dose} का समय है, और गिनती से लगता है कि यह अभी नहीं ली गई।${after}`;
    }
    case "already_taken": {
      const day = cur && localDate(new Date(cur.at)) === localDate(now) ? "आज " : "";
      const what = cur && cur.tablets === 1 ? "गोली" : "खुराक";
      return `${p}रुकिए, लगता है ${day}${slot} की ${what} पहले ही ले ली गई है। दोबारा न लें। शक हो तो परिवार से पूछिए।${finished}`;
    }
    case "ok": {
      const next = r.next ? ` अगली खुराक ${SLOT_HI[r.next.slot]} ${hhmm(r.next.at)} बजे है।` : "";
      return `${p}गिनती ठीक है। अभी इस दवा की खुराक का समय नहीं है।${next}${finished}`;
    }
    case "extra_taken":
      return `${p}सावधान! गिनती में ${pockets(r.difference)} उम्मीद से ज़्यादा खाली ${isAre(r.difference)}। हो सकता है दवा दो बार ले ली गई हो। अब इस दवा की और गोली न लें। तबीयत ठीक न लगे तो तुरंत डॉक्टर से बात कीजिए।`;
    case "missed":
      return `${p}गिनती में ${pockets(r.difference)} उम्मीद से कम खाली ${isAre(r.difference)}। लगता है पहले की कोई खुराक छूट गई है। छूटी हुई गोलियाँ एक साथ न लें। आगे क्या करना है, डॉक्टर या केमिस्ट से पूछिए।${finished}`;
  }
}

/** Short English line for sighted helpers and debugging. */
export function blisterEnglish(r: BlisterResult): string {
  const parts = [`DOSE CHECK: ${r.outcome.toUpperCase()}${r.reason ? ` (${r.reason})` : ""}`];
  if (r.observed) parts.push(`empty ${r.observed.empty}/${r.observed.total}`);
  if (r.expected != null) parts.push(`expected ${r.expected}`);
  if (r.current) parts.push(`current dose: ${r.current.slot}`);
  return parts.join(", ");
}

/** Everything else the dose check says. */
export const SAY_DOSE = {
  start: "खुराक जाँच। किस दवा का पत्ता है? नीचे से दवा चुनिए।",
  picked: (item: Pick<PrescriptionItem, "nameAsWritten" | "tag">) =>
    `${medicineLabel(item)} चुनी गई। पत्ते को पलटिए और पीछे की तरफ़ की, पूरे पत्ते की फ़ोटो लीजिए।`,
  reading: "पत्ते के खाने गिने जा रहे हैं, कृपया रुकिए।",
  cannotCheck: (item: Pick<PrescriptionItem, "nameAsWritten" | "tag">, reason: "no_schedule" | "part_dose") =>
    medicineLabel(item) + ": " + NOT_SURE[reason],
  marked: (slotHi: string) => `ठीक है, ${slotHi} की खुराक ली हुई दर्ज कर दी। अगली गिनती इसी से होगी।`,
};

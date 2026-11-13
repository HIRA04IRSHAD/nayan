// Fixed Hindi templates for the family loop, the patient-side case bookkeeping, and the shared link helpers.
import { describe, expect, it } from "vitest";
import {
  caregiverAnswerText,
  caregiverWho,
  caseShareText,
  CASE_STATUS_HI,
  stripReadingText,
  whatsappShareUrl,
} from "./caregiver-messages";
import { applyCaseView, expiredLocally, markExpired, newCaseRef } from "./caregiver-cases";
import { CASE_TTL_MS, caseUrl, createCaseZ, tokenFromLocation, type CaseView } from "./case-schema";
import { strip } from "./fixtures";
import type { CaregiverCaseRef } from "./types";

describe("caregiverWho", () => {
  it("joins relation and name, and falls back gracefully", () => {
    expect(caregiverWho({ name: "प्रिया", relation: "बेटी" })).toBe("बेटी प्रिया");
    expect(caregiverWho({ name: " प्रिया ", relation: "" })).toBe("प्रिया");
    expect(caregiverWho({ name: "", relation: "बेटा" })).toBe("बेटा");
    expect(caregiverWho(null)).toBe("परिवार वाले");
  });
});

describe("caregiverAnswerText", () => {
  // Local times, so these pass in any time zone.
  const asked = new Date(2026, 10, 10, 15, 10).toISOString();
  const now = new Date(2026, 10, 10, 15, 30);
  const base = { askedWho: "बेटी प्रिया", createdAt: asked };

  it("says a 'correct' answer as the family member's opinion, naming when it was asked", () => {
    const t = caregiverAnswerText({ ...base, answer: "correct" }, { now });
    expect(t).toBe("आज दोपहर 3 बजकर 10 मिनट पर पूछे गए पत्ते के बारे में बेटी प्रिया ने बताया: वह दवा सही है। यह उनकी राय है, नयन की जाँच नहीं।");
  });

  // The answer can arrive while another strip is in the user's hand: never "यह दवा" (this medicine).
  it("never points at 'this medicine', for any answer", () => {
    for (const answer of ["correct", "wrong"] as const) {
      const t = caregiverAnswerText({ ...base, answer }, { now });
      expect(t).not.toMatch(/यह दवा|इसे/);
      expect(t).toContain("पूछे गए पत्ते के बारे में");
    }
  });

  it("names a matched prescription line when the case has one", () => {
    expect(caregiverAnswerText({ ...base, answer: "correct", askedAbout: "Dolo 650" }, { now })).toContain(
      "पूछे गए Dolo 650 वाले पत्ते के बारे में",
    );
  });

  it("says yesterday / the day before for late answers, and leaves out an unreadable or future time", () => {
    const later = new Date(2026, 10, 11, 9, 0);
    expect(caregiverAnswerText({ ...base, answer: "correct" }, { now: later })).toMatch(/^कल दोपहर 3 बजकर 10 मिनट पर/);
    const night = new Date(2026, 10, 9, 21, 0).toISOString();
    expect(caregiverAnswerText({ ...base, createdAt: night, answer: "wrong" }, { now: later })).toMatch(/^परसों रात 9 बजे पर/);
    expect(caregiverAnswerText({ ...base, createdAt: "x", answer: "wrong" }, { now })).toMatch(/^पूछे गए पत्ते के बारे में/);
    expect(caregiverAnswerText({ ...base, createdAt: new Date(2026, 10, 12).toISOString(), answer: "wrong" }, { now })).toMatch(
      /^पूछे गए पत्ते/,
    );
  });

  it("names the prescription line the family member picked (1-based)", () => {
    expect(caregiverAnswerText({ ...base, answer: "correct", answerItemIndex: 1 }, { now })).toContain("उनके हिसाब से वह पर्चे की दवा 2 है।");
  });

  it("leaves out the line number when the prescription was replaced after the case was asked", () => {
    const savedLater = new Date(2026, 10, 10, 15, 20).toISOString();
    const savedBefore = new Date(2026, 10, 1).toISOString();
    expect(caregiverAnswerText({ ...base, answer: "correct", answerItemIndex: 1 }, { now, prescriptionSavedAt: savedLater })).not.toContain("पर्चे की दवा 2");
    expect(caregiverAnswerText({ ...base, answer: "correct", answerItemIndex: 1 }, { now, prescriptionSavedAt: savedBefore })).toContain("पर्चे की दवा 2");
  });

  it("tells the user not to take the medicine on a 'wrong' answer", () => {
    expect(caregiverAnswerText({ ...base, answer: "wrong", answerItemIndex: 0 }, { now })).toBe(
      "आज दोपहर 3 बजकर 10 मिनट पर पूछे गए पत्ते के बारे में बेटी प्रिया ने बताया: वह दवा गलत है, उसे न लें।",
    );
  });

  it("reads a note as the family member's own words, ending the sentence", () => {
    expect(caregiverAnswerText({ answer: "wrong", askedWho: "प्रिया", note: "यह पापा की दवा है" }, { now })).toBe(
      "पूछे गए पत्ते के बारे में प्रिया ने बताया: वह दवा गलत है, उसे न लें। उन्होंने लिखा: यह पापा की दवा है।",
    );
    expect(caregiverAnswerText({ answer: "correct", askedWho: "प्रिया", note: "ठीक है!" }, { now })).toMatch(/उन्होंने लिखा: ठीक है!$/);
  });

  it("falls back to 'परिवार वाले' when nobody was named", () => {
    expect(caregiverAnswerText({ answer: "correct" }, { now })).toMatch(/^पूछे गए पत्ते के बारे में परिवार वाले ने बताया: वह दवा सही है।/);
  });
});

describe("share text and links", () => {
  it("greets the caregiver and states the 48 h limit, without prescription details", () => {
    const t = caseShareText("प्रिया");
    expect(t.startsWith("प्रिया जी, ")).toBe(true);
    expect(t).toContain("48 घंटे");
    expect(t).toContain('"सही है"');
    expect(caseShareText("  ")).not.toContain("जी,");
  });

  it("builds a wa.me link with the text and the URL encoded", () => {
    const u = whatsappShareUrl("नमस्ते & हाँ", "https://x.test/c/abc#t=tok");
    expect(u.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(u.slice("https://wa.me/?text=".length))).toBe("नमस्ते & हाँ\nhttps://x.test/c/abc#t=tok");
    expect(u).not.toContain("#");
  });

  it("puts the token in the fragment, and reads it back from fragment or query", () => {
    const tok = "A".repeat(32);
    expect(caseUrl("https://nayan.test/", "abc", tok)).toBe(`https://nayan.test/c/abc#t=${tok}`);
    expect(tokenFromLocation(`#t=${tok}`, "")).toBe(tok);
    expect(tokenFromLocation("", `?t=${tok}`)).toBe(tok);
    expect(tokenFromLocation("#t=short", "")).toBeNull();
    expect(tokenFromLocation("", "")).toBeNull();
  });
});

describe("stripReadingText", () => {
  it("lists what was read, with Hindi labels and a placeholder for missing fields", () => {
    expect(stripReadingText(strip("Dolo 650", [{ salt: "Paracetamol", strength: "650 mg" }], "tablet", "08/2028"))).toBe(
      "नाम: Dolo 650 · नमक: Paracetamol 650 mg · रूप: गोली · एक्सपायरी: 08/2028",
    );
    expect(stripReadingText(strip(null, [], null, null))).toBe("नाम: नहीं पढ़ा गया · नमक: नहीं पढ़ा गया · रूप: नहीं पढ़ा गया · एक्सपायरी: नहीं पढ़ा गया");
  });
});

describe("patient-side case bookkeeping", () => {
  const created = { id: "a".repeat(32), token: "T".repeat(32), url: "https://n.test/c/x#t=y", expiresAt: "z" };
  const now = new Date("2026-11-09T10:00:00.000Z");
  const ref = newCaseRef(created, "Dolo 650", "बेटी प्रिया", now);
  const view = (over: Partial<CaseView> = {}): CaseView => ({
    id: created.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CASE_TTL_MS).toISOString(),
    caregiverName: "प्रिया",
    itemLines: ["1. Dolo 650", "2. Pan 40"],
    whatNayanRead: "",
    verdictText: "",
    status: "waiting",
    ...over,
  });

  it("starts waiting, with the link and who was asked", () => {
    expect(ref).toEqual({
      id: created.id,
      token: created.token,
      url: created.url,
      createdAt: now.toISOString(),
      itemLabel: "Dolo 650",
      askedWho: "बेटी प्रिया",
      status: "waiting",
    });
  });

  it("keeps the spoken subject only when one is given (a rule-engine match)", () => {
    expect(newCaseRef(created, "Dolo 650", "बेटी प्रिया", now, "Dolo 650").askedAbout).toBe("Dolo 650");
    expect("askedAbout" in ref).toBe(false);
  });

  it("knows when 48 h are over on its own clock", () => {
    expect(expiredLocally(ref, new Date(now.getTime() + CASE_TTL_MS - 1))).toBe(false);
    expect(expiredLocally(ref, new Date(now.getTime() + CASE_TTL_MS))).toBe(true);
    expect(expiredLocally({ ...ref, createdAt: "garbage" }, now)).toBe(true);
  });

  it("keeps the same object while the case is still waiting", () => {
    expect(applyCaseView(ref, view())).toBe(ref);
  });

  it("copies a 'correct' answer with the chosen line", () => {
    const next = applyCaseView(ref, view({ status: "answered", answer: "correct", itemIndex: 1, note: " ठीक ", answeredAt: "t" }));
    expect(next).toMatchObject({ status: "answered", answer: "correct", answerItemIndex: 1, answerLine: "2. Pan 40", note: "ठीक", answeredAt: "t" });
  });

  it("ignores a chosen line on a 'wrong' answer, and never overwrites a saved answer", () => {
    const wrong = applyCaseView(ref, view({ status: "answered", answer: "wrong", itemIndex: 0, note: "" }));
    expect(wrong.answerItemIndex).toBeUndefined();
    expect(wrong.note).toBeUndefined();
    expect(applyCaseView(wrong, view({ status: "answered", answer: "correct" }))).toBe(wrong);
  });

  it("marks only waiting cases expired", () => {
    expect(markExpired(ref).status).toBe("expired");
    const answered: CaregiverCaseRef = { ...ref, status: "answered", answer: "correct" };
    expect(markExpired(answered)).toBe(answered);
  });

  it("has a Hindi label for every status", () => {
    expect(Object.keys(CASE_STATUS_HI).sort()).toEqual(["answered", "expired", "waiting"]);
  });
});

describe("createCaseZ", () => {
  it("defaults the caregiver name and cleans text", () => {
    const r = createCaseZ.parse({ photo: "AAAA", mime: "image/jpeg", itemLines: [" a\u0001 "], whatNayanRead: "", verdictText: "" });
    expect(r.caregiverName).toBe("");
    expect(r.itemLines).toEqual(["a"]);
  });
});

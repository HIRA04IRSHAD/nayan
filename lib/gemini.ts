// Server-only. Gemini reads images into fixed JSON fields. It is never asked whether anything matches.
import { z } from "zod";
import { DOSAGE_FORMS } from "./types";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
// Tried in order when the main model is overloaded or slow. Comma-separated override in GEMINI_FALLBACK_MODELS.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-3.8-flash").split(",").map((m) => m.trim()).filter(Boolean);
const ATTEMPT_TIMEOUT_MS = 45_000;
const HEDGE_DELAY_MS = 8_000;
const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const ingredientSchema = {
  type: "OBJECT",
  properties: {
    salt: { type: "STRING", description: "Generic/salt name exactly as printed, e.g. 'Paracetamol IP'" },
    strength: { type: "STRING", nullable: true, description: "Strength exactly as printed incl. unit, e.g. '650 mg'. null if not visible." },
  },
  required: ["salt", "strength"],
};

const formSchema = { type: "STRING", enum: [...DOSAGE_FORMS], nullable: true };

const PRESCRIPTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nameAsWritten: { type: "STRING", description: "Medicine name as written by the doctor, with any number, e.g. 'Dolo 650'" },
          ingredients: { type: "ARRAY", items: ingredientSchema, description: "Only if the doctor wrote the salt/generic name. Otherwise empty." },
          form: formSchema,
          frequency: { type: "STRING", nullable: true, description: "As written: '1-0-1', 'BD', 'OD', 'HS', 'SOS'" },
          timing: { type: "STRING", nullable: true, description: "e.g. 'after food', 'before food', 'empty stomach'" },
          durationDays: { type: "INTEGER", nullable: true },
          confidence: { type: "NUMBER", description: "0 to 1: how sure you are this line was read correctly" },
        },
        required: ["nameAsWritten", "ingredients", "form", "frequency", "timing", "durationDays", "confidence"],
      },
    },
  },
  required: ["items"],
};

const confident = (inner: object) => ({
  type: "OBJECT",
  properties: { value: inner, confidence: { type: "NUMBER", description: "0 to 1" } },
  required: ["value", "confidence"],
});

const STRIP_SCHEMA = {
  type: "OBJECT",
  properties: {
    brand: confident({ type: "STRING", nullable: true }),
    ingredients: confident({ type: "ARRAY", items: ingredientSchema }),
    form: confident(formSchema),
    expiry: confident({ type: "STRING", nullable: true, description: "Expiry exactly as printed, e.g. '08/2027'" }),
  },
  required: ["brand", "ingredients", "form", "expiry"],
};

const PRESCRIPTION_PROMPT = `You are a transcription tool for an Indian medical prescription photo.
Copy each prescribed medicine into the JSON fields. Do not interpret, correct, suggest or judge anything.
- Ignore patient name, age, address, phone and doctor details: do not output them.
- "Tab"/"Cap"/"Syp"/"Inj" give the form. Write the medicine name without that prefix.
- Fill "ingredients" only if a salt/generic name is written; brand-only lines get an empty list.
- If a line is hard to read, still output your best reading but give a low confidence (below 0.6).`;

const STRIP_PROMPT = `You are a transcription tool for a photo of an Indian medicine strip (blister pack) or box.
Copy what is printed into the JSON fields. You must NOT say whether it is correct or matches anything.
- ingredients: from the composition text ("Each tablet contains ..."), one entry per salt with its strength as printed.
  Copy the salt words exactly as printed, including phrases like "eq. to" or "equivalent to".
  If no composition is visible, return an empty list.
- expiry: the date after "EXP"/"Expiry", not the manufacturing date.
- confidence per field: 0.9+ only if every character is clearly legible. Glare, blur, cut-off or guessed
  characters must get a confidence below 0.6. If a field is not visible at all, use null (or []) with confidence 0.`;

// Back of a blister strip: counts only. The model is never told the schedule and never asked whether a dose
// was taken; lib/blister.ts decides that from the confirmed prescription and the last saved count.
const BLISTER_SCHEMA = {
  type: "OBJECT",
  properties: {
    total_pockets: { type: "INTEGER", description: "All pockets on the strip, full and empty. 0 if no strip is visible." },
    empty_pockets: { type: "INTEGER", description: "Pockets that are pushed through, torn open, cut open or clearly empty." },
    whole_strip_visible: { type: "BOOLEAN", description: "true only if the whole strip, every edge, is in the photo and nothing is cut off or covered" },
    confidence: { type: "NUMBER", description: "0 to 1: how sure you are of BOTH counts" },
  },
  required: ["total_pockets", "empty_pockets", "whole_strip_visible", "confidence"],
};

const BLISTER_PROMPT = `You are a counting tool for a photo of a medicine blister strip, usually its back (foil) side.
Count the pockets (each pocket holds one tablet or capsule). Only count. Do NOT say or guess whether a dose was
taken, missed or is due, and do not read or judge the medicine.
- total_pockets: every pocket on the strip, full and empty.
- empty_pockets: pockets whose foil is pushed through, torn or cut open, or that clearly hold nothing.
- whole_strip_visible: true only if the entire strip is in the photo. false if any edge is cut off, folded,
  covered by fingers, if part of the strip has been cut or torn away, or if more than one strip is visible.
- confidence: 0.9+ only if every pocket is clearly visible and you are sure of both counts. Glare, blur,
  shadows, a cut or torn strip, or any guessed pocket must get a confidence below 0.6.
- If no blister strip is visible, return 0, 0, false and confidence 0.`;

// The two reads use different counting orders on purpose: the same method tends to repeat the same mistake,
// so agreement between two different methods is better evidence than one read asked twice.
const BLISTER_METHODS = [
  "Method: count row by row, starting at the top-left pocket. Count the empty pockets the same way.",
  "Method: first count the FULL pockets, then the EMPTY pockets, and check that full + empty = total.",
] as const;

const ingredientZ = z.object({ salt: z.string(), strength: z.string().nullable() });
const formZ = z.enum(DOSAGE_FORMS).nullable();
const conf = <T extends z.ZodTypeAny>(v: T) => z.object({ value: v, confidence: z.number().min(0).max(1) });

export const prescriptionZ = z.object({
  items: z.array(
    z.object({
      nameAsWritten: z.string(),
      ingredients: z.array(ingredientZ),
      form: formZ,
      frequency: z.string().nullable(),
      timing: z.string().nullable(),
      durationDays: z.number().int().nullable(),
      confidence: z.number(),
    }),
  ),
});

export const stripZ = z.object({
  brand: conf(z.string().nullable()),
  ingredients: conf(z.array(ingredientZ)),
  form: conf(formZ),
  expiry: conf(z.string().nullable()),
});

export const blisterZ = z.object({
  total_pockets: z.number().int().min(0),
  empty_pockets: z.number().int().min(0),
  whole_strip_visible: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export type Kind = "prescription" | "strip" | "blister";

function requestBody(prompt: string, schema: object, imageBase64: string, mimeType: string): string {
  return JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: schema,
      // Copying text off a label needs no long reasoning; "low" keeps answers fast.
      thinkingConfig: { thinkingLevel: "low" },
    },
  });
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new MissingKeyError();
  return key;
}

export async function extract(kind: "prescription" | "strip", imageBase64: string, mimeType: string, deps?: GenerateDeps) {
  const key = apiKey();
  const prescription = kind === "prescription";
  const body = requestBody(prescription ? PRESCRIPTION_PROMPT : STRIP_PROMPT, prescription ? PRESCRIPTION_SCHEMA : STRIP_SCHEMA, imageBase64, mimeType);
  const { text } = await generate(key, body, deps);
  const json = JSON.parse(text);
  return prescription ? prescriptionZ.parse(json) : stripZ.parse(json);
}

export type BlisterRead = z.infer<typeof blisterZ>;

/**
 * Two independent pocket counts of the same photo (two requests, each racing the models as usual).
 * The rules only trust a count when both agree. If one read fails, it comes back as null (the rules then say
 * "not sure"); only when both fail is the error thrown, so "no key" and "busy" reach the user as usual.
 */
export async function extractBlister(imageBase64: string, mimeType: string, deps?: GenerateDeps): Promise<{ reads: [BlisterRead | null, BlisterRead | null] }> {
  const key = apiKey();
  const results = await Promise.allSettled(
    BLISTER_METHODS.map(async (method) => {
      const { text } = await generate(key, requestBody(`${BLISTER_PROMPT}\n${method}`, BLISTER_SCHEMA, imageBase64, mimeType), deps);
      return blisterZ.parse(JSON.parse(text));
    }),
  );
  if (results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  const [a, b] = results.map((r) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`Blister read failed: ${String(r.reason).slice(0, 160)}`);
    return null;
  });
  return { reads: [a, b] };
}

const RETRYABLE = new Set([429, 500, 503]);

export interface GenerateDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  models?: string[];
  /** Start the next model if the current one has not answered after this long. */
  hedgeDelayMs?: number;
  attemptTimeoutMs?: number;
}

/**
 * Gemini's latency swings from 2 s to 60 s when it is busy. Instead of waiting for one model to time out,
 * race them: start the main model, start the next one if no answer comes within hedgeDelayMs (or as soon as
 * a model fails), and use the first good answer. The others are cancelled.
 */
export function generate(key: string, body: string, deps: GenerateDeps = {}): Promise<{ text: string; model: string }> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const models = deps.models ?? [...new Set([MODEL, ...FALLBACK_MODELS])];
  const hedgeDelay = deps.hedgeDelayMs ?? HEDGE_DELAY_MS;
  const attemptTimeout = deps.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const winner = new AbortController();

  async function tryModel(model: string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(1000);
      if (winner.signal.aborted) throw new Error("cancelled");
      const res = await doFetch(ENDPOINT(model), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.any([winner.signal, AbortSignal.timeout(attemptTimeout)]),
      }).catch((e: Error) => {
        // Timeout or network error: a hung model is not worth a second wait.
        throw new Error(`Gemini ${model}: ${e.name}`);
      });
      if (res.ok) {
        const data = await res.json();
        const text: string | undefined = data?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
        if (!text) throw new Error(`Gemini ${model}: no content`);
        return text;
      }
      const error = `Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`;
      // A used-up quota will not recover in a second, so only a temporary overload is retried.
      const quotaUsedUp = res.status === 429 && /quota/i.test(error);
      if (!RETRYABLE.has(res.status) || quotaUsedUp || attempt === 1) throw new Error(error);
      console.warn(error.slice(0, 120));
    }
    throw new Error(`Gemini ${model}: gave up`);
  }

  return new Promise((resolve, reject) => {
    const errors: string[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let started = 0;
    let running = 0;
    let done = false;

    const finish = () => {
      done = true;
      timers.forEach(clearTimeout);
      winner.abort();
    };

    const launch = () => {
      if (done || started >= models.length) return;
      const model = models[started++];
      running++;
      tryModel(model).then(
        (text) => {
          if (done) return;
          finish();
          console.info(`Gemini read OK with ${model}`);
          resolve({ text, model });
        },
        (e: Error) => {
          running--;
          if (done) return;
          errors.push(e.message);
          console.warn(e.message.slice(0, 120));
          if (started < models.length) launch();
          else if (running === 0) {
            finish();
            reject(new Error(errors.join(" | ")));
          }
        },
      );
    };

    launch();
    for (let i = 1; i < models.length; i++) timers.push(setTimeout(launch, i * hedgeDelay));
  });
}

export class MissingKeyError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set");
  }
}

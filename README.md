# Nayan v2 — prescription-locked medicine check (Hindi, voice-first)

**The AI reads, the rules decide.** Gemini only copies text from photos into fixed JSON fields.
A deterministic TypeScript rule engine compares those fields with the saved, user-confirmed
prescription and returns `match` / `no_match` / `not_sure`, spoken in Hindi.

## Run

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY (https://aistudio.google.com/apikey)
npm run dev                  # http://localhost:3000
npm test                     # rule-engine unit tests
```

With no API key the camera buttons report it, and the **डेमो** section still works
(sample prescription + 7 sample strips covering every verdict).
To try it on a phone, deploy to Vercel (camera needs HTTPS) and set `GEMINI_API_KEY` there.

## Flow

1. **Setup**: photo of prescription → `/api/extract` (Gemini, fields only) → every line spoken back →
   confirmed by voice ("हाँ/नहीं") or tap; a caregiver can edit fields → saved on the phone. **नया पर्चा** keeps the old
   prescription, its tags and dose counts until the new one is saved (a failed read or a cancel changes nothing).
2. **Strip check**: photo of strip → fields → `checkAgainstPrescription()` → verdict in Hindi.
3. **Tactile tag**: on the first `match`, the strip gets the next free tag (एक बिंदु, दो बिंदु, …) and
   Nayan says where to stick it and what it means. Daily identification is then by touch.
4. **Family confirmation**: from any verdict (prominently after "पक्का नहीं"), **परिवार से पूछें** sends the case to a
   known family member as a private link; their सही/गलत answer is read aloud and kept in the **परिवार** tab.
5. **Dose check (blister)**: at dose time, **खुराक जाँच (ब्लिस्टर)** (Check and Today screens) → pick the medicine →
   photo of the back of the strip → pockets counted twice → warns if the dose seems already taken, e.g.
   "लगता है आज सुबह की गोली पहले ही ले ली गई है।"
6. **आज (Today)**: today's doses slot by slot with tag drawings and status, **आज की दवाएँ सुनें**, **मैंने ली** per dose,
   and Hindi reminders at each dose time while the app is open. The app shell works offline (service worker).

## Today, reminders and offline

**Today list** (`lib/today.ts`, pure, tested in `lib/today.test.ts`; screen `components/screens/TodayScreen.tsx`).
From the saved prescription, `settings.slotTimes` and `store.doseLog`:

- Each line's slots come from `parseFrequency` ("1-0-1" = morning and night). Lines are grouped by slot, in time order,
  with the tactile tag drawing, the name, food timing and tablets per dose ("2-0-1" → 2 in the morning).
- Status per dose, always a word + icon (never colour alone): **बाद में** (upcoming) until 30 min before the slot time,
  **अभी लेने का समय** (now) until 2 h after it, then **दर्ज नहीं** (missed = not marked: Nayan cannot know whether it was
  taken), or **ली गई** once marked. These windows are for reminding and marking; the blister check keeps its own wider
  windows (1 h before / 4 h after) for counting pockets.
- **मैंने ली** (or **मैंने ली थी** for a passed dose) appends `{ itemId, slot, date, at }` to `store.doseLog`, dated by today's
  date, which the blister check also uses to tell which dose is missing. A mistaken tap can be undone
  (**निशान हटाएँ**). A due countable medicine also gets **पत्ता गिनकर जाँचें**, which opens the blister check for it.
- Course length: a line with `durationDays` is listed from the day the prescription was saved (`savedAt`, day 1) for that
  many calendar days, then moves to **दिन पूरे हुए**. With an unknown save date nothing is hidden (hiding a medicine that is
  still prescribed is the worse mistake). Doses whose window had closed before the prescription was saved are left out.
- As-needed (SOS) lines and lines whose schedule is not understood are listed separately and never reminded.
- **आज की दवाएँ सुनें** reads a fixed template (`lib/today-messages.ts`), naming medicines by tag, e.g.
  "सुबह 8 बजे: एक बिंदु वाली दवा, खाना खाने के बाद।" An unmarked past dose is spoken as "ली हुई दर्ज नहीं है" with a
  note not to take it together with the next dose and to ask the doctor or chemist.
- The log keeps 60 days (`DOSE_LOG_DAYS`); older entries are dropped when a dose is added.

**Reminders** (`components/app/useReminders.ts`, lives in `AppProvider`, so it works on every screen). With
**याद दिलाना: चालू** the plan is checked every 30 s and whenever the page becomes visible. At a slot time (not before,
until 2 h after) with something unmarked, Nayan speaks "सुबह 8 बजे। एक बिंदु वाली दवा लेने का समय हो गया है। … अगर पहले
ही ले ली है, तो दोबारा न लें।", shows an in-app banner (tag drawings, **आज की सूची खोलें**, **बंद करें**; it disappears once
the doses are marked), and, if the user allowed it, a system notification (through the service worker's
`showNotification`, which Android Chrome requires; tapping it brings the app forward). Each slot is announced once per
day (`store.remindersFired`, shared with other tabs and kept across reloads). Settings on the Today screen: on/off,
notification permission, and the four slot times (in order, at least 1 h apart, also night → next morning, so dose
windows never collapse; `validateSlotTimes`).

> **Limitation, said in the app too**: reminders work only while Nayan is open (on screen, or alive in the background).
> A closed app, or a phone that freezes the background tab, gets no reminder. That needs **push notifications sent from a
> server** (Web Push + a scheduler), which is out of scope. Users are told to also set a phone alarm for essential doses.

**Offline** (`public/sw.js`, registered by `lib/pwa.ts` in production builds only). The worker precaches the start page,
manifest and icons, plus the scripts, styles and font the page uses (found in the cached HTML, and reported by the page
after registration), so the installed app opens without internet and the saved medicines, tags and Today list work.
Navigations are network-first with the cached page as fallback; `/_next/static/*` (content-hashed) is cache-first;
**`/api/*` is never cached or answered by the worker** (photo reading, lookups and family links need the server; a stale
API answer must never become a verdict). Family links (`/c/…`) are not cached and show a Hindi "no internet" page offline.
The cache is named after the build (`/sw.js?v=<build id>`, set in `next.config.mjs`); a new build installs a new worker,
which deletes older Nayan caches. In development any leftover worker is unregistered. While offline every screen shows a
short notice of what still works. The manifest has 192/512 px PNG icons and a maskable icon
(`node scripts/make-icons.mjs` redraws them from the logo).

**Speech** (`lib/speech.ts`, `lib/announce.ts`, `AppContext`). What the user asked for (a verdict, a read-out) is spoken
at once. Background announcements (reminders, family answers) are queued and wait until no photo is being read,
nothing is being spoken and the yes/no microphone is closed, so they never cut off a verdict. Browsers refuse speech
until the page has had a tap; until then the text only appears in the "नयन ने कहा" live region (screen readers read
it) and is spoken after the first tap. **नयन की आवाज़: बंद** (मेरी दवाएँ) is for TalkBack/VoiceOver users: Nayan then
only updates the live region and moves focus, so the reader and the app never talk at the same time.

## Dose check: blister pocket count (`lib/blister.ts`)

A **warning aid**, not a pill tracker the user must rely on, and never medical advice: it never tells the user to take
extra tablets to catch up.

1. The user picks the medicine (big buttons with the tactile tag drawing; the back of a strip usually has no brand).
   Only lines with a fixed whole-tablet schedule can be checked (not SOS, unknown patterns, or "½-0-½").
2. Photo of the back of the strip → `/api/extract` kind `blister`. The server makes **two independent Gemini reads**
   of the same photo (two requests, each racing the models as usual, with two different counting methods: row by row,
   and full-then-empty) into a fixed schema: `total_pockets`, `empty_pockets`, `whole_strip_visible`, `confidence`.
   The model only counts; it is never shown the schedule and never asked whether a dose was taken.
3. `evaluateBlister()` decides, from the confirmed schedule (`parseFrequency`/`tabletsPerSlot`, slot times from
   settings) and the strip's last saved count (`store.blisterBaselines`):
   `expected = baseline.emptyPockets + tablets scheduled after baseline.at up to now (+1 h)`.

| Outcome | When | Says |
|---|---|---|
| not sure | reads disagree, confidence < 0.85, strip not whole / torn / several strips, impossible numbers, no fixed schedule, ½ tablets (also "0.5"), one dose short but unclear which, or one dose short after a count made shortly before the dose time | asks for a new photo or to ask family |
| first count | no saved count (or it is > 10 days old) | saves it; next time it compares |
| new strip | pocket total changed, or fewer empty pockets than last time | starts a new count |
| dose still in strip | one current dose short, every earlier expected dose accounted for | restates the dose time; "मैंने अभी ली" after taking it |
| already taken | as expected, during the current dose's window | "…पहले ही ले ली गई है। दोबारा न लें।" |
| ok | as expected, no dose due | next dose time (keeps the saved count) |
| extra | more empty than expected | strong warning: possible double dose, do not take more, see a doctor if unwell |
| missed | fewer than expected beyond the current dose | do not take missed tablets together; ask the doctor or chemist |

Precise rules (all unit-tested in `lib/blister.test.ts`): a dose's window opens 1 h before its time and closes 4 h after
it, or earlier where the next dose's window opens (so at most one dose is "current"; the night window runs past
midnight and a night dose marked after midnight is logged on the night's date). When a count is saved during a dose
window, the photo is assumed to already show that dose; if the user takes it after the photo, **मैंने अभी ली** adds it
(and appends `store.doseLog`). With more than one dose expected since the last count and one missing, Nayan cannot
tell which one is missing, so it says "not sure" unless the dose log accounts for the earlier ones.
A tablet can also be taken hours early and then counted before its window opens: that count already shows the dose.
So "dose still in strip" is only said when the saved count was made at an earlier dose time, or at least 6 h
(`EARLY_TAKE_MS`) before this dose; otherwise one dose short is "not sure" (`count_before_dose`). An "ok" check between
doses keeps the saved dose-time count for the same reason (it predicts every later check the same way). Changing the
dose times (**दवा का समय बदलें**) drops all saved counts (`withSlotTimes`): a count measured against the old times could
count a taken dose twice; the next check starts a new count. Every ambiguity therefore ends as "already taken, do not
take again" or "not sure", never "take it now". Hindi text: `lib/blister-messages.ts` (names the medicine by its
tactile tag, e.g. "दो बिंदु वाली दवा: …").

**Limitations**: the counts rely entirely on the photo; torn or cut strips, folded strips and photos with several
strips give "not sure". A pocket emptied for any other reason (a dropped tablet, a strip shared between people) looks
like a dose. Swapping between two open strips of the same medicine confuses the count (finish one strip first).
A tablet taken more than an hour early, after a count made at a dose time, looks like an extra pocket (warned as a
possible double dose).

## Family confirmation (caregiver link)

Unlike volunteer apps, the helper knows the patient. Flow:

1. **Patient** (परिवार tab): saves the family member's name and relation (on the phone only).
2. **Ask** (Check screen, `components/app/useCaregiverCases.ts`): `POST /api/cases` with the strip photo (≤ 2 MB,
   JPEG/PNG/WebP, signature checked), the prescription lines (as spoken by `describeItem`), what Nayan read and what it
   said. The phone gets `{ id, token, url }`, saves the case in `store.cases`, and opens the share sheet
   (`navigator.share`). If that is unavailable or blocked, the panel offers **WhatsApp पर भेजें** (`https://wa.me/?text=…`)
   and **लिंक कॉपी करें**. Demo strips (no camera photo) send a drawn, clearly labelled demo picture.
3. **Caregiver** opens `/c/<id>#t=<token>` (`app/c/[id]/page.tsx`): strip photo, prescription lines, what Nayan read,
   two big buttons **सही है / गलत है**, optional "which medicine?" and note. One answer only (a second gets 409).
4. **Back on the phone**: while the app is open, waiting cases are polled every 5 s (paused when hidden, stopped when
   answered/expired). The answer can arrive minutes later while another strip is in the user's hand, so the fixed
   template names the case by when it was asked (and by the prescription line when the rules had matched it), never
   "this medicine": "आज दोपहर 3 बजकर 10 मिनट पर पूछे गए पत्ते के बारे में बेटी प्रिया ने बताया: वह दवा सही है। यह उनकी
   राय है, नयन की जाँच नहीं।" / "…: वह दवा गलत है, उसे न लें।" The helper's line number is dropped if the prescription
   was replaced since. The answer waits for a quiet moment (see "Speech" below).

**Safety**: a family answer is shown and spoken as the family member's opinion. It is never turned into a rule-engine
`match` and never assigns a tactile tag (tags still come only from `checkAgainstPrescription()`).

**Security**: random 128-bit id + separate 192-bit token (`crypto.randomBytes`, base64url). Viewing, the photo and
answering all need the token; only its SHA-256 is stored and it is compared in constant time. A wrong token looks like
an unknown case (404); "expired" (410) is only told to the token holder. The token sits in the URL **fragment**, so it
is never sent with the page request, in a Referer, or to WhatsApp's link preview. API calls send it in an
`x-case-token` header (the photo is fetched with it and shown through a `blob:` URL), never in a query string, which
access logs would keep; `?t=` is still accepted from pages loaded before this change. All input is validated with zod
(`lib/case-schema.ts`, text length limits, no unknown fields); responses are `no-store`; the page is `noindex` and
`no-referrer`. No personal data goes in the URL besides id and token.

**Storage** (`lib/case-store.ts`): `CaseStore` is the interface (create / get / answer / expire); `FileCaseStore` writes
`data/cases/<id>.json` (record + token hash), `<id>.jpg` (photo) and `<id>.answer.json` (created with an exclusive
`wx` flag, so two answers can never both win). Set `NAYAN_CASES_DIR` to use another folder and `NAYAN_PUBLIC_URL` when
the app runs behind a proxy (the link's origin). Cases expire after **48 hours**: they are no longer served, are deleted
when touched, and are swept at most every 10 minutes when a new case is created. At most 500 live cases are kept
(new ones get 503) so an open endpoint cannot fill the disk.

> **Hosting**: the file store works locally and on a normal Node server with a persistent disk. Serverless hosting
> such as **Vercel has no persistent disk** (instances are short-lived and do not share files), so cases would vanish
> between requests there. Production needs a database implementation of `CaseStore` — **Supabase** (Postgres row +
> Storage bucket for the photo) is the planned option. `getCaseStore()` in `lib/case-store.ts` is the only place to swap.

## Reading reliability (`lib/gemini.ts`)

Gemini's response time swings between 2 s and 60 s when it is busy. Nayan races the models: it starts
`GEMINI_MODEL` (default `gemini-3.6-flash`), starts the next fallback (`gemini-3.5-flash`, then `gemini-3.8-flash`)
if there is no answer within 8 s or as soon as one fails, and uses the first valid answer. Thinking is set to "low"
because copying a label needs no long reasoning.

## End-to-end check

`npm run eval -- <folder of photos>` sends real photos through the same pipeline (prescription files need
`rx` in the name). Last run (4 Nov 2026, printed prescription + 7 strip photos): prescription read 3/3 lines at
0.98 confidence; verdicts correct for match, other brand same salt ("eq. to" wording), strength differs,
expired, heavy blur (not sure) and expiry cut off (not sure).

## Medicine database

Brand → salt, strength and form come from the
[A-Z Medicine Dataset of India](https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india)
(Shudhanshu Singh, **CC BY-SA 4.0**, single version from Nov 2022): 253,971 medicines.

- `data/build_drugdb.py` turns the CSV into `data/medicines.json.gz` (4.4 MB, committed so the app deploys).
  Rebuild after downloading the CSV into `data/raw/`:
  `python -I data/build_drugdb.py data/raw/A_Z_medicines_dataset_of_India.csv`
- The server loads it once (~1.3 s) and answers `POST /api/drugs/lookup`; the phone never downloads it.
- Lookup rules (`lib/drugdb.ts`): exact name first; a no-number brand ("Pantocid Tablet") matches "Pantocid 40" only if
  40 is its strength; small spelling errors are allowed but **numbers must match exactly**, decimals are kept
  (12.5 mcg ≠ 125 mcg); names shared by different medicines, and entries with incomplete compositions, return
  nothing ("not sure").
- Python (`data/nayan_normalize.py`) and TypeScript (`lib/normalize.ts`) normalise names the same way: both pass
  `data/normalize_cases.json`.
- Confirmed salts are saved with the prescription, so daily checks don't depend on the lookup.

## Verification rules (`lib/rules.ts`)

| Check | Rule | Fails → |
|---|---|---|
| Confidence | each field ≥ 0.85, or read identically in two scans | not sure |
| Salt | every salt equal after normalisation (IP/BP, HCl/sodium, synonyms) | no match |
| Strength | exact after unit conversion (500 mg ≠ 650 mg, 50 mcg ≠ 50 mg) | no match (strength differs) |
| Form | tablet/capsule/syrup… equal | no match |
| Expiry | expiry month not yet over | no match (expired) |
| Combination | every salt and strength must match | no match |
| Unknown brand | not in drug DB and no composition printed | not sure |

Deliberate choices:
- Brand→salt fallback is used **only when no composition is printed**, and only on an exact brand-name hit.
  A printed composition that is hard to read is never replaced by the database.
- Brand fuzzy search never fuzzes numbers (`Telma 40` can never become `Telma 80`).
- A strength with no unit (`Paracetamol 650`) compares by number, like a pharmacist reads it.

## Layout

```
app/page.tsx            thin entry → components/NayanApp.tsx (picks the screen)
app/layout.tsx          Noto Sans Devanagari, theme boot script (no light/dark flash)   app/globals.css  design system
components/app/         AppContext (useApp: say/banner, tabs, busy, camera inputs), usePrescriptionFlow,
                        useStripCheck (verdict + tag + two-scan "not sure"), useLookups, tabs.ts
components/shell/       AppShell, SaidBanner ("नयन ने कहा" live region + replay), BottomNav (4 tabs)
components/screens/     Setup, Review (one medicine per card), Check + VerdictCard, Medicines, Today, Family,
                        DoseCheckScreen + DoseVerdictCard (blister, full screen; hook components/app/useBlisterCheck.ts)
components/ui/          Button, Icon, TagIcon (tactile tag drawings), ReadingProgress, ScreenTitle
lib/store.ts            saved state "nayan.state.v2" (migrates "nayan.prescription.v1"), useNayan(), updaters
app/api/extract/        server route → lib/extract-api.ts (zod-validated body, size limit) → Gemini, fixed schema
lib/rules.ts            rule engine (the only place a verdict is made)
lib/normalize.ts        salts, strengths, expiry, brand names
lib/drugdb.ts           brand → salts lookup (pure)   lib/drugdb-server.ts  loads the full index
app/api/drugs/lookup/   server lookups for the phone
data/build_drugdb.py    Kaggle CSV → data/medicines.json.gz   data/drugs.json  29-brand list used in unit tests
lib/messages.ts         fixed Hindi templates   lib/speech.ts  browser TTS + speech recognition
lib/case-schema.ts      caregiver case limits + zod schemas (shared)   lib/case-store.ts  CaseStore + file store
lib/case-api.ts         case route handlers (app/api/cases/**)          lib/case-client.ts browser calls
lib/caregiver-messages.ts  family-loop Hindi templates                  lib/caregiver-cases.ts  poll bookkeeping
lib/blister.ts          dose check rules (pocket counts vs schedule)   lib/blister-messages.ts  its Hindi templates
app/c/[id]/             caregiver page → components/caregiver/CaregiverCasePage.tsx
lib/today.ts            today's dose list, statuses, reminder timing, slot-time rules   lib/today-messages.ts  Hindi
components/app/useReminders.ts  reminders while open    components/shell/ReminderBanner.tsx, OfflineNotice.tsx
components/screens/ReminderSettings.tsx  on/off, notification permission, slot times
lib/pwa.ts              service worker registration + system notifications    public/sw.js  offline cache
scripts/make-icons.mjs  PWA PNG icons from the logo (uses the sharp that Next.js installs)
```

## Not built yet (from the 6-week plan)

- Supabase implementation of `CaseStore` for serverless hosting (the file store needs a persistent disk).
- Reminders while the app is closed (needs Web Push from a server; reminders while it is open are built).
- Evaluation harness over the collected prescription/strip dataset.

Nayan is a verification aid, not medical advice.

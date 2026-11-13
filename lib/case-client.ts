// Browser-side calls to the caregiver case API. Used by the patient's phone (create, poll) and the caregiver
// page (view, answer). Every response is validated with the shared schemas in lib/case-schema.ts.

import { caseViewZ, createdCaseZ, type AnswerCaseBody, type CaseView, type CreateCaseBody, type CreatedCase } from "./case-schema";
import { ApiError } from "./client";

const caseUrlPath = (id: string, suffix = "") => `/api/cases/${encodeURIComponent(id)}${suffix}`;

export async function createCase(body: CreateCaseBody): Promise<CreatedCase> {
  const res = await fetch("/api/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `http_${res.status}`);
  const parsed = createdCaseZ.safeParse(data);
  if (!parsed.success) throw new ApiError("bad_response");
  return parsed.data;
}

/** "gone" = unknown, wrong token or expired: the link will never work again. Network errors throw. */
export type CaseFetch = { kind: "ok"; view: CaseView } | { kind: "gone"; expired: boolean };

// The token goes in a header, never in the URL: URLs are kept in access logs (see tokenParam in lib/case-api.ts).
// Same name as CASE_TOKEN_HEADER there; not imported, so the browser bundle does not pull in the server module.
const TOKEN_HEADER = "x-case-token";

export async function fetchCase(id: string, token: string): Promise<CaseFetch> {
  const res = await fetch(caseUrlPath(id), { cache: "no-store", headers: { [TOKEN_HEADER]: token } });
  if (res.status === 404 || res.status === 410) return { kind: "gone", expired: res.status === 410 };
  if (!res.ok) throw new ApiError(`http_${res.status}`);
  const parsed = caseViewZ.safeParse(await res.json());
  if (!parsed.success) throw new ApiError("bad_response");
  return { kind: "ok", view: parsed.data };
}

/**
 * The strip photo as a Blob, fetched with the token in a header (an <img src> could only carry it in the URL).
 * The caller shows it through URL.createObjectURL. "gone" as in fetchCase; network errors throw.
 */
export async function fetchCasePhoto(id: string, token: string): Promise<Blob | "gone"> {
  const res = await fetch(caseUrlPath(id, "/photo"), { cache: "no-store", headers: { [TOKEN_HEADER]: token } });
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) throw new ApiError(`http_${res.status}`);
  return res.blob();
}

export type AnswerOutcome = { kind: "ok"; view: CaseView } | { kind: "already"; view: CaseView } | { kind: "gone"; expired: boolean };

export async function sendAnswer(id: string, body: AnswerCaseBody): Promise<AnswerOutcome> {
  const res = await fetch(caseUrlPath(id, "/answer"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 404 || res.status === 410) return { kind: "gone", expired: res.status === 410 };
  const data: unknown = await res.json().catch(() => ({}));
  if (res.status === 409) {
    const v = caseViewZ.safeParse((data as { case?: unknown }).case);
    if (v.success) return { kind: "already", view: v.data };
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `http_${res.status}`);
  const parsed = caseViewZ.safeParse(data);
  if (!parsed.success) throw new ApiError("bad_response");
  return { kind: "ok", view: parsed.data };
}

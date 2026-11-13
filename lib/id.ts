/**
 * A random id for prescription lines and caregiver cases.
 * crypto.randomUUID only exists in a secure context (https or localhost); a phone opening the dev server
 * over http://192.168.x.x has none, so fall back to a timestamp + random string there.
 */
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

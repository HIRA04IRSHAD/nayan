// Where things live: the website at "/", the app at "/app" (public/manifest.webmanifest start_url and scope),
// family links at /c/<id>. Pure helpers, no DOM, so the ?demo=1 rules are unit-tested (lib/app-url.test.ts).

/** The app's path (manifest start_url and scope; the service worker's cached page). */
export const APP_PATH = "/app";

/** The website (about Nayan). */
export const SITE_PATH = "/";

/** The website's "Try the demo" link: the app opens the demo prescription when nothing is saved yet. */
export const DEMO_PATH = `${APP_PATH}?demo=1`;

/** Does this query string ask for the demo ("?demo=1", also "?demo" or "?demo=true")? */
export function wantsDemo(search: string): boolean {
  const value = new URLSearchParams(search).get("demo");
  return value !== null && ["", "1", "true", "yes"].includes(value.trim().toLowerCase());
}

/**
 * The same address without the demo parameter (other parameters and the #fragment are kept), for
 * history.replaceState: a reload, a bookmark or "Add to home screen" must not start the demo again.
 * Returns a path (+ query + fragment), never an origin.
 */
export function withoutDemoParam(href: string): string {
  const url = new URL(href, "http://nayan.invalid");
  url.searchParams.delete("demo");
  return url.pathname + url.search + url.hash;
}

// Nayan service worker: lets the installed app (/app) open without internet.
//
// What works offline: the app shell (page, scripts, styles, font, icons) and everything saved on the phone
// (prescription, tags, the Today list, dose log, reminders while open). What does not: reading photos
// (/api/extract), medicine lookups, family links, and the website at /. Those need the server, so /api/* is never
// cached or answered from here: a stale or invented API answer could become a wrong verdict.
//
// The website (/) is never precached or cached: it streams a large pond video and a 3D model from another host
// (cross-origin requests are never touched here), and its own scripts are fetched from the network.
//
// Strategy:
// - Navigations to the app (/app, /app?demo=1, /app/…): network first (always the newest page when online), the
//   cached app page when offline.
// - Other navigations (the website /, family links /c/…): network only, never stored; a short Hindi "no internet"
//   page when offline, with a link to the app.
// - /_next/static/*: cache first. Next.js puts a content hash in these names, so a cached copy never goes stale.
//   Only files requested by the app (or reported by it) are stored; the website's files go straight to the network.
// - Icons and the manifest: cached copy at once, refreshed in the background.
// - Everything else, including /api/* and other origins: not touched (the browser fetches it normally).
//
// Registered by lib/pwa.ts only in production builds, as /sw.js?v=<build id>, with scope "/" so family links keep
// their offline page (the manifest's scope is /app). The cache name carries the build id; a new build installs a
// new worker and the activate step deletes every older Nayan cache.

const VERSION = new URL(self.location.href).searchParams.get("v") || "0";
const PREFIX = "nayan-";
const CACHE = PREFIX + "shell-" + VERSION;

/** The app's start page (manifest start_url). */
const APP_PAGE = "/app";

/** The start page and the files the manifest and notifications point at. */
const SHELL = [APP_PAGE, "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
const STATIC_FILES = new Set(SHELL.slice(1));

/** Is this path the app (/app or below)? "/apple" is not. */
const isAppPath = (pathname) => pathname === APP_PAGE || pathname.startsWith(APP_PAGE + "/");

/** Script, style and font URLs mentioned in a page's HTML (they were loaded before this worker existed). */
function staticUrlsIn(html) {
  const found = html.match(/\/_next\/static\/[A-Za-z0-9._~%@\/-]+/g) || [];
  return [...new Set(found)];
}

const isNextStatic = (url) => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");

async function cacheQuietly(cache, urls) {
  await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      const page = await cache.match(APP_PAGE);
      if (page) await cacheQuietly(cache, staticUrlsIn(await page.text()));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// The app page sends the static files it loaded before this worker took control (lib/pwa.ts).
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "cache-urls" || !Array.isArray(data.urls)) return;
  const urls = data.urls
    .slice(0, 200)
    .map((u) => {
      try {
        return new URL(u, self.location.origin);
      } catch {
        return null;
      }
    })
    .filter((u) => u && isNextStatic(u))
    .map((u) => u.pathname + u.search);
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const missing = [];
      for (const u of urls) if (!(await cache.match(u))) missing.push(u);
      await cacheQuietly(cache, missing);
    }),
  );
});

const OFFLINE_PAGE = `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>इंटरनेट नहीं है</title><style>body{font:20px/1.55 system-ui,sans-serif;background:#0d0830;color:#f4f2ff;margin:0;padding:24px 16px}
h1{font-size:32px;margin:0 0 12px}a{color:#a9aeff}</style></head><body><main><h1>इंटरनेट नहीं है</h1>
<p>यह पन्ना खोलने के लिए इंटरनेट चाहिए। इंटरनेट चालू करके दोबारा खोलिए।</p><p><a href="${APP_PAGE}">नयन खोलें</a></p></main></body></html>`;

const offlineResponse = () => new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });

/** The app page: newest from the network (and kept), the kept copy when offline. */
async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // One copy of the app page, whatever the query (?demo=1 is handled by the page itself).
    if (response.ok && new URL(response.url || request.url).pathname === APP_PAGE) await cache.put(APP_PAGE, response.clone());
    return response;
  } catch {
    const page = await cache.match(APP_PAGE);
    return page || offlineResponse();
  }
}

/** The website and family links: never stored (family links are private; the website is heavy and online-only). */
async function fromNetworkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineResponse();
  }
}

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** A static file asked for by the website: served from the cache if the app already stored it, never stored. */
async function fromCacheOrNetwork(request) {
  const hit = await caches.match(request);
  return hit || fetch(request);
}

/** Is the page that made this request the app? Unknown clients count as the app (the old behaviour). */
async function requestedByApp(clientId) {
  if (!clientId) return true;
  try {
    const client = await self.clients.get(clientId);
    return !client || isAppPath(new URL(client.url).pathname);
  } catch {
    return true;
  }
}

async function fromCacheThenRefresh(event, path) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(path);
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (response.ok) await cache.put(path, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) || Response.error();
}

/**
 * Which strategy a request gets. Pure (no caches, no network), so the rules are unit-tested (lib/sw.test.ts loads
 * this file in a sandbox). "pass" = not touched: the browser fetches it normally.
 * @param {{ method: string, url: string, mode: string }} request
 * @returns {"pass" | "network-first" | "network-only" | "cache-first" | "refresh"}
 */
function routeFor(request) {
  if (request.method !== "GET") return "pass";
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return "pass"; // the website's video, 3D model and fonts included
  if (url.pathname.startsWith("/api/")) return "pass"; // never cached, never answered from here
  if (request.mode === "navigate") return isAppPath(url.pathname) ? "network-first" : "network-only";
  if (isNextStatic(url)) return "cache-first";
  if (STATIC_FILES.has(url.pathname)) return "refresh";
  return "pass";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const route = routeFor(request);
  if (route === "pass") return;
  const url = new URL(request.url);
  if (route === "network-first") event.respondWith(fromNetworkFirst(request));
  else if (route === "network-only") event.respondWith(fromNetworkOnly(request));
  else if (route === "cache-first")
    event.respondWith(requestedByApp(event.clientId).then((app) => (app ? fromCacheFirst(request) : fromCacheOrNetwork(request))));
  else event.respondWith(fromCacheThenRefresh(event, url.pathname));
});

// Tapping a dose reminder brings the open app to the front, or opens it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = windows.find((w) => isAppPath(new URL(w.url).pathname));
      if (app) return app.focus();
      return self.clients.openWindow(APP_PAGE);
    })(),
  );
});

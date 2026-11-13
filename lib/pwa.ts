// Browser-only helpers for the installable, offline app: the service worker (public/sw.js) and system
// notifications for dose reminders. No React here; every function is safe to call where the API is missing.

/** The service worker's script URL for this build. A new build → a new URL → the browser installs the new worker. */
export const serviceWorkerUrl = (buildId: string) => `/sw.js?v=${encodeURIComponent(buildId)}`;

/**
 * The worker's scope stays "/" although the app is at /app: family links (/c/…) keep their Hindi offline page,
 * and one registration covers both. The worker itself only stores the app (/app) and never the website (/),
 * see routeFor() in public/sw.js.
 */
export const SERVICE_WORKER_SCOPE = "/";

/** Is this registration's script Nayan's worker (any build)? Only ours is removed in development. */
export const isOurWorker = (scriptUrl: string | undefined) => {
  if (!scriptUrl) return false;
  try {
    return new URL(scriptUrl).pathname === "/sw.js";
  } catch {
    return false;
  }
};

/**
 * Register public/sw.js in production builds only (called by the app at /app, never by the website). In development a worker left over from an earlier
 * production run on this origin is removed instead: it would answer the dev server's requests from its cache.
 * After registering, the worker is told which static files this page already loaded (they were fetched before
 * the worker existed), so the app shell is complete offline from the first visit.
 */
export function registerServiceWorker({ production, buildId }: { production: boolean; buildId: string }): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  if (!production) {
    void sw
      .getRegistrations()
      .then((regs) => regs.filter((r) => isOurWorker(r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL)))
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    return;
  }
  sw.register(serviceWorkerUrl(buildId), { scope: SERVICE_WORKER_SCOPE })
    .then(() => sw.ready)
    .then((reg) => {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => {
          try {
            const url = new URL(u);
            return url.origin === location.origin && url.pathname.startsWith("/_next/static/");
          } catch {
            return false;
          }
        });
      reg.active?.postMessage({ type: "cache-urls", urls });
    })
    .catch(() => {
      /* no worker: the app still works online, just not offline */
    });
}

export type NotifyPermission = NotificationPermission | "unsupported";

export function notificationPermission(): NotifyPermission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

/** Ask for permission (call it from a tap: browsers ignore requests without a user gesture). */
export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (notificationPermission() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationPermission();
  }
}

/**
 * Show a system notification when permission was granted. Prefers the service worker's showNotification
 * (the only way on Android Chrome, where `new Notification()` throws), else the page-level constructor.
 * `tag` replaces an earlier notification for the same dose instead of stacking a second one.
 */
export async function showSystemNotification(title: string, body: string, tag: string): Promise<boolean> {
  if (notificationPermission() !== "granted") return false;
  const options: NotificationOptions = { body, tag, lang: "hi", icon: "/icon-192.png", badge: "/icon-192.png" };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    /* fall through to the page-level notification */
  }
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

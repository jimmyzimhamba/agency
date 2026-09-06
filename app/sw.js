// Agency Command — service worker
// Makes the app open instantly and work (in read-only "last synced" mode)
// even with a weak or dropped connection. Bump CACHE_VERSION any time you
// want to force everyone's phone to fetch fresh files.
const CACHE_VERSION = "sxc-v176";

// Plain fetch() has no timeout of its own — on a flaky/carrier-throttled
// mobile-data connection a request can sit "pending" indefinitely instead
// of failing fast. That's what left people stuck on the boot logo forever:
// the navigation fetch below never resolved AND never rejected, so it never
// fell back to the cached app shell either. Wrapping it in an abortable
// timeout forces a decision within a few seconds either way.
function fetchWithTimeout(req, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(req, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Two navigable "front doors" live at the site root now: "./" / "index.html"
// is the public marketing landing page, and "app.html" is the actual
// installable app shell (manifest.json's start_url points there). Both are
// precached and both get the same offline-shell treatment below — the
// landing page needs it too, not because it needs to work offline as
// marketing, but because every home-screen shortcut saved *before* this
// split existed still points at the old address ("/" or "/index.html"), and
// index.html's own inline script bounces those installed-standalone visits
// straight to app.html. That bounce has to work offline too, or an existing
// installed user with no signal would hit a dead end before the redirect
// script ever got a chance to run.
const APP_SHELL = [
  "./",
  "index.html",
  "app.html",
  "offline.html",
  "manifest.json",
  "css/styles.css",
  "js/config.js",
  "js/supabaseClient.js",
  "js/state.js",
  "js/auth.js",
  "js/ui.js",
  "js/utils.js",
  "js/theme.js",
  "js/push.js",
  "js/whatsapp.js",
  "js/badges.js",
  "js/globalSearch.js",
  "js/printDoc.js",
  "js/main.js",
  "js/views/pipeline.js",
  "js/views/discovery.js",
  "js/views/copilot.js",
  "js/views/prospectDetail.js",
  "js/views/prospectForm.js",
  "js/views/bulkImport.js",
  "js/views/niches.js",
  "js/views/dashboard.js",
  "js/views/messages.js",
  "js/views/tasks.js",
  "js/views/activity.js",
  "js/views/team.js",
  "js/views/onboarding.js",
  "js/views/pipelineValue.js",
  "js/views/dealPricing.js",
  "js/views/installApp.js",
  "js/views/contracts.js",
  "js/views/invoices.js",
  "js/views/projects.js",
  "js/views/gridPlans.js",
  "js/views/services.js",
  "js/views/portfolio.js",
  "js/views/community.js",
  "js/views/empire.js",
  "js/views/pitchPractice.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/mark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept the live database/auth calls — those must always hit
  // the network so everyone sees real, current data.
  if (url.hostname.includes("supabase.co")) return;

  // The public client review page is a separate page, not part of this
  // installable app's shell — it isn't in APP_SHELL and was never meant to
  // work offline. Left un-excluded, a device that also has the main app
  // installed (same origin, scope "/") would have review.html navigations
  // silently cached under its own key below, and a dropped connection while
  // a client is reviewing would serve them a cached AGENCY page instead of
  // an error — so it's excluded outright rather than patched to behave
  // "correctly," since "no offline support here" is the actually-correct
  // behavior for this one page.
  if (url.pathname.endsWith("/review.html")) return;

  // Same reasoning as review.html above: the public portfolio showcase is
  // its own standalone page (not in APP_SHELL, no offline support intended)
  // and must never get cached, or a dropped connection while a prospect is
  // browsing someone's showcase would serve them a cached AGENCY page
  // instead of an error.
  if (url.pathname.endsWith("/portfolio.html")) return;

  // Page navigations: try the network first (freshest app), but give up
  // after 8 seconds if it's just hanging (not erroring) and fall back to
  // whatever was cached under that exact address — and finally the offline
  // page if nothing is cached at all. This is what makes the app open at
  // all on a stalled mobile-data connection instead of sitting on the boot
  // logo forever: a slightly stale cached page that actually opens beats a
  // "fresh" one that never arrives.
  //
  // Caching is keyed by the request itself (not a single hardcoded name)
  // now that there are two real front doors — "/" and "app.html" each get
  // their own cache entry, so a dropped connection on one doesn't serve the
  // other one's content by mistake. If somehow neither exact address was
  // ever cached, the last-resort fallback reaches for the real app shell
  // (app.html) rather than the marketing page, then finally offline.html —
  // "something that opens" should always mean the app, not a sales pitch.
  if (req.mode === "navigate") {
    event.respondWith(
      fetchWithTimeout(req, 8000)
        .then((res) => {
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match("app.html")).then((r) => r || caches.match("offline.html"))
        )
    );
    return;
  }

  // Everything else (our own JS/CSS/icons, the Supabase library, fonts):
  // serve from cache instantly, and refresh the cache in the background.
  // Same timeout logic here so a stalled background refresh can't hang
  // around indefinitely either, even though it's not blocking anything the
  // user sees (cached wins immediately when available).
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetchWithTimeout(req, 8000)
        .then((res) => {
          if (res && res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// A pop-up notification arrived from the send-push Edge Function (someone
// added a prospect, or one got assigned to you). Show it — this fires even
// if the app itself isn't open, as long as the browser/OS is running.
// Defaults to app.html (not "/") so a notification always opens straight
// into the real app, never the marketing landing page.
self.addEventListener("push", (event) => {
  let data = { title: "Agency Command", body: "You have an update.", url: "app.html" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload — fall back to the defaults above.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: data.url || "app.html" },
    })
  );
});

// Tapping the notification focuses an already-open tab if there is one,
// otherwise opens a fresh one straight into the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "app.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

/* Service worker: Web Push + app-shell cache.
 *
 * Push half (unchanged): displays notifications.
 *
 * Cache half: makes reopening the app paint instantly. Cold opens used to
 * sit on a white screen for however long the document took to arrive — this
 * worker serves the cached page shell (splash included) immediately while
 * the network refreshes it in the background; the next load sees the fresh
 * one. Rules:
 *   - navigations (HTML) and Next client-router payloads (RSC header) →
 *     stale-while-revalidate
 *   - /_next/static/* and other immutable assets → cache-first
 *   - /api/* and everything else → straight to the network, never cached
 *
 * Auth stays correct: the server still guards every real request, and the
 * app's data layer hard-navigates to /login when the dashboard API 401s, so
 * a cached shell with an expired session boots into the login page. The
 * first load after this worker installs is still a normal network load.
 */

const SHELL_CACHE = "olives-shell-v1";
const MAX_ENTRIES = 120; // bounded; old build hashes age out via eviction

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      for (const n of names) {
        if (n !== SHELL_CACHE) await caches.delete(n);
      }
      await self.clients.claim();
    })(),
  );
});

// --- cache key ---------------------------------------------------------------
// The HTML navigation for /notes and the router's RSC payload fetch share a
// URL (the payload carries an `RSC: 1` header), so payloads get a distinct
// key or the two responses would collide in the cache. Query strings are
// dropped for the same reason: pages read them client-side, the shell HTML
// is the same either way.
function cacheKey(request) {
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  return request.headers.has("rsc") ? key + "?__rsc" : key;
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
    await cache.delete(k).catch(() => {});
  }
}

// Only cache real, un-redirected, cacheable responses — a redirect to
// /login (expired session) must never be stored under the guarded page's
// key, or the login HTML would masquerade as that page later.
function cacheableResponse(res) {
  if (!res.ok) return false;
  if (res.redirected) return false;
  const cc = res.headers.get("cache-control") || "";
  return !/(no-store|private)/i.test(cc);
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);
  const network = fetch(request)
    .then((res) => {
      if (cacheableResponse(res)) {
        cache.put(key, res.clone()).then(() => trim(cache));
      }
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(network); // refresh for the NEXT load
    return cached;
  }
  const res = await network;
  if (res) return res;
  throw new Error("offline and not cached");
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(cacheKey(request));
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(cacheKey(request), res.clone()).then(() => trim(cache));
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // data is always live

  if (request.mode === "navigate" || request.headers.has("rsc")) {
    event.respondWith(
      staleWhileRevalidate(event, request).catch(() => fetch(request)),
    );
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(css|js|png|svg|ico|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request).catch(() => fetch(request)));
  }
  // Everything else: default browser handling.
});

// --- push --------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Olives", {
      body: data.body || "Time to check in on your tasks.",
      tag: data.tag || "olives", // 11/17/21 replace each other
      renotify: true,
      icon: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const w of wins) {
        if ("focus" in w) return w.focus();
      }
      await self.clients.openWindow(event.notification.data?.url || "/");
    })(),
  );
});

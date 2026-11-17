// workout tracker service worker: the app opens instantly in a gym with no signal.
//
// - Offline pages (OFFLINE_PAGES, incl. Today at /): network-first with a short timeout, cached copy otherwise.
//   Their HTML carries the data the logger needs (catalogue, routines, Previous, records), so the
//   cached copy is a usable logger; the active workout itself lives in IndexedDB.
// - Every other navigation is network-only; offline it gets the /offline page ("needs a connection").
// - /_next/static (hashed, immutable): cache-first. Other same-origin public assets: stale-while-revalidate.
// - Catalogue images (IMAGE_HOSTS, pinned commit, immutable): cache-first, fetched with CORS.
// - /api/*, server actions, RSC fetches: never cached (the IndexedDB outbox handles writes).
// - "warm" message (src/client/offline-cache.ts): re-fetches every offline page + its static assets
//   (at most once a minute, unless `force`),
//   caches the given image URLs, then prunes static assets no cached page references.
// Bump VERSION when the cache layout changes; activate deletes caches from other versions.

const VERSION = "v1";
const PAGES = `workout-tracker-pages-${VERSION}`;
const STATIC = `workout-tracker-static-${VERSION}`;
const IMAGES = `workout-tracker-images-${VERSION}`;
const CACHES = [PAGES, STATIC, IMAGES];

const OFFLINE_URL = "/offline";
const OFFLINE_PAGES = ["/", "/workout", "/workouts", "/routines", "/exercises", "/records"];
// Query parameters the cached copy of a page handles on the device (e.g. /workout?routine=…). Any other
// parameter needs the server (e.g. /workout?planned=…), so offline it gets the /offline page instead.
const OFFLINE_QUERY = ["routine"];
// Dumb Mode's clip-art (#28, src/styles/tokens.css) is precached too, so the gym stays dumb with no signal.
const CLIPART = ["/images/dumb/dumbbell.svg", "/images/dumb/star.svg", "/images/dumb/sun.svg"];
const PUBLIC_ASSETS = ["/manifest.webmanifest", "/images/exercise-placeholder.svg", "/icons/icon-192.png", ...CLIPART];
const IMAGE_HOSTS = ["raw.githubusercontent.com"];
const NETWORK_TIMEOUT_MS = 3000;
const WARM_INTERVAL_MS = 60_000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([warmPage(OFFLINE_URL), caches.open(STATIC).then((c) => c.addAll(PUBLIC_ASSETS))])
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "warm") event.waitUntil(warm(event.data.images ?? [], event.data.force === true));
});

// Web Push (src/server/push/sender.ts PushMessage: {title, body?, url, tag}). Every push must show a
// notification (iOS revokes subscriptions that push silently). Tapping it opens `url` (e.g. the
// pending plan change to confirm), reusing an open window when there is one.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : undefined };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Workout Tracker", {
      body: data.body,
      tag: data.tag,
      data: { url: data.url || "/inbox" },
      icon: "/icons/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/inbox", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin && "focus" in w);
      if (open) {
        await open.focus();
        return open.navigate(url).catch(() => self.clients.openWindow(url));
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(navigate(event, url));
  } else if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(STATIC, request));
    else if (isPublicAsset(url.pathname)) event.respondWith(staleWhileRevalidate(event, STATIC, request));
  } else if (IMAGE_HOSTS.includes(url.hostname) && request.destination === "image") {
    event.respondWith(cacheFirst(IMAGES, corsRequest(url.href)));
  }
});

function isPublicAsset(path) {
  return path.startsWith("/icons/") || path.startsWith("/images/") || path === "/manifest.webmanifest";
}

async function navigate(event, url) {
  const path = url.pathname;
  const offlinePage = OFFLINE_PAGES.includes(path) && [...url.searchParams.keys()].every((k) => OFFLINE_QUERY.includes(k));
  const network = fetch(event.request);
  // The copy is cached on the side. The page never waits for (or depends on) the write: a streamed page (one
  // with a loading screen) arrives with its first bytes, and a failed write must not fall back to a stale copy.
  event.waitUntil(
    network
      .then(async (response) => {
        if (!(offlinePage && url.search === "" && isPage(response))) return;
        const copy = response.clone(); // before the page starts reading the body
        await (await caches.open(PAGES)).put(path, copy);
      })
      .catch(() => {}),
  );

  const cached = offlinePage ? await caches.match(path, { cacheName: PAGES }) : undefined;
  if (!cached) return network.catch(() => offlineFallback(path));
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

async function offlineFallback(path) {
  // The home screen icon opens "/" (Today); if it was never cached, open the logger rather than nothing.
  if (path === "/" && (await caches.match("/workout", { cacheName: PAGES }))) return Response.redirect("/workout", 302);
  return (await caches.match(OFFLINE_URL, { cacheName: PAGES })) ?? Response.error();
}

function isPage(response) {
  return response.ok && response.type === "basic" && !response.redirected && isHtml(response);
}

function isHtml(response) {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(cacheName)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event, cacheName, request) {
  const cached = await caches.match(request, { cacheName });
  const network = fetch(request).then(async (response) => {
    if (response.ok) await (await caches.open(cacheName)).put(request, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  return cached ?? network;
}

function corsRequest(href) {
  return new Request(href, { mode: "cors", credentials: "omit" });
}

let lastWarm = 0;
let warming = Promise.resolve();

/**
 * Keeps the offline caches fresh. Serialised; pages are re-fetched at most once a minute, or right away
 * when `force` (the pages changed under the same URLs, e.g. Dumb Mode was toggled).
 */
function warm(images, force = false) {
  warming = warming.then(async () => {
    if (force || Date.now() - lastWarm > WARM_INTERVAL_MS) {
      const results = await Promise.all([OFFLINE_URL, ...OFFLINE_PAGES].map((p) => warmPage(p).catch(() => false)));
      if (results.every(Boolean)) {
        lastWarm = Date.now();
        await pruneStatic().catch(() => {});
      }
    }
    await Promise.all(images.map((href) => cacheFirst(IMAGES, corsRequest(href)).catch(() => {})));
  });
  return warming;
}

/** Fetches a page; if it came back as itself (signed in, no redirect), caches it and the static assets it uses. */
async function warmPage(path) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const pages = await caches.open(PAGES);
  // Signed out: forget the owner's pages rather than keep serving them.
  if (response.redirected && new URL(response.url).pathname === "/sign-in") await pages.delete(path);
  if (!isPage(response)) return false;
  const html = await response.clone().text();
  await pages.put(path, response);
  await cacheAssets(staticAssetsIn(html));
  return true;
}

async function cacheAssets(paths) {
  const cache = await caches.open(STATIC);
  await Promise.all(
    paths.map(async (path) => {
      if (await cache.match(path)) return;
      const response = await fetch(path);
      if (!response.ok) return;
      if (path.endsWith(".css")) await cacheAssets(staticAssetsIn(await response.clone().text()));
      await cache.put(path, response);
    }),
  );
}

function staticAssetsIn(text) {
  return [...new Set(text.match(/\/_next\/static\/[^"'\s\\)<>,]+/g) ?? [])];
}

/** Drops hashed assets from older builds: anything no cached page (or cached CSS) refers to. */
async function pruneStatic() {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  const used = new Set();
  for (const request of await pages.keys()) {
    for (const path of staticAssetsIn(await (await pages.match(request)).text())) used.add(path);
  }
  for (const request of await statics.keys()) {
    if (request.url.endsWith(".css")) {
      for (const path of staticAssetsIn(await (await statics.match(request)).text())) used.add(path);
    }
  }
  for (const request of await statics.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/_next/static/") && !used.has(path)) await statics.delete(request);
  }
}

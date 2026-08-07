const CACHE_NAME = "family-memories-v114";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];
// Precached at install time so there's a fallback available even on someone's
// very first load, but NOT part of APP_SHELL - these rarely change, so
// they're handled by the opportunistic-cache "isLocalImage" branch below
// (populate cache on success, fall back to cache on failure) rather than the
// app-shell's force-bypass-HTTP-cache strategy, which would be wasteful
// bandwidth-wise for large images that don't need to be re-fetched every load.
const PRECACHE_IMAGES = [
  "./assets/images/hero.jpg",
  "./assets/images/memories.jpg",
  "./assets/images/trips.jpg",
  "./assets/images/celebrations.jpg",
  "./assets/images/study.jpg",
  "./assets/images/memories-hero.jpg",
  "./assets/images/trips-hero.jpg",
  "./assets/images/celebrations-hero.jpg",
  "./assets/images/study-hero.jpg",
  "./assets/images/gallery-hero.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each file independently instead of cache.addAll(), which
      // rejects (and aborts the ENTIRE install) if even one file 404s.
      // A single missing/renamed asset must never again be able to block
      // every future update from activating - that's what caused the
      // old service worker to keep serving stale styles.css indefinitely.
      Promise.all(
        APP_SHELL.concat(PRECACHE_IMAGES).map((url) =>
          cache.add(url).catch((err) =>
            console.warn("SW: failed to precache", url, err)
          )
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// IMPORTANT: network-first for the app shell (index.html/styles.css/app.js).
// These files change often during active development - if served cache-first,
// updates never show up because the service worker itself only re-installs
// when sw.js's own bytes change, which doesn't happen just from editing
// index.html/styles.css. Cache is now only an offline fallback.
//
// {cache:"reload"} is essential here, not optional: GitHub Pages sends
// Cache-Control: max-age=300 on these files, and a plain fetch() honors that
// freshness window like any normal request - meaning within 5 minutes of a
// previous load, even a genuine force-quit + relaunch could silently get a
// browser-HTTP-cached response with no network round-trip at all, so a fix
// that was just pushed wouldn't show up until that 5-minute window happened
// to expire. {cache:"reload"} forces the browser to bypass that freshness
// check and always revalidate with the network.
//
// Local static images (assets/images/*) are a separate case: they almost
// never change once uploaded, so there's no need to force-bypass HTTP cache
// for them - but a single flaky network request (e.g. the hero photo
// failing to load once on a shaky connection) had NO fallback at all before,
// showing a broken-image icon with no retry. Now every successful load gets
// opportunistically saved, so a later failed fetch for the same image can
// fall back to the last-known-good copy instead of just breaking.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isAppShellFile = APP_SHELL.some((f) => url.pathname.endsWith(f.replace("./", "/")));
  const isLocalImage = url.origin === self.location.origin && /\/assets\/images\//.test(url.pathname);

  if (isAppShellFile) {
    event.respondWith(
      fetch(req, { cache: "reload" })
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else if (isLocalImage) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
  }
});

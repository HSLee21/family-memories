const CACHE_NAME = "family-memories-v186";
// Images live in their own cache that is NOT tied to the app version and is
// deliberately never deleted on activate. Using the versioned CACHE_NAME for
// images meant every single update wiped out everything previously cached,
// including all the hero/icon images - so right after every update, Home
// (and the Celebrations/Trips/Memories hero photos) had to fetch every image
// over the network from scratch before displaying properly, showing broken
// placeholders in the meantime. Images almost never change, so there's no
// good reason their cache should be tied to how often the app code changes.
const IMAGE_CACHE_NAME = "family-memories-images-v1";
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
// These images are NOT precached at install time anymore (see below for
// why) - listed here only for reference/documentation of what's covered by
// the runtime cache-first strategy further down.
// - hero.jpg, memories.jpg, trips.jpg, celebrations.jpg, study.jpg,
//   memories-hero.jpg, trips-hero.jpg, celebrations-hero.jpg,
//   study-hero.jpg, gallery-hero.jpg, upcoming-event.jpg,
//   periodic-table.jpg

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each file independently instead of cache.addAll(), which
      // rejects (and aborts the ENTIRE install) if even one file 404s.
      // A single missing/renamed asset must never again be able to block
      // every future update from activating - that's what caused the
      // old service worker to keep serving stale styles.css indefinitely.
      //
      // IMPORTANT: only APP_SHELL (a handful of small text files) is
      // precached here - NOT the decorative photos. Those used to be
      // precached too, which meant every single update had to re-download
      // several MB of images (and that total kept growing release over
      // release as more images were added) before the new version could
      // finish installing - directly competing for bandwidth with
      // whatever the person was actually trying to do right after
      // updating (like logging back in). The runtime fetch handler below
      // already populates the cache for these images the first time each
      // one is actually used, which is functionally just as good without
      // that recurring install-time cost.
      Promise.all(
        APP_SHELL.map((url) =>
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
      // Only delete OLD versioned app-shell caches - never touch
      // IMAGE_CACHE_NAME, which is meant to persist across every update.
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== IMAGE_CACHE_NAME).map((k) => caches.delete(k)))
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
  const isVersionCheck = url.pathname.endsWith("/version.json");
  const isAppShellFile = APP_SHELL.some((f) => url.pathname.endsWith(f.replace("./", "/")));
  const isLocalImage = url.origin === self.location.origin && /\/assets\/images\//.test(url.pathname);

  if (isVersionCheck) {
    // This file's entire purpose is telling a page whether it's stale -
    // serving a cached copy of it would defeat that purpose entirely, so
    // it always goes straight to the network with no caching involved at
    // any layer, on top of the page's own cache:"no-store" fetch.
    event.respondWith(fetch(req, { cache: "no-store" }));
  } else if (isAppShellFile) {
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
      // Cache-first, with a background refresh: these icons rarely change,
      // so once cached they should load instantly with zero network
      // round-trip - forcing a network fetch every single time (the
      // previous approach) caused a visible one-by-one pop-in on every page
      // that uses them, since several images now had to be re-fetched in
      // sequence instead of just being read from disk.
      //
      // Still avoids the earlier "stuck broken image" problem: a cache miss
      // (first load, or nothing cached yet) uses {cache:"reload"} to bypass
      // any bad HTTP-cache entry, and every cache hit also kicks off a
      // silent background refetch to keep the cached copy from going stale
      // forever - neither of these delay what's actually shown on screen.
      caches.match(req).then((cached) => {
        if (cached) {
          fetch(req, { cache: "reload" })
            .then((res) => { if (res.ok) caches.open(IMAGE_CACHE_NAME).then((cache) => cache.put(req, res)); })
            .catch(() => {});
          return cached;
        }
        return fetch(req, { cache: "reload" })
          .then((res) => {
            if (res.ok) {
              const resClone = res.clone();
              caches.open(IMAGE_CACHE_NAME).then((cache) => cache.put(req, resClone));
            }
            return res;
          })
          .catch(() => caches.match(req));
      })
    );
  } else {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
  }
});

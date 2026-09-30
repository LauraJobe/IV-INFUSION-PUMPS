/* Service worker: lets phones and iPads install the site as an app and keeps
   it working offline.
   - On install it saves every file the app needs (APP below), so one visit
     while online is enough. (An iPad home-screen app keeps its own storage,
     separate from Safari: open it once from the home screen while online.)
   - Network first, so students get the newest version when online; the saved
     copy is used when there is no connection or the network is too slow.
   Keep APP in step with the files index.html loads (build_single.py checks). */
const CACHE = "ivp-v2";
const APP = [
  "./", "index.html", "manifest.webmanifest", "css/pump.css",
  "js/library.js", "js/pump.js", "js/spectrum.js", "js/plum.js", "js/space.js", "js/syringe.js",
  "js/scenarios.js", "js/level1.js", "js/practice.js", "js/app.js", "js/scorm.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const NET_TIMEOUT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network with a time limit; falls back to the saved copy.
function networkFirst(req) {
  const fromCache = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined));
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { fromCache().then((hit) => { if (hit && !done) { done = true; resolve(hit); } }); }, NET_TIMEOUT_MS);
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(() => fromCache().then((hit) => { if (!done) { done = true; clearTimeout(timer); resolve(hit || Response.error()); } }));
  });
}

// Web fonts: saved the first time, then used from the cache.
function cacheFirst(req) {
  return caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (FONT_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req).catch(() => Response.error()));
});

/* DemonEye service worker — offline app shell, network-first for fresh code.
   The 7 MB soundtrack is NOT precached; it is cached only after a full (non-Range) fetch. */
const CACHE = "demoneye-v1";
const SHELL = [
  "./", "./index.html", "./style.css", "./script.js",
  "./manifest.webmanifest",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.headers.get("range")) return; // let the browser stream the soundtrack normally
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.status === 200 && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});

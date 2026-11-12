// Service worker : garde l'application disponible hors ligne.
const CACHE = "mopila-v2";
const FICHIERS = const FICHIERS = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Les appels à Supabase passent toujours par le réseau (la grille est mise en cache par l'application).
  if (url.hostname.endsWith("supabase.co")) return;
  e.respondWith(
    fetch(req)
      .then((rep) => {
        if (rep.ok && (url.origin === location.origin || /jsdelivr|unpkg|gstatic|googleapis/.test(url.hostname))) {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put(req, copie));
        }
        return rep;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
  );
});

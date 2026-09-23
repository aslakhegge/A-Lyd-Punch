// Enkel service worker for Frilans Timeklokke.
// Cacher app-skallet (HTML/CSS/JS + eksterne biblioteker) slik at appen
// åpner og fungerer offline. Data hentes fra/lagres til Supabase når
// nett er tilgjengelig, og fra lokal cache (localStorage) ellers.

const CACHE_NAME = "frilans-timeklokke-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./supabase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

const EXTERNAL_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await Promise.all(
        EXTERNAL_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { mode: "no-cors" });
            await cache.put(url, res);
          } catch {
            // Ingen nett ved installasjon – hentes senere ved bruk.
          }
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") return caches.match("./index.html");
        throw new Error("Ingen nett og ingenting i cache for " + req.url);
      }
    })()
  );
});

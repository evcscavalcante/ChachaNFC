const CACHE_NAME = "bafometro-nfc-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./theme-google.css",
  "./app.js",
  "./indicadores.css",
  "./indicadores.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./favicon-v1.png",
  "./icon-192-v1.png",
  "./icon-512-v1.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        throw new Error("Recurso indisponível offline");
      })
  );
});

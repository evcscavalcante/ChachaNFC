const CACHE_NAME = "bafometro-nfc-v7";
const APP_SHELL = [
  "./",
  "./manifest.webmanifest",
  "./theme-google.css",
  "./indicadores.css",
  "./indicadores.js",
  "./favicon-v1.png",
  "./icon-192-v1.png",
  "./icon-512-v1.png"
];

async function prepareHtml(response) {
  if (!response) return response;

  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;

  let html = await response.text();

  const additions = [];
  if (!html.includes("theme-google.css")) {
    additions.push('<link rel="stylesheet" href="./theme-google.css">');
  }
  if (!html.includes("indicadores.css")) {
    additions.push('<link rel="stylesheet" href="./indicadores.css">');
  }
  if (!html.includes("indicadores.js")) {
    additions.push('<script src="./indicadores.js" defer></script>');
  }
  if (!html.includes("favicon-v1.png")) {
    additions.push('<link rel="icon" type="image/png" sizes="32x32" href="./favicon-v1.png">');
    additions.push('<link rel="icon" type="image/png" sizes="192x192" href="./icon-192-v1.png">');
    additions.push('<link rel="apple-touch-icon" sizes="192x192" href="./icon-192-v1.png">');
  }
  if (additions.length) {
    html = html.replace("</head>", `  ${additions.join("\n  ")}\n</head>`);
  }

  html = html
    .replace(
      '<meta name="theme-color" content="#0f172a">',
      '<meta name="theme-color" content="#f8fafd">'
    )
    .replace(
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
    );

  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    const response = await fetch("./index.html", { cache: "no-store" });
    const prepared = await prepareHtml(response);
    await cache.put("./index.html", prepared);

    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        const prepared = await prepareHtml(response);
        const cache = await caches.open(CACHE_NAME);
        await cache.put("./index.html", prepared.clone());
        return prepared;
      } catch {
        return caches.match("./index.html");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response && response.status === 200 && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

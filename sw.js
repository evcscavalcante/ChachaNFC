const CACHE_NAME = "bafometro-nfc-v3";
const APP_SHELL = [
  "./",
  "./manifest.webmanifest",
  "./icon.svg",
  "./theme-google.css"
];

async function withGoogleTheme(response) {
  if (!response) return response;

  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;

  let html = await response.text();

  if (!html.includes("theme-google.css")) {
    html = html.replace(
      "</head>",
      '  <link rel="stylesheet" href="./theme-google.css">\n</head>'
    );
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

    const response = await fetch("./index.html");
    const themed = await withGoogleTheme(response);
    await cache.put("./index.html", themed);

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
        const response = await fetch(request);
        const themed = await withGoogleTheme(response);
        const cache = await caches.open(CACHE_NAME);
        await cache.put("./index.html", themed.clone());
        return themed;
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

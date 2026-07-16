const CACHE_NAME = "private-insurance-question-bank-v3";
const APP_BASE = new URL(self.registration.scope).pathname;
const CORE_ASSETS = [APP_BASE, `${APP_BASE}offline-seed.encrypted.json`, `${APP_BASE}manifest.webmanifest`, `${APP_BASE}apple-touch-icon.png`];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const shell = await fetch(APP_BASE);
  const html = await shell.clone().text();
  const assetUrls = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1]).filter((url) => url.startsWith("/"));
  await cache.put(APP_BASE, shell);
  await cache.addAll([...CORE_ASSETS.filter((url) => url !== APP_BASE), ...assetUrls]);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(async (cached) => {
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return caches.match(APP_BASE);
    }
  }));
});

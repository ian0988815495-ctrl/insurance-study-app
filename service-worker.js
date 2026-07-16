const CACHE_NAME = "private-insurance-question-bank-v4";
const APP_BASE = new URL(self.registration.scope).pathname;
const CORE_ASSETS = [APP_BASE, `${APP_BASE}offline-seed.encrypted.json`, `${APP_BASE}manifest.webmanifest`, `${APP_BASE}apple-touch-icon.png`];
const NETWORK_FIRST_ASSETS = new Set([`${APP_BASE}offline-seed.encrypted.json`]);

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
  if (NETWORK_FIRST_ASSETS.has(new URL(event.request.url).pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) ?? caches.match(APP_BASE);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return caches.match(APP_BASE);
  }
}

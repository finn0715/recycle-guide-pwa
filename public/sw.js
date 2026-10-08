const CACHE = "recycleguide-offline-v1";
const OFFLINE = "/offline.html";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("recycleguide-offline-") && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Never cache API traffic, audio, photos, transcripts, or authenticated pages.
  if (event.request.method !== "GET" || event.request.mode !== "navigate" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE)) || new Response("인터넷 연결 필요 / Internet connection required", { status: 503 })));
});

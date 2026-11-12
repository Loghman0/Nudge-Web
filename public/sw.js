/* Only public assets are cached. Private pages, APIs and RSC stay network-only. */
const CACHE = "nudge-public-v3";
const ASSETS = ["/offline.html", "/brand/nudge-mark.svg", "/icon-192.png", "/icon-512.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("nudge-") && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
  }
  // All other requests use the browser's normal network failure behavior.
});
self.addEventListener("push", (event) => {
  let payload = { title: "Nudge", body: "Time to check in.", url: "/notifications" };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* defaults */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body, icon: "/icon-192.png", badge: "/icon-192.png",
    data: { url: payload.url }, tag: "nudge-checkin",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/notifications", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/notifications`;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) if (client.url === url && "focus" in client) return client.focus();
    return self.clients.openWindow(url);
  }));
});

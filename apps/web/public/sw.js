const CACHE_NAME = 'sentinel-shell-v1';
const SHELL_URLS = ['/', '/today', '/offline', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/manifest.webmanifest', '/icon.svg'])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Sachet · SENTINEL',
    body: 'Health awareness update',
    url: '/caregiver',
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch {
    // fallback copy
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: payload.url || '/caregiver', alertId: payload.alertId || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/caregiver';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate?.(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

// Keep network-first for APIs; allow shell fallback cleanly without stalling online dev/tests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }
  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    );
  }
});

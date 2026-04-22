const CACHE_NAME = 'cafe-stock-v5';
const ASSETS = [
  './',
  './index.html',
  './add.html',
  './quick-add.html',
  './summary.html',
  './all-stock.html',
  './style.css',
  './tailwind.css',
  './app.js',
  './manifest.json',
  './favicon.svg',
  'https://unpkg.com/lucide@latest',
  'https://fonts.googleapis.com/css2?family=Prompt:wght@400;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS).catch(err => console.warn('SW cache addAll partial fail:', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Skip non-GET, API calls, and Firebase from caching
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/') || event.request.url.includes('firestore.googleapis.com') || event.request.url.includes('generativelanguage.googleapis.com')) {
    return;
  }

  // Network-first for local files (always get latest), cache-first for CDN assets
  const isLocal = event.request.url.includes(self.location.origin);
  
  if (isLocal) {
    // Network first — try fetching fresh, fallback to cache
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache first for CDN assets
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  }
});

// ==========================================
// Web Push Notifications
// ==========================================

self.addEventListener('push', event => {
  let data = { title: 'Cafe Stock', body: 'New notification' };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Cafe Stock', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '',
    badge: data.badge || '',
    vibrate: [200, 100, 200],
    data: data.data || { url: './index.html' }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data.url || './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      // Check if there is already a window open and focus it
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

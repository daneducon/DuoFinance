const CACHE = 'duofinance-v21';
const ASSETS = ['/', '/login', '/css/style.css?v=21', '/js/app.js?v=21', '/js/login.js?v=19', '/js/auth.js', '/js/api.js', '/js/demo.js', '/js/storage.js', '/assets/icon.svg', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request) || caches.match('/')));
    return;
  }
  if (requestUrl.pathname.startsWith('/css/') || requestUrl.pathname.startsWith('/js/')) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-finances') event.waitUntil(syncFinances());
});

async function syncFinances() {
  const database = await openDatabase();
  const items = await idbRequest(database.transaction('queue', 'readonly').objectStore('queue').getAll());
  let synced = 0;
  for (const item of items) {
    const response = await fetch('/api/financas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${item.token}` },
      body: JSON.stringify(item.payload)
    });
    if (!response.ok) break;
    await idbRequest(database.transaction('queue', 'readwrite').objectStore('queue').delete(item.queueId));
    synced++;
  }
  database.close();
  if (synced) {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.postMessage({ type: 'FINANCES_SYNCED', count: synced }));
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('duofinance', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

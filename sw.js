/* Service worker — L'Année de la Manifestation */
const VERSION = 'manif-v6';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './data/plans.json',
  './data/lsg_plan.json',
  './data/crampon_plan.json',
  './data/darby_plan.json',
  './data/martin_plan.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* ---- IndexedDB kv (shared with the page) ---- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('manif-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(key) {
  const db = await idb();
  return new Promise((res) => {
    const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    tx.onsuccess = () => res(tx.result);
    tx.onerror = () => res(undefined);
  });
}

/* ---- Rappel quotidien via Periodic Background Sync (Android/Chrome) ---- */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'rappel-lecture') e.waitUntil(maybeRemind());
});

/* Filet de sécurité : certains navigateurs réveillent le SW sur 'sync' */
self.addEventListener('sync', (e) => {
  if (e.tag === 'rappel-lecture') e.waitUntil(maybeRemind());
});

async function maybeRemind() {
  try {
    const settings = (await kvGet('settings')) || {};
    if (settings.notif === false) return;
    const today = new Date().toISOString().slice(0, 10);
    const lastNotified = await kvGet('lastNotified');
    if (lastNotified === today) return;               // déjà rappelé aujourd'hui
    const lastRead = await kvGet('lastReadDay');
    if (lastRead === today) return;                    // lecture du jour déjà faite
    const hour = parseInt((settings.time || '06:00').split(':')[0], 10);
    if (new Date().getHours() < hour) return;          // pas avant l'heure choisie
    const db = await idb();
    await new Promise((res) => {
      const tx = db.transaction('kv', 'readwrite').objectStore('kv').put(today, 'lastNotified');
      tx.onsuccess = res; tx.onerror = res;
    });
    await self.registration.showNotification('Lecture du jour 🕯️', {
      body: 'Ta parole est une lampe à mes pieds. Ouvre la lecture du jour.',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'rappel-lecture',
      data: { url: './index.html#/aujourdhui' }
    });
  } catch (err) { /* silencieux */ }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow(e.notification.data?.url || './');
    })
  );
});

/* Message depuis la page (rappel programmé pendant que l'appli est ouverte) */
self.addEventListener('message', (e) => {
  if (e.data === 'show-reminder') maybeRemind();
});

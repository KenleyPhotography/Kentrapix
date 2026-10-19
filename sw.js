// Service worker KentraPix : rend le site installable et utilisable SANS connexion une fois qu'on s'est connecté.
// Réseau d'abord (les mises à jour s'affichent tout de suite) ; ce qui a déjà été vu est gardé sur l'appareil
// comme secours hors connexion : pages, données du compte, photos consultées. Tout est effacé à la déconnexion
// et à la connexion (message « kp-clear »), pour qu'un autre compte sur le même appareil ne voie jamais ces données.
const SHELL_CACHE = 'kentrapix-shell-v9';
const DATA_CACHE = 'kentrapix-data-v1';
const MEDIA_CACHE = 'kentrapix-media-v1';
const KEEP = [SHELL_CACHE, DATA_CACHE, MEDIA_CACHE];
const SHELL = /^\/(css|js|logo|img)\/|^\/manifest\.webmanifest$/;
const DATA = /^\/api\/(auth\/me|client\/|admin\/)/; // lecture seulement (GET)
const MEDIA = /^\/media\/(thumb|preview|cover|avatar|order-cover)\//; // jamais les photos verrouillées ni les liens de partage
const MEDIA_MAX = 400;
const FONTS = /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'kp-clear') event.waitUntil(Promise.all([caches.delete(DATA_CACHE), caches.delete(MEDIA_CACHE)]));
});

async function put(name, req, res) {
  const c = await caches.open(name);
  await c.put(req, res);
}

// Réseau d'abord ; en cas d'échec réseau, la copie gardée.
async function networkFirst(req, cacheName, { ignoreSearch = false, cacheable = (r) => r.ok } = {}) {
  try {
    const res = await fetch(req);
    if (cacheable(res)) put(cacheName, req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await caches.match(req, { cacheName, ignoreSearch });
    if (hit) return hit;
    throw err;
  }
}

// Photos : on retente en mode CORS pour pouvoir les garder (le bucket en ligne doit autoriser CORS) ; sinon, comportement normal.
async function mediaFetch(req) {
  try {
    const res = await fetch(req.url, { credentials: 'same-origin' });
    if (res.ok && res.type !== 'opaque') {
      const c = await caches.open(MEDIA_CACHE);
      await c.put(req.url, res.clone());
      c.keys().then((keys) => keys.length > MEDIA_MAX && Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map((k) => c.delete(k))));
    }
    return res;
  } catch {
    const hit = await caches.match(req.url, { cacheName: MEDIA_CACHE });
    if (hit) return hit;
    return fetch(req); // CORS refusé par le bucket : affichage normal, sans copie hors connexion
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) {
    // Polices du site : copie gardée pour l'affichage hors connexion.
    if (FONTS.test(url.hostname)) {
      event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok || res.type === 'opaque') put(SHELL_CACHE, req, res.clone()).catch(() => {}); return res; })));
    }
    return;
  }

  if (SHELL.test(url.pathname)) {
    event.respondWith(networkFirst(req, SHELL_CACHE).catch(() => Response.error()));
  } else if (DATA.test(url.pathname)) {
    event.respondWith(networkFirst(req, DATA_CACHE, { cacheable: (r) => r.ok && /json/.test(r.headers.get('content-type') || '') }).catch(() => Response.error()));
  } else if (MEDIA.test(url.pathname)) {
    event.respondWith(mediaFetch(req).catch(() => Response.error()));
  } else if (req.mode === 'navigate') {
    // Pages : la copie n'est gardée que si elle n'a pas été redirigée (connexion expirée, etc.).
    event.respondWith(
      networkFirst(req, SHELL_CACHE, { ignoreSearch: true, cacheable: (r) => r.ok && !r.redirected && ['/client', '/admin', '/gallery'].includes(url.pathname) })
        .catch(async () => {
          const staff = await caches.match('/api/admin/bootstrap', { cacheName: DATA_CACHE });
          for (const p of [url.pathname, ...(staff ? ['/admin', '/client'] : ['/client', '/admin']), '/gallery']) {
            const hit = await caches.match(p, { cacheName: SHELL_CACHE });
            if (hit) return hit;
          }
          return Response.error();
        }),
    );
  }
  // Le reste (/api d'écriture, /share, /facture…) : toujours le réseau.
});

// ---------- Notifications sur téléphone (Web Push) ----------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'KentraPix', {
    body: data.body || '',
    icon: '/logo/icon-192.png',
    badge: '/logo/badge-96.png', // « K » blanc : la barre d'état Android ne garde que la silhouette
    tag: data.tag || undefined,
    renotify: !!data.tag,
    vibrate: [90, 40, 90],
    timestamp: Date.now(),
    actions: [{ action: 'open', title: 'Ouvrir KentraPix' }],
    data: { url: data.url || '/' },
  }));
});

// Toucher la notification : ouvre (ou ramène au premier plan) KentraPix sur la bonne page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        if ('navigate' in client) client.navigate(url).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});

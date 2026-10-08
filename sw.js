// Service worker KentraPix : rend le site installable et garde l'interface disponible hors ligne.
// Réseau d'abord (les mises à jour s'affichent tout de suite), cache seulement en secours.
// Les photos, la musique et l'API ne sont jamais mises en cache ici : elles restent privées.
const CACHE = 'kentrapix-v1';
const SHELL = /^\/(css|js|logo|img)\/|^\/manifest\.webmanifest$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (!SHELL.test(url.pathname)) return; // pages, /api, /media : toujours le réseau
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error())),
  );
});

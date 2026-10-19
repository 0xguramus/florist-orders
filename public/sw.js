// FLOWTRACKER service worker. Never touches /api/* or HTML (auth + fresh data always from network).
// Only versioned static assets (?v=N) and fonts are cached.
const CACHE = 'ft-static-v11';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const cacheable = url.pathname.startsWith('/fonts/') || (/\.(js|css)$/.test(url.pathname) && url.searchParams.has('v'));
  if (!cacheable) return; // HTML/navigation: default network behaviour (redirects to /login still work)
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  }));
});

// Service Worker — Cavalcante Pinheiro Advocacia
// Network-first: sempre busca dados frescos. Cache só como fallback offline.
const CACHE = 'cp-pwa-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());

self.addEventListener('fetch', e => {
  // Não faz cache de chamadas à API
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(r => {
        // Salva no cache só recursos estáticos (html, css, js, imagens)
        if (r && r.status === 200 && e.request.method === 'GET') {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

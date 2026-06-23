// ══════════════════════════════════════════════════════════
//  MAXX DIESEL — Service Worker
//  Versão: bump este número para forçar atualização do cache
// ══════════════════════════════════════════════════════════
const CACHE_VERSION = 'maxx-v1';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;

// Assets que ficam em cache permanente (Cache First)
const STATIC_ASSETS = [
  './maxx-diesel-v2.html',
  'https://cdn.jsdelivr.net/npm/chart.js',
];

// Domínios que recebem tratamento Network First
const SUPABASE_HOST = 'rktprdnhpyefmqoiqxpv.supabase.co';

// ── INSTALL: pré-cacheia assets estáticos ─────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()) // ativa imediatamente
  );
});

// ── ACTIVATE: limpa caches antigos ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('maxx-') && k !== STATIC_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // assume controle imediato
  );
});

// ── FETCH: lógica central de cache ────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ignora requisições não-HTTP (chrome-extension://, etc.)
  if (!url.protocol.startsWith('http')) return;

  // ── Supabase API → Network First ──────────────────────
  if (url.hostname === SUPABASE_HOST) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // ── CDN (Chart.js, fontes) → Cache First ──────────────
  if (
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── App HTML → Stale While Revalidate ─────────────────
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // tudo mais: tenta rede, sem cache
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// ── ESTRATÉGIAS DE CACHE ──────────────────────────────────

// Cache First: serve do cache; se não tiver, busca na rede e salva
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Sem conexão', { status: 503 });
  }
}

// Network First: tenta rede; se falhar, serve do cache
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // fallback JSON vazio para queries do Supabase
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Stale While Revalidate: serve do cache e atualiza em background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}

// ── MENSAGENS DO APP ──────────────────────────────────────
// O app pode enviar mensagens para o SW via postMessage
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});

const CACHE_NAME = 'joplock-shell-v12';
const STATIC_ASSETS = ['/styles.css', '/htmx.min.js', '/turndown.min.js', '/codemirror.min.js', '/hljs.min.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/maskable-icon-192.png', '/maskable-icon-512.png', '/apple-touch-icon.png', '/fonts/CascadiaMono-Regular.woff2', '/fonts/CascadiaMono-Bold.woff2'];

self.addEventListener('install', event => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(STATIC_ASSETS);
		})(),
	);
	self.skipWaiting();
});

self.addEventListener('activate', event => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
		})(),
	);
	self.clients.claim();
});

self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);
	// Only serve static assets from cache; everything else goes straight to network
	if (!STATIC_ASSETS.includes(url.pathname)) return;

	event.respondWith(
		(async () => {
			// Network-first for static assets, cache fallback for offline
			try {
				const networkResponse = await fetch(event.request);
				if (networkResponse.ok) {
					const cache = await caches.open(CACHE_NAME);
					cache.put(event.request, networkResponse.clone());
				}
				return networkResponse;
			} catch (e) {
				const cached = await caches.match(event.request);
				if (cached) return cached;
				throw e;
			}
		})(),
	);
});

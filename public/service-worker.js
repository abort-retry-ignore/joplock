// Joplock service worker. Policy (AGENT_GUIDE "PWA shell"): never cache anything user-specific.
//  - navigations: network, and when the network is down a static /offline.html (never a cached
//    signed-in page; the app has no offline notes)
//  - versioned scripts/stylesheets (?v=<asset version>, immutable by construction): cache-first, so a
//    relaunch does not wait on the network even if the browser's own cache was evicted
//  - everything else (API, notes, attachments, TinyMCE's own files, fonts, icons): not intercepted
// __ASSET_VERSION__ is replaced by the server with app/assetVersion.js's value when this file is
// served, so a changed deployment is a byte-different worker and gets its own cache.
const VERSION = '__ASSET_VERSION__';
const CACHE_NAME = 'joplock-shell-__ASSET_VERSION__';
const CACHE_PREFIX = 'joplock-shell-';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icon-192.png'];

self.addEventListener('install', event => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(PRECACHE);
		})(),
	);
	self.skipWaiting();
});

self.addEventListener('activate', event => {
	event.waitUntil(
		(async () => {
			// only this app's caches: other apps on the same origin keep theirs
			const keys = await caches.keys();
			await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
			await self.clients.claim();
		})(),
	);
});

const isVersionedAsset = url => url.searchParams.has('v') && /\.(?:js|css)$/.test(url.pathname) && url.pathname !== '/service-worker.js';

self.addEventListener('fetch', event => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					return await fetch(request);
				} catch (error) {
					const offline = await caches.match(OFFLINE_URL);
					return offline || Response.error();
				}
			})(),
		);
		return;
	}

	if (isVersionedAsset(url)) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE_NAME);
				const hit = await cache.match(request);
				if (hit) return hit;
				const response = await fetch(request);
				if (response.ok && response.type === 'basic') {
					// not awaited: the page gets the file as it arrives
					event.waitUntil(cache.put(request, response.clone()).catch(() => undefined));
				}
				return response;
			})(),
		);
	}
});

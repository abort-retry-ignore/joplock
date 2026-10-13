'use strict';

// Runs the real public/service-worker.js in a sandbox with fake caches/fetch/events.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ORIGIN = 'https://joplock.test';
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8').replaceAll('__ASSET_VERSION__', 'v123');

const abs = input => (typeof input === 'string' ? new URL(input, ORIGIN).href : input.url);

function makeWorker({ network = async () => { throw new Error('offline'); }, existingCaches = {} } = {}) {
	const handlers = {};
	const store = new Map(Object.entries(existingCaches).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
	const fetched = [];
	let claimed = false;
	let skipped = false;
	const cacheApi = name => {
		if (!store.has(name)) store.set(name, new Map());
		const entries = store.get(name);
		return {
			addAll: async urls => { for (const u of urls) entries.set(abs(u), { ok: true, type: 'basic', url: abs(u), clone() { return this; } }); },
			match: async req => entries.get(abs(req)),
			put: async (req, res) => { entries.set(abs(req), res); },
		};
	};
	const caches = {
		open: async name => cacheApi(name),
		keys: async () => [...store.keys()],
		delete: async name => store.delete(name),
		match: async req => { for (const entries of store.values()) if (entries.has(abs(req))) return entries.get(abs(req)); return undefined; },
	};
	const sandbox = {
		self: {
			addEventListener: (type, fn) => { handlers[type] = fn; },
			skipWaiting: () => { skipped = true; },
			clients: { claim: async () => { claimed = true; } },
			location: { origin: ORIGIN },
		},
		caches,
		URL,
		Response: { error: () => ({ isError: true }) },
		fetch: async request => { fetched.push(request.url); return network(request); },
	};
	vm.runInNewContext(source, sandbox);
	const dispatch = (type, extra = {}) => {
		const event = { waitUntil: p => { event.waited = (event.waited || []).concat(p); }, respondWith: p => { event.response = p; }, ...extra };
		handlers[type](event);
		return event;
	};
	const request = (url, { method = 'GET', mode = 'no-cors' } = {}) => ({ url: abs(url), method, mode });
	return { dispatch, request, store, fetched, flags: () => ({ claimed, skipped }) };
}

const ok = (body = 'ok') => ({ ok: true, type: 'basic', body, clone() { return this; } });

test('install precaches only the offline page and an icon, in a cache named for the version, and activates at once', async () => {
	const w = makeWorker();
	const e = w.dispatch('install');
	await Promise.all(e.waited);
	assert.deepEqual([...w.store.keys()], ['joplock-shell-v123']);
	assert.deepEqual([...w.store.get('joplock-shell-v123').keys()].sort(), [`${ORIGIN}/icon-192.png`, `${ORIGIN}/offline.html`]);
	assert.equal(w.flags().skipped, true);
});

test('activate removes older Joplock caches only, then claims the page', async () => {
	const w = makeWorker({ existingCaches: { 'joplock-shell-v1': {}, 'joplock-shell-v123': {}, 'someone-elses-cache': {} } });
	const e = w.dispatch('activate');
	await Promise.all(e.waited);
	assert.deepEqual([...w.store.keys()].sort(), ['joplock-shell-v123', 'someone-elses-cache']);
	assert.equal(w.flags().claimed, true);
});

test('navigations go to the network; a down network gets the offline page; nothing signed-in is ever stored', async () => {
	let down = false;
	const w = makeWorker({ network: async () => { if (down) throw new Error('offline'); return ok('<html>signed-in notes</html>'); } });
	await Promise.all(w.dispatch('install').waited);

	const online = w.dispatch('fetch', { request: w.request('/', { mode: 'navigate' }) });
	assert.equal((await online.response).body, '<html>signed-in notes</html>');
	assert.equal([...w.store.get('joplock-shell-v123').keys()].some(k => k === `${ORIGIN}/`), false, 'a page must not be cached');

	down = true;
	const offline = w.dispatch('fetch', { request: w.request('/', { mode: 'navigate' }) });
	assert.equal((await offline.response).url, `${ORIGIN}/offline.html`);
});

test('a navigation with no network and no cached offline page ends as a network error', async () => {
	const w = makeWorker();
	const e = w.dispatch('fetch', { request: w.request('/', { mode: 'navigate' }) });
	assert.deepEqual(await e.response, { isError: true });
});

test('versioned scripts and stylesheets are cache-first', async () => {
	let calls = 0;
	const w = makeWorker({ network: async () => { calls++; return ok('js body'); } });
	const first = w.dispatch('fetch', { request: w.request('/app.js?v=abc') });
	assert.equal((await first.response).body, 'js body');
	await Promise.all(first.waited);
	assert.equal(calls, 1);
	const second = w.dispatch('fetch', { request: w.request('/app.js?v=abc') });
	assert.equal((await second.response).body, 'js body');
	assert.equal(calls, 1, 'second request must not touch the network');
	// a different version is a different entry
	const other = w.dispatch('fetch', { request: w.request('/app.js?v=def') });
	await other.response;
	assert.equal(calls, 2);
	// styles too
	const css = w.dispatch('fetch', { request: w.request('/styles.css?v=abc') });
	await css.response;
	assert.equal(calls, 3);
});

test('failed and opaque responses are not cached', async () => {
	let kind = 'bad';
	const w = makeWorker({ network: async () => (kind === 'bad' ? { ok: false, type: 'basic', clone() { return this; } } : { ok: true, type: 'opaque', clone() { return this; } }) });
	for (kind of ['bad', 'opaque']) {
		const e = w.dispatch('fetch', { request: w.request('/app.js?v=abc') });
		await e.response;
		if (e.waited) await Promise.all(e.waited);
	}
	assert.equal(w.store.get('joplock-shell-v123').has(`${ORIGIN}/app.js?v=abc`), false);
});

test('everything else is left to the browser', () => {
	const w = makeWorker();
	const untouched = [
		w.request('/app.js'),                                   // unversioned
		w.request('/api/web/settings'),
		w.request('/fragments/editor/abc'),
		w.request('/resources/abc?v=1'),                        // versioned but not js/css
		w.request('/icon-192.png?v=1'),
		w.request('/service-worker.js?v=abc'),                  // the worker itself
		w.request('/manifest.webmanifest?v=abc'),
		w.request('/app.js?v=abc', { method: 'POST' }),
		{ url: 'https://cdn.example.com/lib.js?v=1', method: 'GET', mode: 'no-cors' }, // cross-origin
		w.request('/tinymce/plugins/link/plugin.min.js'),
	];
	for (const request of untouched) {
		const e = w.dispatch('fetch', { request });
		assert.equal(e.response, undefined, `${request.method} ${request.url} must not be intercepted`);
	}
	assert.equal(w.fetched.length, 0);
});

test('the offline page ships and does not need anything but the precached icon', () => {
	const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'offline.html'), 'utf8');
	assert.match(html, /You're offline/);
	assert.match(html, /id="retry"/);
	assert.match(html, /<style>/, 'inline styles: its stylesheet cannot be fetched offline');
	const external = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(m => m[1]);
	assert.deepEqual(external, ['/icon-192.png']);
});

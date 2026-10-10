// Pinning a notebook to the top. Per-user Joplock setting: nothing is written to the Joplin notebook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { createServer } = require('../app/createServer');
const { normalizeSettings, defaultSettings } = require('../app/settingsService');
const { notebookOptionsHtml, editorFragment } = require('../app/templates/fragments');
const { MAX_PINNED_FOLDERS } = require('../app/items/folderTree');

const FOLDERS = [
	{ id: 'archive', parentId: '', title: 'Archive', createdTime: 1 },
	{ id: 'home', parentId: '', title: 'Home', createdTime: 1 },
	{ id: 'proj', parentId: 'work', title: 'Projects', createdTime: 1 },
	{ id: 'alpha', parentId: 'proj', title: 'Alpha', createdTime: 1 },
	{ id: 'work', parentId: '', title: 'Work', createdTime: 1 },
	{ id: 'zoo', parentId: '', title: 'Zoo', createdTime: 1 },
];

// A fake whose settings store is real: saveSettings persists, so later GETs see the pins.
const startServer = async ({ pinned = [], folderSort = 'alpha', writes = [] } = {}) => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'htmx.min.js'), '// stub');
	const store = { folderSort, pinnedFolders: pinned };
	const server = createServer({
		publicDir, joplinPublicBasePath: '/joplin', joplinPublicBaseUrl: 'http://localhost:5444',
		joplinServerPublicUrl: 'http://localhost:5444/joplin', joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => FOLDERS.map(f => ({ ...f })),
			folderByUserIdAndJopId: async (u, id) => FOLDERS.find(f => f.id === id) || null,
			folderNoteCountsByUserId: async () => new Map([['__all__', 0], ['__trash__', 0]]),
			folderActivityByUserId: async () => new Map([['zoo', 90], ['home', 50], ['archive', 5]]),
			notesByUserId: async () => [], noteHeadersByUserId: async () => [],
			noteByUserIdAndJopId: async () => null,
		},
		// any Joplin write means pinning touched Joplin data: record it
		itemWriteService: new Proxy({}, { get: (t, name) => async (...args) => { writes.push([name, ...args.slice(1)]); return { id: 'x' }; } }),
		sessionService: { userBySessionId: async sid => sid === 'test-session' ? { id: 'user-1', email: 'u@example.com', sessionId: sid } : null, touchSession: async () => {}, getLastSeen: async () => null, deleteSession: async () => {} },
		settingsService: {
			settingsByUserId: async () => normalizeSettings({ ...defaultSettings, ...store }),
			saveSettings: async (u, s) => { Object.assign(store, { folderSort: s.folderSort, pinnedFolders: s.pinnedFolders }); return s; },
			appSettings: async () => ({ authRateLimitAttempts: 20 }), getTotpSeed: async () => null,
		},
		historyService: {},
		database: { query: async () => ({ rows: [] }) },
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	return { port: server.address().port, store, writes, close: () => new Promise(r => server.close(r)) };
};
const req = (port, p, { method = 'GET', cookie = 'sessionId=test-session' } = {}) => new Promise((resolve, reject) => {
	const r = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: cookie ? { Cookie: cookie } : {} }, res => {
		const chunks = [];
		res.on('data', c => chunks.push(c));
		res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
	});
	r.on('error', reject);
	r.end();
});
const navOrder = html => [...new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll('.nav-folder[data-folder-id]')].map(e => e.dataset.folderId).filter(id => !id.startsWith('__') && id.length < 20);

// ── setting ──
test('pinnedFolders normalises: array of distinct non-empty ids, capped, anything else is empty', () => {
	assert.deepEqual(defaultSettings.pinnedFolders, []);
	assert.deepEqual(normalizeSettings({}).pinnedFolders, []);
	assert.deepEqual(normalizeSettings({ pinnedFolders: ['a', ' b ', 'a', '', null, 7] }).pinnedFolders, ['a', 'b', '7']);
	for (const bad of ['a', 5, { a: 1 }, null, undefined]) assert.deepEqual(normalizeSettings({ pinnedFolders: bad }).pinnedFolders, []);
	assert.equal(normalizeSettings({ pinnedFolders: Array.from({ length: 500 }, (_, i) => `id${i}`) }).pinnedFolders.length, MAX_PINNED_FOLDERS);
	assert.deepEqual(normalizeSettings({ pinnedFolders: ['x'.repeat(65), 'ok'] }).pinnedFolders, ['ok'], 'absurdly long ids are dropped');
});

// ── endpoints ──
test('PUT pins and DELETE unpins; both are 204 and idempotent', async () => {
	const s = await startServer();
	try {
		assert.equal((await req(s.port, '/api/web/pinned-folders/zoo', { method: 'PUT' })).statusCode, 204);
		assert.deepEqual(s.store.pinnedFolders, ['zoo']);
		assert.equal((await req(s.port, '/api/web/pinned-folders/zoo', { method: 'PUT' })).statusCode, 204);
		assert.deepEqual(s.store.pinnedFolders, ['zoo'], 'pinning twice does not duplicate');
		await req(s.port, '/api/web/pinned-folders/home', { method: 'PUT' });
		assert.deepEqual(s.store.pinnedFolders, ['zoo', 'home']);
		assert.equal((await req(s.port, '/api/web/pinned-folders/zoo', { method: 'DELETE' })).statusCode, 204);
		assert.deepEqual(s.store.pinnedFolders, ['home']);
		assert.equal((await req(s.port, '/api/web/pinned-folders/never-pinned', { method: 'DELETE' })).statusCode, 204);
		assert.deepEqual(s.store.pinnedFolders, ['home']);
	} finally { await s.close(); }
});

test('pinning needs a session, an existing notebook, and forgets notebooks that no longer exist', async () => {
	const s = await startServer({ pinned: ['deleted-long-ago', 'home'] });
	try {
		assert.equal((await req(s.port, '/api/web/pinned-folders/zoo', { method: 'PUT', cookie: 'sessionId=bad' })).statusCode, 401);
		const missing = await req(s.port, '/api/web/pinned-folders/nope', { method: 'PUT' });
		assert.equal(missing.statusCode, 404);
		assert.deepEqual(s.store.pinnedFolders, ['deleted-long-ago', 'home'], 'a failed pin changes nothing');
		await req(s.port, '/api/web/pinned-folders/zoo', { method: 'PUT' });
		assert.deepEqual(s.store.pinnedFolders, ['home', 'zoo'], 'the stale id was pruned');
	} finally { await s.close(); }
});

test('pinning never writes to Joplin data', async () => {
	const s = await startServer();
	try {
		await req(s.port, '/api/web/pinned-folders/zoo', { method: 'PUT' });
		await req(s.port, '/api/web/pinned-folders/zoo', { method: 'DELETE' });
		assert.deepEqual(s.writes, [], 'no createFolder/updateFolder/updateNote... call');
	} finally { await s.close(); }
});

// ── the lists ──
test('sidebar: pinned notebooks first, flagged and marked; A-Z otherwise', async () => {
	const s = await startServer({ pinned: ['zoo', 'home'] });
	try {
		const res = await req(s.port, '/fragments/nav');
		assert.deepEqual(navOrder(res.body), ['home', 'zoo', 'archive', 'work', 'proj', 'alpha']);
		const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
		const pinnedIds = [...doc.querySelectorAll('.nav-folder[data-pinned="1"]')].map(e => e.dataset.folderId).sort();
		assert.deepEqual(pinnedIds, ['home', 'zoo']);
		assert.equal(doc.querySelectorAll('.nav-pin-icon').length, 2);
		assert.ok(doc.getElementById('folder-ctx-pin'));
	} finally { await s.close(); }
});

test('pinning a nested notebook pulls its ancestors up; it stays under its parent and is the only one flagged', async () => {
	const s = await startServer({ pinned: ['alpha'] });
	try {
		const res = await req(s.port, '/fragments/nav');
		assert.deepEqual(navOrder(res.body), ['work', 'proj', 'alpha', 'archive', 'home', 'zoo']);
		const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
		assert.deepEqual([...doc.querySelectorAll('.nav-folder[data-pinned="1"]')].map(e => e.dataset.folderId), ['alpha']);
		assert.equal(doc.querySelector('.nav-folder[data-folder-id="alpha"]').dataset.parentId, 'proj');
	} finally { await s.close(); }
});

test('pins compose with the most-recent order', async () => {
	const s = await startServer({ pinned: ['archive'], folderSort: 'recent' });
	try {
		const res = await req(s.port, '/fragments/nav');
		assert.deepEqual(navOrder(res.body).filter(id => ['archive', 'zoo', 'home'].includes(id)), ['archive', 'zoo', 'home']);
	} finally { await s.close(); }
});

test('mobile list: pinned first, marked, with the pin icon', async () => {
	const s = await startServer({ pinned: ['zoo'] });
	try {
		const res = await req(s.port, '/fragments/mobile/folders');
		const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
		const ids = [...doc.querySelectorAll('.mobile-folder-row[data-folder-id]')].map(e => e.dataset.folderId);
		assert.equal(ids[0], 'zoo');
		assert.equal(doc.querySelector('.mobile-folder-row[data-folder-id="zoo"]').dataset.pinned, '1');
		assert.equal(doc.querySelectorAll('.mobile-pin-icon').length, 1);
	} finally { await s.close(); }
});

test('pickers ignore pins: editor notebook select and the move picker stay alphabetical', async () => {
	const s = await startServer({ pinned: ['zoo'] });
	try {
		const { applyPinnedFirst } = require('../app/items/folderTree');
		const reordered = applyPinnedFirst(FOLDERS, ['zoo']);
		const values = html => [...new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll('option')].map(o => o.value);
		assert.deepEqual(values(notebookOptionsHtml(reordered)), ['archive', 'home', 'work', 'proj', 'alpha', 'zoo']);
		const editor = editorFragment({ id: 'n1', title: 'T', body: 'b', parentId: 'home', createdTime: 1, updatedTime: 2 }, reordered);
		assert.deepEqual([...new JSDOM(`<body>${editor}</body>`).window.document.querySelectorAll('#editor-folder-select option')].map(o => o.value), ['archive', 'home', 'work', 'proj', 'alpha', 'zoo']);
		const picker = await req(s.port, '/fragments/folder-options');
		assert.deepEqual([...picker.body.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]), ['archive', 'home', 'work', 'proj', 'alpha', 'zoo']);
	} finally { await s.close(); }
});

test('with nothing pinned the output has no pin markup at all', async () => {
	const s = await startServer();
	try {
		const res = await req(s.port, '/fragments/nav');
		assert.doesNotMatch(res.body, /data-pinned|nav-pin-icon/);
		assert.deepEqual(navOrder(res.body), ['archive', 'home', 'work', 'proj', 'alpha', 'zoo']);
	} finally { await s.close(); }
});

// ── client helpers ──
const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const extractFn = name => {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, name);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error(name);
};
const clientCtx = ({ mobile = false } = {}) => {
	const dom = new JSDOM(`<body>
		<div id="nav-panel">
			<div class="nav-folder" data-folder-id="f1" data-pinned="1" data-selected="1"></div>
			<div class="nav-folder" data-folder-id="f2"></div>
		</div>
		<div id="mobile-folders-body"><button class="mobile-folder-row" data-folder-id="f2" data-pinned="1"></button></div>
		<div id="folder-context-menu"><button id="folder-ctx-pin"></button></div></body>`, { url: 'http://localhost/' });
	const calls = { fetches: [], refreshed: [], alerts: [], assigned: [] };
	const ctx = vm.createContext({
		window: dom.window, document: dom.window.document, console,
		isMobileShellMode: () => mobile,
		navFolderEl: id => dom.window.document.querySelector(`#nav-panel .nav-folder[data-folder-id="${id}"]`),
		_folderMenuState: { id: 'f1', title: 'F1' },
		closeFolderContextMenu: () => {},
		_afterFolderChange: (o, id) => calls.refreshed.push([o, id]),
		alert: m => calls.alerts.push(m),
		fetch: (url, opts) => { calls.fetches.push([opts.method, url]); return Promise.resolve({ ok: ctx.__ok !== false, status: ctx.__status || 204, json: () => Promise.resolve({ error: 'Notebook not found' }) }); },
	});
	for (const name of ['_isFolderPinnedInDom', '_syncFolderMenuPin', 'setFolderPinned', 'togglePinFromMenu']) vm.runInContext(extractFn(name), ctx);
	return { ctx, calls, doc: dom.window.document };
};

test('client: pinned state is read from the DOM of the active shell', () => {
	const d = clientCtx();
	assert.equal(vm.runInContext('_isFolderPinnedInDom("f1")', d.ctx), true);
	assert.equal(vm.runInContext('_isFolderPinnedInDom("f2")', d.ctx), false);
	const m = clientCtx({ mobile: true });
	assert.equal(vm.runInContext('_isFolderPinnedInDom("f2")', m.ctx), true, 'the mobile row wins in the mobile shell');
});

test('client: the menu entry says Pin or Unpin', () => {
	const { ctx, doc } = clientCtx();
	const menu = doc.getElementById('folder-context-menu');
	vm.runInContext('_syncFolderMenuPin', ctx)(menu, 'f1');
	assert.equal(doc.getElementById('folder-ctx-pin').textContent, 'Unpin from top');
	vm.runInContext('_syncFolderMenuPin', ctx)(menu, 'f2');
	assert.equal(doc.getElementById('folder-ctx-pin').textContent, 'Pin to top');
});

test('client: toggling sends PUT to pin / DELETE to unpin, then refreshes the list keeping the selection', async () => {
	const { ctx, calls } = clientCtx();
	await vm.runInContext('setFolderPinned', ctx)('f2', true);
	await vm.runInContext('setFolderPinned', ctx)('f1', false);
	assert.deepEqual(calls.fetches, [['PUT', '/api/web/pinned-folders/f2'], ['DELETE', '/api/web/pinned-folders/f1']]);
	assert.deepEqual(calls.refreshed, [['', 'f1'], ['', 'f1']], 'the selected notebook (f1) is kept');
	// the menu action unpins f1 (it is pinned)
	await vm.runInContext('togglePinFromMenu', ctx)();
	assert.deepEqual(calls.fetches[2], ['DELETE', '/api/web/pinned-folders/f1']);
});

test('client: a refused pin shows the reason instead of failing silently', async () => {
	const { ctx, calls } = clientCtx();
	ctx.__ok = false; ctx.__status = 404;
	await vm.runInContext('setFolderPinned', ctx)('gone', true);
	assert.deepEqual(calls.alerts, ['Notebook not found']);
	assert.deepEqual(calls.refreshed, []);
});

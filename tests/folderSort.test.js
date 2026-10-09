// Notebook order: A-Z (default) or most recently updated, per user. The sidebar and the
// mobile folders list follow it; pickers stay alphabetical; children never leave their parent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { JSDOM } = require('jsdom');
const { createServer } = require('../app/createServer');
const { createItemService } = require('../app/items/itemService');
const { normalizeSettings, defaultSettings } = require('../app/settingsService');
const { navigationFragment, editorFragment, notebookOptionsHtml } = require('../app/templates/fragments');
const { settingsPage, layoutPage } = require('../app/templates');

// alphabetical, as the database returns them
const FOLDERS = [
	{ id: 'archive', parentId: '', title: 'Archive', createdTime: 1 },
	{ id: 'home', parentId: '', title: 'Home', createdTime: 1 },
	{ id: 'proj', parentId: 'work', title: 'Projects', createdTime: 1 },
	{ id: 'work', parentId: '', title: 'Work', createdTime: 1 },
	{ id: 'zoo', parentId: '', title: 'Zoo', createdTime: 1 },
];
const ACTIVITY = new Map([['archive', 5], ['home', 50], ['proj', 80], ['zoo', 90]]);

const startServer = async ({ folderSort = 'alpha', withActivity = true } = {}) => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'htmx.min.js'), '// stub');
	let activityCalls = 0;
	const saved = [];
	const itemService = {
		foldersByUserId: async () => FOLDERS.map(f => ({ ...f })),
		folderNoteCountsByUserId: async () => new Map([['__all__', 4], ['__trash__', 0]]),
		notesByUserId: async () => [],
		noteHeadersByUserId: async () => [],
		noteByUserIdAndJopId: async () => ({ id: 'n1', title: 'T', body: 'b', parentId: 'home', createdTime: 1, updatedTime: 2, deletedTime: 0, fields: {} }),
		folderByUserIdAndJopId: async (u, id) => FOLDERS.find(f => f.id === id) || null,
	};
	if (withActivity) itemService.folderActivityByUserId = async () => { activityCalls++; return new Map(ACTIVITY); };
	const server = createServer({
		publicDir, joplinPublicBasePath: '/joplin', joplinPublicBaseUrl: 'http://localhost:5444',
		joplinServerPublicUrl: 'http://localhost:5444/joplin', joplinServerOrigin: 'http://server:22300',
		itemService, itemWriteService: {},
		sessionService: { userBySessionId: async sid => sid === 'test-session' ? { id: 'user-1', email: 'u@example.com', sessionId: sid } : null, touchSession: async () => {}, getLastSeen: async () => null, deleteSession: async () => {} },
		settingsService: {
			settingsByUserId: async () => ({ folderSort }),
			saveSettings: async (u, s) => { saved.push(s); return s; },
			appSettings: async () => ({ authRateLimitAttempts: 20 }), getTotpSeed: async () => null,
		},
		historyService: {},
		database: { query: async () => ({ rows: [] }) },
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	return { port: server.address().port, saved, activityCalls: () => activityCalls, close: () => new Promise(r => server.close(r)) };
};
const req = (port, p, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
	const r = http.request({ hostname: '127.0.0.1', port, path: p, method, headers: { Cookie: 'sessionId=test-session', ...headers } }, res => {
		const chunks = [];
		res.on('data', c => chunks.push(c));
		res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
	});
	r.on('error', reject);
	if (body) r.write(body);
	r.end();
});
const navOrder = html => [...new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll('.nav-folder[data-folder-id]')].map(e => e.dataset.folderId).filter(id => !id.startsWith('__') && id.length < 20);

// ── data ──
test('folderActivityByUserId: latest note activity per notebook, live non-conflict notes only', async () => {
	let captured = '';
	const svc = createItemService({ query: async sql => { captured = sql; return { rows: [{ folder_id: 'a', latest: '1700000000000' }, { folder_id: 'b', latest: null }] }; } });
	const activity = await svc.folderActivityByUserId('u');
	assert.equal(activity.get('a'), 1700000000000);
	assert.equal(activity.get('b'), 0);
	assert.match(captured, /user_updated_time/, 'uses the note\'s user-facing updated time like Joplin');
	assert.match(captured, /jop_updated_time/, 'falls back to the row time');
	assert.match(captured, /deleted_time/);
	assert.match(captured, /is_conflict/);
	assert.match(captured, /GROUP BY jop_parent_id/);
});

// ── setting ──
test('folderSort defaults to alpha and only accepts the two values', () => {
	assert.equal(defaultSettings.folderSort, 'alpha');
	assert.equal(normalizeSettings({}).folderSort, 'alpha');
	assert.equal(normalizeSettings({ folderSort: 'recent' }).folderSort, 'recent');
	for (const v of ['RECENT', 'newest', '', null, 5]) assert.equal(normalizeSettings({ folderSort: v }).folderSort, 'alpha');
});

test('PUT /api/web/settings saves folderSort', async () => {
	const s = await startServer();
	try {
		const res = await req(s.port, '/api/web/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderSort: 'recent' }) });
		assert.equal(res.statusCode, 204);
		assert.equal(s.saved[0].folderSort, 'recent');
	} finally { await s.close(); }
});

// ── the lists that follow the setting ──
test('sidebar: alphabetical by default, most recent when chosen; parents always above their children', async () => {
	const a = await startServer({ folderSort: 'alpha' });
	try {
		const res = await req(a.port, '/fragments/nav');
		assert.deepEqual(navOrder(res.body), ['archive', 'home', 'work', 'proj', 'zoo']);
		assert.equal(a.activityCalls(), 0, 'no activity query for the default order');
	} finally { await a.close(); }

	const r = await startServer({ folderSort: 'recent' });
	try {
		const res = await req(r.port, '/fragments/nav');
		// zoo(90) > work (via proj 80) > home(50) > archive(5); proj stays directly under work
		assert.deepEqual(navOrder(res.body), ['zoo', 'work', 'proj', 'home', 'archive']);
		const doc = new JSDOM(`<body>${res.body}</body>`).window.document;
		assert.equal(doc.querySelector('.nav-folder[data-folder-id="proj"]').dataset.parentId, 'work');
		assert.equal(doc.querySelector('.nav-folder[data-folder-id="proj"]').parentElement.parentElement.dataset.folderId, 'work', 'still nested under its parent');
	} finally { await r.close(); }
});

test('mobile folders list follows the setting too', async () => {
	const r = await startServer({ folderSort: 'recent' });
	try {
		const res = await req(r.port, '/fragments/mobile/folders');
		const ids = [...new JSDOM(`<body>${res.body}</body>`).window.document.querySelectorAll('.mobile-folder-row[data-folder-id]')].map(e => e.dataset.folderId);
		assert.deepEqual(ids, ['zoo', 'work', 'proj', 'home', 'archive']);
	} finally { await r.close(); }
});

test('pickers stay alphabetical even when the sidebar is by recent activity', async () => {
	const r = await startServer({ folderSort: 'recent' });
	try {
		// the same already-reordered folder list the sidebar was built from feeds the editor's notebook select
		const options = html => [...new JSDOM(`<body>${html}</body>`).window.document.querySelectorAll('option')].map(o => o.value);
		const { sortFoldersByRecent } = require('../app/items/folderTree');
		const reordered = sortFoldersByRecent(FOLDERS, ACTIVITY);
		assert.notDeepEqual(reordered.map(f => f.id), FOLDERS.map(f => f.id), 'the list really was reordered, so the picker has something to undo');
		assert.deepEqual(options(notebookOptionsHtml(reordered)), ['archive', 'home', 'work', 'proj', 'zoo']);
		const editor = editorFragment({ id: 'n1', title: 'T', body: 'b', parentId: 'home', createdTime: 1, updatedTime: 2 }, reordered);
		assert.deepEqual([...new JSDOM(`<body>${editor}</body>`).window.document.querySelectorAll('#editor-folder-select option')].map(o => o.value), ['archive', 'home', 'work', 'proj', 'zoo']);
		// and the move / new-notebook picker endpoint
		const picker = await req(r.port, '/fragments/folder-options');
		assert.deepEqual([...picker.body.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]), ['archive', 'home', 'work', 'proj', 'zoo']);
	} finally { await r.close(); }
});

test('a server without an activity query (or one that fails) falls back to alphabetical instead of erroring', async () => {
	const r = await startServer({ folderSort: 'recent', withActivity: false });
	try {
		const res = await req(r.port, '/fragments/nav');
		assert.equal(res.statusCode, 200);
		assert.deepEqual(navOrder(res.body), ['archive', 'home', 'work', 'proj', 'zoo']);
	} finally { await r.close(); }
});

// ── UI ──
test('the sidebar header has the order switch', () => {
	const doc = new JSDOM(`<body>${navigationFragment(FOLDERS.map(f => ({ ...f })), new Map(), '', '')}</body>`).window.document;
	const btn = doc.getElementById('nav-sort-btn');
	assert.ok(btn);
	assert.match(btn.getAttribute('onclick'), /toggleFolderSort\(\)/);
	assert.ok(btn.querySelector('.sort-on-alpha') && btn.querySelector('.sort-on-recent'));
});

test('settings page offers the order and preselects the saved one; the page carries it for the client', () => {
	const selected = value => {
		const doc = new JSDOM(`<body>${settingsPage({ user: { id: 'u', email: 'e@x', fullName: 'E' }, settings: { ...defaultSettings, folderSort: value }, appSettings: null, mfaEnabled: false, isAdmin: false })}</body>`).window.document;
		return doc.getElementById('settings-folder-sort');
	};
	const alpha = selected('alpha');
	assert.ok(alpha, 'select present');
	assert.equal(alpha.value, 'alpha');
	assert.equal(selected('recent').value, 'recent');
	assert.match(alpha.getAttribute('onchange'), /saveSetting\('folderSort'/);
	const page = layoutPage({ user: { id: 'u', email: 'e@x', fullName: 'E' }, settings: { ...defaultSettings, folderSort: 'recent' }, folders: [], notes: [], counts: new Map(), navContent: '', editorContent: '', joplinBasePath: '/joplin' });
	assert.match(page, /data-folder-sort="recent"/);
	assert.match(page, /folderSort:"recent"/);
	assert.ok(page.includes('id="mobile-sort-btn"'));
});

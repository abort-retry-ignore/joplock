// Route-level behaviour for nested notebooks: move, create under a parent,
// delete-with-promotion, and the picker options endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('../app/createServer');

const request = (port, { path: requestPath, method = 'GET', headers = {}, body = null }) => new Promise((resolve, reject) => {
	const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers: { Cookie: 'sessionId=test-session', ...headers } }, res => {
		const chunks = [];
		res.on('data', c => chunks.push(c));
		res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
	});
	req.on('error', reject);
	if (body) req.write(body);
	req.end();
});
const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
const json = { 'Content-Type': 'application/json' };

const withServer = async ({ folders, notes = [], vaults = [] }, fn) => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'htmx.min.js'), '// stub');
	const state = { folders: folders.map(f => ({ parentId: '', deletedTime: 0, ...f })), notes: notes.map(n => ({ ...n })), writes: [] };
	let seq = 0;
	const server = createServer({
		publicDir,
		joplinPublicBasePath: '/joplin',
		joplinPublicBaseUrl: 'http://localhost:5444',
		joplinServerPublicUrl: 'http://localhost:5444/joplin',
		joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => state.folders.map(f => ({ ...f })),
			folderByUserIdAndJopId: async (u, id) => { const f = state.folders.find(x => x.id === id); return f ? { ...f } : null; },
			notesByUserId: async (u, o = {}) => state.notes.filter(n => !o.folderId || n.parentId === o.folderId).map(n => ({ ...n })),
			noteHeadersByUserId: async () => [],
			folderNoteCountsByUserId: async () => new Map([['__all__', 0], ['__trash__', 0]]),
			noteByUserIdAndJopId: async () => null,
			searchNotes: async () => [],
		},
		itemWriteService: {
			createFolder: async (s, f) => { const id = `new${++seq}`; state.writes.push(['createFolder', f]); state.folders.push({ id, deletedTime: 0, ...f }); return { id }; },
			updateFolder: async (s, existing, u) => { state.writes.push(['updateFolder', existing.id, u]); Object.assign(state.folders.find(f => f.id === existing.id), u); return { id: existing.id }; },
			deleteFolder: async (s, id) => { state.writes.push(['deleteFolder', id]); state.folders = state.folders.filter(f => f.id !== id); },
			updateNote: async (s, existing, u) => { state.writes.push(['updateNote', existing.id, u]); Object.assign(state.notes.find(n => n.id === existing.id), u); return { id: existing.id }; },
		},
		sessionService: {
			userBySessionId: async sid => sid === 'test-session' ? { id: 'user-1', email: 'u@example.com', sessionId: sid } : null,
			touchSession: async () => {}, getLastSeen: async () => null, deleteSession: async () => {},
		},
		settingsService: {
			settingsByUserId: async () => ({}), saveSettings: async (u, s) => s, appSettings: async () => ({ authRateLimitAttempts: 20 }),
			getTotpSeed: async () => null,
		},
		historyService: { saveSnapshot: async () => {}, listSnapshots: async () => [], getSnapshot: async () => null },
		vaultService: { getVaultFolderIdSet: async () => new Set(vaults) },
		database: { query: async () => ({ rows: [] }) },
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	try { await fn(server.address().port, state); } finally { await new Promise(r => server.close(r)); }
};

const tree = () => [
	{ id: 'work', title: 'Work' },
	{ id: 'proj', title: 'Projects', parentId: 'work' },
	{ id: 'alpha', title: 'Alpha', parentId: 'proj' },
	{ id: 'home', title: 'Home' },
];

test('PUT /fragments/folders/:id with parentId moves the notebook and returns a nested nav', async () => {
	await withServer({ folders: tree() }, async (port, state) => {
		const res = await request(port, { path: '/fragments/folders/alpha', method: 'PUT', headers: form, body: 'parentId=home' });
		assert.equal(res.statusCode, 200);
		assert.deepEqual(state.writes, [['updateFolder', 'alpha', { parentId: 'home' }]]);
		assert.match(res.body, /data-folder-id="alpha"[^>]*data-parent-id="home"[^>]*data-depth="1"/);
	});
});

test('PUT /fragments/folders/:id with an empty parentId moves to the top level', async () => {
	await withServer({ folders: tree() }, async (port, state) => {
		const res = await request(port, { path: '/fragments/folders/proj', method: 'PUT', headers: form, body: 'parentId=' });
		assert.equal(res.statusCode, 200);
		assert.deepEqual(state.writes, [['updateFolder', 'proj', { parentId: '' }]]);
	});
});

test('PUT /fragments/folders/:id can rename and move in one write', async () => {
	await withServer({ folders: tree() }, async (port, state) => {
		await request(port, { path: '/fragments/folders/alpha', method: 'PUT', headers: form, body: 'title=Beta&parentId=home' });
		assert.deepEqual(state.writes, [['updateFolder', 'alpha', { parentId: 'home', title: 'Beta' }]]);
	});
});

test('PUT /fragments/folders/:id without title or parentId is rejected, rename keeps working', async () => {
	await withServer({ folders: tree() }, async (port, state) => {
		assert.equal((await request(port, { path: '/fragments/folders/alpha', method: 'PUT', headers: form, body: '' })).statusCode, 400);
		assert.equal((await request(port, { path: '/fragments/folders/alpha', method: 'PUT', headers: form, body: 'title=' })).statusCode, 400);
		assert.equal((await request(port, { path: '/fragments/folders/alpha', method: 'PUT', headers: form, body: 'title=Renamed' })).statusCode, 200);
		assert.deepEqual(state.writes, [['updateFolder', 'alpha', { title: 'Renamed' }]]);
	});
});

test('moving a notebook into its own descendant is a 400 and writes nothing', async () => {
	await withServer({ folders: tree() }, async (port, state) => {
		const res = await request(port, { path: '/fragments/folders/work', method: 'PUT', headers: form, body: 'parentId=alpha' });
		assert.equal(res.statusCode, 400);
		assert.match(res.body, /sub-notebooks/);
		assert.deepEqual(state.writes, []);
	});
});

test('POST /fragments/folders with parentId creates a sub-notebook; a vault parent is refused', async () => {
	await withServer({ folders: tree(), vaults: ['home'] }, async (port, state) => {
		const ok = await request(port, { path: '/fragments/folders', method: 'POST', headers: form, body: 'title=Sub&parentId=work' });
		assert.equal(ok.statusCode, 200);
		assert.equal(state.writes[0][1].parentId, 'work');
		const bad = await request(port, { path: '/fragments/folders', method: 'POST', headers: form, body: 'title=Sub&parentId=home' });
		assert.equal(bad.statusCode, 400);
		assert.match(bad.body, /Vault/);
	});
});

test('DELETE /fragments/folders/:id promotes children and notes to the parent', async () => {
	await withServer({ folders: tree(), notes: [{ id: 'n1', title: 'N', parentId: 'proj' }] }, async (port, state) => {
		const res = await request(port, { path: '/fragments/folders/proj', method: 'DELETE' });
		assert.equal(res.statusCode, 200);
		assert.deepEqual(state.writes, [
			['updateFolder', 'alpha', { parentId: 'work' }],
			['updateNote', 'n1', { parentId: 'work' }],
			['deleteFolder', 'proj'],
		]);
		assert.match(res.body, /data-folder-id="alpha"[^>]*data-parent-id="work"/);
	});
});

test('API: POST with parentId, PUT move/rename, DELETE promote', async () => {
	await withServer({ folders: tree(), notes: [{ id: 'n1', title: 'N', parentId: 'alpha' }] }, async (port, state) => {
		const created = await request(port, { path: '/api/web/folders', method: 'POST', headers: json, body: JSON.stringify({ title: 'Kid', parentId: 'home' }) });
		assert.equal(created.statusCode, 201);
		assert.equal(JSON.parse(created.body).item.parentId, 'home');

		const moved = await request(port, { path: '/api/web/folders/alpha', method: 'PUT', headers: json, body: JSON.stringify({ parentId: 'home' }) });
		assert.equal(moved.statusCode, 200);
		assert.equal(JSON.parse(moved.body).item.parentId, 'home');

		const bad = await request(port, { path: '/api/web/folders/work', method: 'PUT', headers: json, body: JSON.stringify({ parentId: 'work' }) });
		assert.equal(bad.statusCode, 400);

		const none = await request(port, { path: '/api/web/folders/work', method: 'PUT', headers: json, body: JSON.stringify({}) });
		assert.equal(none.statusCode, 400);

		const del = await request(port, { path: '/api/web/folders/alpha', method: 'DELETE' });
		assert.equal(del.statusCode, 204);
		assert.equal(state.notes[0].parentId, 'home', 'notes of the deleted notebook go to its parent');
	});
});

test('GET /fragments/folder-options lists notebooks in tree order and disables the moved subtree', async () => {
	await withServer({ folders: tree(), vaults: ['home'] }, async (port) => {
		const res = await request(port, { path: '/fragments/folder-options?exclude=proj&selected=work' });
		assert.equal(res.statusCode, 200);
		const values = [...res.body.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(m => [m[1], /disabled/.test(m[2]), /selected/.test(m[2])]);
		assert.deepEqual(values, [
			['', false, false],
			['work', false, true],
			['proj', true, false],
			['alpha', true, false],
			['home', true, false],
		]);
		assert.match(res.body, /Top level/);
	});
});

test('folder-options requires a session', async () => {
	await withServer({ folders: tree() }, async port => {
		const res = await request(port, { path: '/fragments/folder-options', headers: { Cookie: 'sessionId=bad' } });
		assert.equal(res.statusCode, 401);
	});
});

test('POST /api/web/vaults refuses a nested notebook and one that has sub-notebooks', async () => {
	const created = [];
	const publicDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'joplock-public-'));
	require('fs').writeFileSync(require('path').join(publicDir, 'htmx.min.js'), '// stub');
	const server = createServer({
		publicDir, joplinPublicBasePath: '/joplin', joplinPublicBaseUrl: 'http://localhost:5444',
		joplinServerPublicUrl: 'http://localhost:5444/joplin', joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => tree().map(f => ({ parentId: '', deletedTime: 0, ...f })),
			folderByUserIdAndJopId: async (u, id) => tree().find(f => f.id === id) || null,
			noteHeadersByUserId: async () => [], folderNoteCountsByUserId: async () => new Map(), notesByUserId: async () => [],
		},
		itemWriteService: {},
		sessionService: { userBySessionId: async sid => sid === 'test-session' ? { id: 'user-1', email: 'u@example.com', sessionId: sid } : null, touchSession: async () => {}, getLastSeen: async () => null, deleteSession: async () => {} },
		settingsService: { settingsByUserId: async () => ({}), saveSettings: async (u, s) => s, appSettings: async () => ({ authRateLimitAttempts: 20 }), getTotpSeed: async () => null },
		historyService: {},
		vaultService: { createVault: async (...a) => { created.push(a); return true; }, getVaultFolderIdSet: async () => new Set() },
		database: { query: async () => ({ rows: [] }) },
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	try {
		const port = server.address().port;
		const post = folderId => request(port, { path: '/api/web/vaults', method: 'POST', headers: json, body: JSON.stringify({ folderId, salt: 's', verify: 'v' }) });
		assert.equal((await post('alpha')).statusCode, 400, 'nested notebook');
		assert.equal((await post('work')).statusCode, 400, 'has sub-notebooks');
		assert.equal((await post('home')).statusCode, 201, 'plain top-level notebook is fine');
		assert.deepEqual(created.map(c => c[1]), ['home']);
	} finally {
		await new Promise(r => server.close(r));
	}
});

// Regression: POST /fragments/notes/:id/restore answered 404 for every real trashed
// note, because the ownership check only looked at non-deleted notes. The fake item
// service here honours the `deleted` option like the real one (earlier mocks ignored
// it, which is how this went unnoticed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServer } = require('../app/createServer');

const post = (port, p) => new Promise((resolve, reject) => {
	const req = http.request({ hostname: '127.0.0.1', port, path: p, method: 'POST', headers: { Cookie: 'sessionId=test-session' } }, res => {
		const chunks = [];
		res.on('data', c => chunks.push(c));
		res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
	});
	req.on('error', reject);
	req.end();
});

test('restoring a trashed note works (and a live note is not "restorable")', async () => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'htmx.min.js'), '// stub');
	const notes = { trashed: { id: 'trashed', title: 'T', body: 'b', parentId: 'f1', deletedTime: 5, ownerId: 'user-1' }, live: { id: 'live', title: 'L', body: 'b', parentId: 'f1', deletedTime: 0, ownerId: 'user-1' } };
	const restored = [];
	const server = createServer({
		publicDir, joplinPublicBasePath: '/joplin', joplinPublicBaseUrl: 'http://localhost:5444',
		joplinServerPublicUrl: 'http://localhost:5444/joplin', joplinServerOrigin: 'http://server:22300',
		itemService: {
			foldersByUserId: async () => [{ id: 'f1', title: 'F', parentId: '' }],
			folderNoteCountsByUserId: async () => new Map(),
			notesByUserId: async () => [],
			noteHeadersByUserId: async () => [],
			noteByUserIdAndJopId: async (u, id, opts = {}) => {
				const n = notes[id];
				if (!n) return null;
				const mode = opts.deleted || 'exclude';
				const isTrashed = n.deletedTime > 0;
				if (mode === 'only' && !isTrashed) return null;
				if (mode === 'exclude' && isTrashed) return null;
				return { ...n };
			},
		},
		itemWriteService: { restoreNote: async (s, existing, parent) => { restored.push([existing.id, parent]); } },
		sessionService: { userBySessionId: async sid => sid === 'test-session' ? { id: 'user-1', email: 'u@example.com', sessionId: sid } : null, touchSession: async () => {}, getLastSeen: async () => null, deleteSession: async () => {} },
		settingsService: { settingsByUserId: async () => ({}), saveSettings: async (u, s) => s, appSettings: async () => ({ authRateLimitAttempts: 20 }), getTotpSeed: async () => null },
		historyService: {},
		database: { query: async () => ({ rows: [] }) },
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	try {
		const port = server.address().port;
		const ok = await post(port, '/fragments/notes/trashed/restore');
		assert.equal(ok.statusCode, 200, ok.body.slice(0, 200));
		assert.deepEqual(restored, [['trashed', 'f1']]);
		assert.equal((await post(port, '/fragments/notes/live/restore')).statusCode, 404);
	} finally {
		await new Promise(r => server.close(r));
	}
});

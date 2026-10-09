// Share changes on a notebook subtree must reach stock Joplin clients, which only
// react to change events (i.e. API writes), never to silent database updates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShareSync } = require('../app/routes/shares');

const world = ({ folders, notes, e2ee = [] }) => {
	const apiWrites = [];
	const sql = [];
	const byFolder = Object.fromEntries(folders.map(f => [f.id, { id: f.id, parentId: f.parentId || '', shareId: f.shareId || '', e2ee: e2ee.includes(f.id) }]));
	const byNote = Object.fromEntries(notes.map(n => [n.id, { id: n.id, parentId: n.parentId, shareId: n.shareId || '', e2ee: e2ee.includes(n.id) }]));
	const itemService = {
		foldersByUserId: async () => Object.values(byFolder),
		folderByUserIdAndJopId: async (u, id) => byFolder[id] || null,
		noteByUserIdAndJopId: async (u, id) => byNote[id] || null,
	};
	const itemWriteService = {
		updateFolder: async (sid, existing, fields) => { if (existing.e2ee) throw Object.assign(new Error('e2ee'), { statusCode: 403 }); apiWrites.push(['folder', existing.id, fields]); },
		updateNote: async (sid, existing, fields) => { if (existing.e2ee) throw Object.assign(new Error('e2ee'), { statusCode: 403 }); apiWrites.push(['note', existing.id, fields]); },
	};
	const database = {
		query: async (text, params) => {
			sql.push(text);
			if (/SELECT jop_id FROM items WHERE owner_id/.test(text)) return { rows: notes.filter(n => params[1].includes(n.parentId)).map(n => ({ jop_id: n.id })) };
			return { rows: [] };
		},
	};
	return { sync: createShareSync({ itemService, itemWriteService, database }), apiWrites, sql };
};

const TREE = [{ id: 'root' }, { id: 'sub', parentId: 'root' }, { id: 'leaf', parentId: 'sub' }, { id: 'other' }];
const NOTES = [{ id: 'n1', parentId: 'root' }, { id: 'n2', parentId: 'leaf' }, { id: 'n3', parentId: 'other' }];

test('moving a subtree INTO a share re-saves every notebook and note below it through the API', async () => {
	const w = world({ folders: TREE, notes: NOTES });
	await w.sync.setSubtreeShare({ ownerId: 'u', folderId: 'root', shareId: 'S1', previousShareId: '', sessionId: 'sess', requestContext: {} });
	assert.deepEqual(w.apiWrites.map(x => [x[0], x[1]]).sort(), [['folder', 'leaf'], ['folder', 'root'], ['folder', 'sub'], ['note', 'n1'], ['note', 'n2']]);
	for (const [, , fields] of w.apiWrites) assert.deepEqual(fields, { shareId: 'S1', isShared: true });
	assert.ok(!w.apiWrites.some(x => x[1] === 'other' || x[1] === 'n3'), 'unrelated items are not touched');
});

test('moving a subtree OUT of a share clears the share id through the API too (this is what makes Joplin clients drop it)', async () => {
	const folders = TREE.map(f => (f.id === 'other' ? f : { ...f, shareId: 'S1' }));
	const notes = NOTES.map(n => (n.id === 'n3' ? n : { ...n, shareId: 'S1' }));
	const w = world({ folders, notes });
	await w.sync.setSubtreeShare({ ownerId: 'u', folderId: 'root', shareId: '', previousShareId: 'S1', sessionId: 'sess', requestContext: {} });
	assert.equal(w.apiWrites.length, 5);
	for (const [, , fields] of w.apiWrites) assert.deepEqual(fields, { shareId: '', isShared: false });
	assert.ok(w.sql.some(t => /DELETE FROM user_items/.test(t)), "Joplock's own recipient rows are revoked as well");
});

test('items already in the target share are not rewritten', async () => {
	const w = world({ folders: [{ id: 'root', shareId: 'S1' }, { id: 'sub', parentId: 'root' }], notes: [{ id: 'n1', parentId: 'root', shareId: 'S1' }] });
	await w.sync.setSubtreeShare({ ownerId: 'u', folderId: 'root', shareId: 'S1', sessionId: 'sess', requestContext: {} });
	assert.deepEqual(w.apiWrites.map(x => x[1]), ['sub']);
});

test('end-to-end encrypted items cannot be re-saved: they are skipped by the API pass and swept by the database', async () => {
	const w = world({ folders: [{ id: 'root' }], notes: [{ id: 'n1', parentId: 'root' }, { id: 'enc', parentId: 'root' }], e2ee: ['enc'] });
	await w.sync.setSubtreeShare({ ownerId: 'u', folderId: 'root', shareId: 'S1', sessionId: 'sess', requestContext: {} });
	assert.ok(!w.apiWrites.some(x => x[1] === 'enc'));
	assert.ok(w.sql.some(t => /UPDATE items SET/.test(t)), 'database sweep still runs');
});

test('without a session the database sweep still runs (no API available)', async () => {
	const w = world({ folders: [{ id: 'root' }], notes: [{ id: 'n1', parentId: 'root' }] });
	await w.sync.setSubtreeShare({ ownerId: 'u', folderId: 'root', shareId: 'S1' });
	assert.equal(w.apiWrites.length, 0);
	assert.ok(w.sql.some(t => /UPDATE items SET/.test(t)));
});

test('an API failure is reported, but only after the database sweep and recipient rows are done', async () => {
	const w = world({ folders: [{ id: 'root' }], notes: [{ id: 'n1', parentId: 'root' }] });
	const failing = createShareSync({
		itemService: { foldersByUserId: async () => [{ id: 'root', parentId: '' }], folderByUserIdAndJopId: async () => ({ id: 'root', shareId: '' }), noteByUserIdAndJopId: async () => null },
		itemWriteService: { updateFolder: async () => { throw new Error('upstream down'); } },
		database: { query: async (t, p) => { w.sql.push(t); return { rows: [] }; } },
	});
	await assert.rejects(failing.setSubtreeShare({ ownerId: 'u', folderId: 'root', shareId: 'S1', sessionId: 's', requestContext: {} }), /upstream down/);
	assert.ok(w.sql.some(t => /UPDATE items SET/.test(t)), 'the sweep happened before the error surfaced');
});

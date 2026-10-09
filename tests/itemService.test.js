const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeItemContent, mapFolderRow, mapNoteHeaderRow, mapNoteRow, buildNoteSearchConditions } = require('../app/items/itemService');

test('decodeItemContent should parse buffer JSON', () => {
	const output = decodeItemContent(Buffer.from('{"title":"Folder A"}', 'utf8'));
	assert.equal(output.title, 'Folder A');
});

test('mapFolderRow should combine joplin ids and JSON content', () => {
	const folder = mapFolderRow({
		jop_id: 'folder1',
		jop_parent_id: '',
		jop_updated_time: 200,
		created_time: 100,
		content: Buffer.from('{"title":"Projects","icon":"📁"}', 'utf8'),
	});

	assert.deepEqual(folder, {
		id: 'folder1',
		parentId: '',
		title: 'Projects',
		e2ee: false,
		fields: { title: 'Projects', icon: '📁' },
		icon: '📁',
		deletedTime: 0,
		createdTime: 100,
		userCreatedTime: 0,
		masterKeyId: '',
		updatedTime: 200,
		ownerId: '',
		shareId: '',
		isShared: false,
	});
});

test('mapNoteRow should build preview and note metadata', () => {
	const note = mapNoteRow({
		jop_id: 'note1',
		jop_parent_id: 'folder1',
		jop_updated_time: 400,
		created_time: 150,
		content: Buffer.from('{"title":"Note","body":"Hello world","is_todo":0}', 'utf8'),
	});

	assert.equal(note.id, 'note1');
	assert.equal(note.parentId, 'folder1');
	assert.equal(note.title, 'Note');
	assert.equal(note.body, 'Hello world');
	assert.equal(note.bodyPreview, 'Hello world');
	assert.equal(note.updatedTime, 400);
	assert.equal(note.createdTime, 150);
	assert.equal(note.isTodo, false);
	assert.equal(note.todoCompleted, 0);
	assert.equal(note.ownerId, '');
	assert.equal(note.shareId, '');
	assert.equal(note.isShared, false);
});

test('mapNoteHeaderRow should use projected note fields', () => {
	const note = mapNoteHeaderRow({
		jop_id: 'note1',
		jop_parent_id: 'folder1',
		jop_updated_time: 400,
		title: 'Projected Note',
		deleted_time: 0,
	});

	assert.deepEqual(note, {
		id: 'note1',
		parentId: 'folder1',
		title: 'Projected Note',
		e2ee: false,
		isEncrypted: false,
		deletedTime: 0,
		updatedTime: 400,
		ownerId: '',
		shareId: '',
		isShared: false,
	});
});

test('buildNoteSearchConditions should build single-term ILIKE clause', () => {
	const { terms, params, sql } = buildNoteSearchConditions('hello', 3);
	assert.deepEqual(terms, ['hello']);
	assert.deepEqual(params, ['%hello%']);
	assert.ok(sql.includes('ILIKE $3'));
	// Single term keeps title OR body matching
	assert.match(sql, /parsed->>'title' ILIKE \$3 OR/);
	assert.ok(sql.includes("NOT LIKE '%<!--joplock-encrypted-start-->%'"));
});

test('buildNoteSearchConditions should AND terms regardless of order', () => {
	const { terms, params, sql } = buildNoteSearchConditions('  alpha   beta\tgamma ', 3);
	assert.deepEqual(terms, ['alpha', 'beta', 'gamma']);
	assert.deepEqual(params, ['%alpha%', '%beta%', '%gamma%']);
	// One clause per term, joined with AND
	assert.equal(sql.split(' AND ').length, 3);
	assert.ok(sql.includes('ILIKE $3'), 'first term uses $3');
	assert.ok(sql.includes('ILIKE $4'), 'second term uses $4');
	assert.ok(sql.includes('ILIKE $5'), 'third term uses $5');
});

test('buildNoteSearchConditions should return empty sql for blank queries', () => {
	for (const q of ['', '   ', '\n\t', undefined, null]) {
		const { terms, params, sql } = buildNoteSearchConditions(q, 3);
		assert.deepEqual(terms, []);
		assert.deepEqual(params, []);
		assert.equal(sql, '');
	}
});

// ── Joplin fields on the model ──
const { mapNoteRow: mapNote, mapFolderRow: mapFolder, mapNoteHeaderRow: mapHeader } = require('../app/items/itemService');
const row = (content, extra = {}) => ({ jop_id: 'n1', jop_parent_id: 'f1', jop_updated_time: 5, created_time: 1, owner_id: 'u', content: Buffer.from(JSON.stringify(content)), ...extra });

test('mapNoteRow carries every stored field so a rewrite can pass them through', () => {
	const stored = { title: 'T', body: 'B', is_todo: 1, todo_due: 99, author: 'A', is_locked: 1, order: 7, markup_language: 2 };
	const note = mapNote(row(stored));
	assert.deepEqual(note.fields, stored);
	assert.equal(note.markupLanguage, 2);
	assert.equal(note.isTodo, true);
	assert.equal(note.isConflict, false);
	assert.equal(note.e2ee, false);
});

test('mapNoteRow defaults to markdown and flags conflicts', () => {
	assert.equal(mapNote(row({ title: 'T' })).markupLanguage, 1);
	assert.equal(mapNote(row({ title: 'T', is_conflict: 1 })).isConflict, true);
});

test('Joplin end-to-end encrypted items become locked placeholders with no content', () => {
	const viaColumn = mapNote(row({ title: '', body: 'ciphertext-ish', encryption_cipher_text: 'JED01...' }, { jop_encryption_applied: 1 }));
	assert.equal(viaColumn.e2ee, true);
	assert.equal(viaColumn.body, '');
	assert.match(viaColumn.title, /Encrypted note/);
	const viaJson = mapNote(row({ encryption_applied: 1, encryption_cipher_text: 'JED01...' }));
	assert.equal(viaJson.e2ee, true);
	const folder = mapFolder(row({ title: '' }, { jop_encryption_applied: 1 }));
	assert.equal(folder.e2ee, true);
	assert.match(folder.title, /Encrypted notebook/);
	const header = mapHeader({ jop_id: 'n', jop_parent_id: 'f', title: '', jop_encryption_applied: 1 });
	assert.equal(header.e2ee, true);
	assert.match(header.title, /Encrypted note/);
});

test('note queries exclude conflict copies (lists, headers, counts, search) but not when asked to', async () => {
	const { createItemService } = require('../app/items/itemService');
	const sqls = [];
	const db = { query: async sql => { sqls.push(sql); return { rows: [] }; } };
	const svc = createItemService(db);
	await svc.notesByUserId('u');
	await svc.noteHeadersByUserId('u');
	await svc.noteHeadersByFolder('u', 'f1');
	await svc.noteHeadersByFolder('u', '__trash__');
	await svc.folderNoteCountsByUserId('u');
	await svc.searchNotes('u', 'hello');
	assert.ok(sqls.length >= 7);
	for (const sql of sqls) assert.match(sql, /is_conflict/, `conflict filter missing in: ${sql.slice(0, 80)}`);
	sqls.length = 0;
	await svc.notesByUserId('u', { includeConflicts: true });
	assert.doesNotMatch(sqls[0], /is_conflict/);
});

test('item reads select the encryption column so E2EE items can be recognised', async () => {
	const { createItemService } = require('../app/items/itemService');
	const sqls = [];
	const svc = createItemService({ query: async sql => { sqls.push(sql); return { rows: [] }; } });
	await svc.foldersByUserId('u');
	await svc.folderByUserIdAndJopId('u', 'f');
	await svc.notesByUserId('u');
	await svc.noteByUserIdAndJopId('u', 'n');
	await svc.noteHeadersByFolder('u', 'f1');
	for (const sql of sqls) assert.match(sql, /jop_encryption_applied/);
});

// ── share id: the column is authoritative ──
test('share id comes from the jop_share_id column; the JSON copy is only a fallback (it vanishes after the first API save)', () => {
	const afterApiSave = mapNote(row({ title: 'T', body: 'b' /* no share_id: the server stripped it */ }, { jop_share_id: 'SHARE1' }));
	assert.equal(afterApiSave.shareId, 'SHARE1');
	assert.equal(afterApiSave.isShared, true);
	const dbStamped = mapNote(row({ title: 'T', share_id: 'SHARE2', is_shared: 1 }, { jop_share_id: '' }));
	assert.equal(dbStamped.shareId, 'SHARE2', 'JSON fallback for items stamped directly in the database');
	const both = mapNote(row({ title: 'T', share_id: 'STALE' }, { jop_share_id: 'CURRENT' }));
	assert.equal(both.shareId, 'CURRENT', 'the column wins over a stale JSON value');
	const none = mapNote(row({ title: 'T' }));
	assert.equal(none.shareId, '');
	assert.equal(none.isShared, false);
	assert.equal(mapFolder(row({ title: 'F' }, { jop_share_id: 'S' })).shareId, 'S');
	assert.equal(mapHeader({ jop_id: 'n', jop_parent_id: 'f', title: 't', jop_share_id: 'S' }).shareId, 'S');
});

test('an edit round-trip keeps a shared note shared (the regression: 2nd Joplock edit used to write share_id empty)', () => {
	const { serializeNote } = require('../app/items/itemWriteService');
	const shared = mapNote(row({ title: 'T', body: 'b' }, { jop_share_id: 'SHARE1' }));
	const text = serializeNote({ id: shared.id, title: shared.title, body: 'edited', parentId: shared.parentId, createdTime: 1, isShared: shared.isShared, shareId: shared.shareId, fields: shared.fields }).body;
	assert.match(text, /^share_id: SHARE1$/m);
	assert.match(text, /^is_shared: 1$/m);
});

test('item reads select the share column', async () => {
	const { createItemService } = require('../app/items/itemService');
	const sqls = [];
	const svc = createItemService({ query: async sql => { sqls.push(sql); return { rows: [] }; } });
	await svc.foldersByUserId('u');
	await svc.folderByUserIdAndJopId('u', 'f');
	await svc.notesByUserId('u');
	await svc.noteByUserIdAndJopId('u', 'n');
	await svc.noteHeadersByUserId('u');
	await svc.noteHeadersByFolder('u', 'f1');
	await svc.searchNotes('u', 'x');
	for (const sql of sqls) assert.match(sql, /jop_share_id/, sql.slice(0, 90));
});

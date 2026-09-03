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
		icon: '📁',
		deletedTime: 0,
		createdTime: 100,
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

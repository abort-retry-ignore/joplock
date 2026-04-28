const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeItemContent, mapFolderRow, mapNoteHeaderRow, mapNoteRow } = require('../app/items/itemService');

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
	});
});

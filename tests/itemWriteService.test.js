const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeFolder, serializeNote, serializeResource } = require('../app/items/itemWriteService');

test('serializeFolder should include title and parent id', () => {
	const folder = serializeFolder({
		id: 'folder123',
		title: 'Projects',
		parentId: 'parent456',
	});

	assert.equal(folder.id, 'folder123');
	assert.equal(folder.path, 'root:/folder123.md:');
	assert.match(folder.body, /Projects/);
	assert.match(folder.body, /parent_id: parent456/);
	assert.match(folder.body, /type_: 2/);
});

test('serializeNote should include title body and parent id', () => {
	const note = serializeNote({
		id: 'note123',
		title: 'Meeting',
		body: 'Agenda items',
		parentId: 'folder123',
	});

	assert.equal(note.id, 'note123');
	assert.equal(note.path, 'root:/note123.md:');
	assert.match(note.body, /Meeting/);
	assert.match(note.body, /Agenda items/);
	assert.match(note.body, /parent_id: folder123/);
	assert.match(note.body, /type_: 1/);
});

test('serializeResource should include mime size and type 4', () => {
	const resource = serializeResource({
		id: 'res12345678901234567890123456789a',
		title: 'photo.png',
		mime: 'image/png',
		filename: 'photo.png',
		fileExtension: 'png',
		size: 12345,
	});

	assert.equal(resource.id, 'res12345678901234567890123456789a');
	assert.equal(resource.metaPath, 'root:/res12345678901234567890123456789a.md:');
	assert.equal(resource.blobPath, 'root:/.resource/res12345678901234567890123456789a:');
	assert.match(resource.body, /photo\.png/);
	assert.match(resource.body, /mime: image\/png/);
	assert.match(resource.body, /size: 12345/);
	assert.match(resource.body, /file_extension: png/);
	assert.match(resource.body, /type_: 4/);
});

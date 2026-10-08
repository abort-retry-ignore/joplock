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

test('serializeFolder preserves created time, icon and master key across rewrites', () => {
	const created = Date.UTC(2020, 0, 2, 3, 4, 5);
	const folder = serializeFolder({
		id: 'folder123',
		title: 'Projects',
		parentId: '',
		createdTime: created,
		userCreatedTime: created + 1000,
		icon: '{"type":1,"emoji":"x"}',
		masterKeyId: 'mk1',
	});
	assert.match(folder.body, /created_time: 2020-01-02T03:04:05\.000Z/);
	assert.match(folder.body, /user_created_time: 2020-01-02T03:04:06\.000Z/);
	assert.match(folder.body, /icon: \{"type":1,"emoji":"x"\}/);
	assert.match(folder.body, /master_key_id: mk1/);
	assert.match(folder.body, /deleted_time: 0/);
});

test('updateFolder keeps the existing folder metadata when only the parent changes', async () => {
	const { createItemWriteService } = require('../app/items/itemWriteService');
	const http = require('node:http');
	let putBody = '';
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', c => chunks.push(c));
		req.on('end', () => {
			putBody = Buffer.concat(chunks).toString('utf8');
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end('{}');
		});
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const svc = createItemWriteService({ joplinServerOrigin: `http://127.0.0.1:${server.address().port}`, joplinServerPublicUrl: 'http://localhost:22300' });
		const created = Date.UTC(2021, 5, 6, 7, 8, 9);
		await svc.updateFolder('sess', {
			id: 'f1', title: 'Old', parentId: '', createdTime: created, userCreatedTime: created, icon: 'ICON', masterKeyId: '', shareId: '', isShared: false,
		}, { parentId: 'p1' }, {});
		assert.match(putBody, /parent_id: p1/);
		assert.match(putBody, /created_time: 2021-06-06T07:08:09\.000Z/);
		assert.match(putBody, /icon: ICON/);
		assert.match(putBody, /\r\n\r\nOld\n/);
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
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

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { serializeItem, formatValue, formatTime, escapeProp, MODEL_TYPE_NOTE, MODEL_TYPE_FOLDER } = require('../app/items/joplinItem');
const { serializeNote, serializeFolder, serializeResource, createItemWriteService } = require('../app/items/itemWriteService');

// Port of Joplin's BaseItem.unserialize (+ the time part of unserialize_format):
// what a Joplin client does with the text we upload.
const unserialize = content => {
	const lines = content.split('\n');
	const out = {};
	let body = [];
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (line === '') { body = lines.slice(0, i); break; }
		const p = line.indexOf(':');
		if (p < 0) throw new Error(`Invalid property format: ${line}`);
		out[line.substr(0, p).trim()] = line.substr(p + 1).trim();
	}
	if (!out.type_) throw new Error('Missing type_');
	if (body.length) out.title = body.splice(0, 2)[0];
	if (Number(out.type_) === 1) out.body = body.join('\n');
	return out;
};

// A to-do as the real Joplin 3.7.1 CLI synced it to the server (item JSON in the DB).
const STORED_TODO = {
	body: 'raw body',
	order: 1791498419756,
	title: 'T2 rawcheck',
	author: 'Raw Author',
	source: 'joplin',
	is_todo: 1,
	altitude: '0.0000',
	latitude: '51.50000000',
	todo_due: 1893456000000,
	is_locked: 0,
	is_shared: 0,
	longitude: '-0.12000000',
	user_data: '{"plugin":"x"}',
	source_url: 'https://example.com/src',
	is_conflict: 0,
	created_time: 1791498419757,
	deleted_time: 0,
	master_key_id: '',
	todo_completed: 1791498500000,
	markup_language: 1,
	application_data: '',
	user_created_time: 1791498419000,
	user_updated_time: 1791498419757,
	source_application: 'net.cozic.joplin-cli',
	conflict_original_id: '',
	encryption_cipher_text: '',
	extracted_resource_ids: 'abc',
};

const existingFromStored = (stored, extra = {}) => ({
	id: 'a'.repeat(32), parentId: 'f'.repeat(32), title: stored.title, body: stored.body, createdTime: stored.created_time,
	deletedTime: 0, isShared: false, shareId: '', fields: stored, markupLanguage: stored.markup_language || 1, ...extra,
});

test('serializeNote passes every stored field through untouched (what Joplock used to destroy)', () => {
	const existing = existingFromStored(STORED_TODO);
	const parsed = unserialize(serializeNote({
		id: existing.id, title: 'T2 rawcheck', body: 'edited', parentId: existing.parentId, createdTime: existing.createdTime, fields: existing.fields,
	}).body);
	assert.equal(parsed.body, 'edited');
	assert.equal(parsed.title, 'T2 rawcheck');
	for (const key of ['is_todo', 'author', 'source', 'latitude', 'longitude', 'altitude', 'source_url', 'order', 'markup_language',
		'source_application', 'application_data', 'user_data', 'todo_due', 'todo_completed', 'is_locked', 'extracted_resource_ids', 'is_conflict']) {
		assert.equal(parsed[key], `${STORED_TODO[key]}`, key);
	}
	assert.equal(Date.parse(parsed.user_created_time), STORED_TODO.user_created_time, 'user_created_time is not forced to created_time');
	assert.equal(Date.parse(parsed.created_time), STORED_TODO.created_time);
	assert.equal(parsed.type_, '1');
});

test('Joplock-owned fields win: parent, deleted time, share, updated_time', () => {
	const existing = existingFromStored(STORED_TODO);
	const before = Date.now();
	const parsed = unserialize(serializeNote({
		id: existing.id, title: 't', body: 'b', parentId: 'p'.repeat(32), createdTime: existing.createdTime,
		deletedTime: 12345, isShared: true, shareId: 'S1', userUpdatedTime: STORED_TODO.user_updated_time, fields: existing.fields,
	}).body);
	assert.equal(parsed.parent_id, 'p'.repeat(32));
	assert.equal(parsed.deleted_time, '12345');
	assert.equal(parsed.is_shared, '1');
	assert.equal(parsed.share_id, 'S1');
	assert.ok(Date.parse(parsed.updated_time) >= before, 'updated_time is always bumped so sync sees the change');
	assert.equal(Date.parse(parsed.user_updated_time), STORED_TODO.user_updated_time, 'user_updated_time as given');
});

test('brand-new notes get the values Joplin itself would write', () => {
	const before = Date.now();
	const parsed = unserialize(serializeNote({ title: 'New', body: 'hello', parentId: 'f'.repeat(32) }).body);
	assert.equal(parsed.is_todo, '0');
	assert.equal(parsed.markup_language, '1');
	assert.equal(parsed.latitude, '0.00000000');
	assert.equal(parsed.altitude, '0.0000');
	assert.equal(parsed.source_application, 'net.cozic.joplock-web');
	assert.ok(Number(parsed.order) >= before, 'order is the creation time like Joplin, not 0');
	assert.equal(parsed.created_time, parsed.user_created_time);
});

test('layout matches Joplin: no empty body block, title first, type_ last, extras before type_', () => {
	const text = serializeNote({ id: 'x'.repeat(32), title: 'Only title', body: '', fields: { custom_future_key: 'v' } }).body;
	assert.match(text, /^Only title\n\nid: /);
	assert.ok(!/\n\n\n/.test(text), 'no stray blank lines');
	const lines = text.split('\n');
	assert.equal(lines[lines.length - 1], 'type_: 1');
	assert.equal(lines[lines.length - 2], 'custom_future_key: v');
	assert.equal(unserialize(text).body, '');
});

test('bodies containing blank lines and key-like lines round-trip', () => {
	const body = 'first\n\nsecond: not a prop\n\n\nlast line';
	const parsed = unserialize(serializeNote({ title: 'T', body }).body);
	assert.equal(parsed.body, body);
	assert.equal(parsed.title, 'T');
});

test('formatTime / formatValue follow serialize_format', () => {
	assert.equal(formatTime(0), '');
	assert.equal(formatTime(1791498419757), '2026-10-08T22:26:59.757Z');
	assert.equal(formatTime('1791498419757'), '2026-10-08T22:26:59.757Z');
	assert.equal(formatTime('2026-10-08T22:26:59.757Z'), '2026-10-08T22:26:59.757Z');
	assert.equal(formatValue('author', null), '');
	assert.equal(formatValue('is_todo', 1), '1');
	assert.equal(formatValue('user_data', { a: 1 }), '{"a":1}');
	assert.equal(escapeProp('a\nb\rc'), 'a\\nb\\rc');
	assert.equal(escapeProp('literal \\n stays distinguishable'), 'literal \\\\n stays distinguishable');
});

test('serializeFolder passes icon, user_data and unknown fields through, and keeps created time', () => {
	const stored = { title: 'Nb', icon: '{"emoji":"x"}', user_data: '{"p":1}', created_time: 1700000000000, user_created_time: 1700000000001, deleted_time: 0, master_key_id: 'mk', future_thing: 'keep' };
	const parsed = unserialize(serializeFolder({
		id: 'f'.repeat(32), title: 'Nb2', parentId: 'p'.repeat(32), fields: stored, createdTime: stored.created_time,
	}).body);
	assert.equal(parsed.title, 'Nb2');
	assert.equal(parsed.icon, '{"emoji":"x"}');
	assert.equal(parsed.user_data, '{"p":1}');
	assert.equal(parsed.master_key_id, 'mk');
	assert.equal(parsed.future_thing, 'keep');
	assert.equal(parsed.parent_id, 'p'.repeat(32));
	assert.equal(Date.parse(parsed.user_created_time), 1700000000001);
	assert.equal(parsed.type_, '2');
});

test('serializeResource writes the Joplin 3.x OCR fields', () => {
	const parsed = unserialize(serializeResource({ id: 'r'.repeat(32), title: 'a.png', mime: 'image/png', filename: 'a.png', fileExtension: 'png', size: 10 }).body);
	for (const key of ['ocr_text', 'ocr_details', 'ocr_status', 'ocr_error', 'ocr_driver_id']) assert.ok(key in parsed, key);
	assert.equal(parsed.ocr_status, '0');
	assert.equal(parsed.mime, 'image/png');
	assert.equal(parsed.type_, '4');
});

test('serializeItem never lets a stored title/body/type_ leak in as a prop', () => {
	const text = serializeItem({ type: MODEL_TYPE_NOTE, title: 'T', body: 'B', fields: { title: 'OLD', body: 'OLD', type_: 99, id: 'i' } });
	const parsed = unserialize(text);
	assert.equal(parsed.title, 'T');
	assert.equal(parsed.body, 'B');
	assert.equal(parsed.type_, '1');
	void MODEL_TYPE_FOLDER;
});

// ── updateNote / updateFolder policy (against a fake upstream) ──
const withUpstream = async fn => {
	const puts = [];
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', c => chunks.push(c));
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			const m = /\r\n\r\n([\s\S]*)\r\n--/.exec(raw);
			puts.push(m ? m[1] : raw);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end('{}');
		});
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	try {
		const svc = createItemWriteService({ joplinServerOrigin: `http://127.0.0.1:${server.address().port}`, joplinServerPublicUrl: 'http://localhost:22300' });
		await fn(svc, puts);
	} finally {
		await new Promise(r => server.close(r));
	}
};
const stamp = text => unserialize(text);

test('updateNote: an edit moves user_updated_time; move/trash/restore leave it alone; everything else is preserved', async () => {
	await withUpstream(async (svc, puts) => {
		const existing = existingFromStored(STORED_TODO);
		await svc.updateNote('s', existing, { body: 'changed' }, {});
		await svc.updateNote('s', existing, { parentId: 'z'.repeat(32) }, {});
		await svc.trashNote('s', existing, {});
		await svc.restoreNote('s', { ...existing, deletedTime: 5 }, existing.parentId, {});
		const [edit, move, trash, restore] = puts.map(stamp);
		assert.ok(Date.parse(edit.user_updated_time) > STORED_TODO.user_updated_time, 'edit bumps it');
		for (const p of [move, trash, restore]) assert.equal(Date.parse(p.user_updated_time), STORED_TODO.user_updated_time, 'non-content writes keep it');
		assert.equal(move.parent_id, 'z'.repeat(32));
		assert.ok(Number(trash.deleted_time) > 0);
		assert.equal(restore.deleted_time, '0');
		for (const p of [edit, move, trash, restore]) {
			assert.equal(p.is_todo, '1');
			assert.equal(p.markup_language, '1');
			assert.equal(p.source_application, 'net.cozic.joplin-cli');
			assert.equal(p.is_locked, '0');
		}
	});
});

test('updateNote refuses Joplin-encrypted notes', async () => {
	await withUpstream(async (svc, puts) => {
		const existing = existingFromStored({ ...STORED_TODO, encryption_cipher_text: 'JED01' }, { e2ee: true });
		await assert.rejects(svc.updateNote('s', existing, { body: 'x' }, {}), e => e.statusCode === 403 && /end-to-end encrypted/.test(e.message));
		await assert.rejects(svc.trashNote('s', existing, {}), e => e.statusCode === 403);
		await assert.rejects(svc.updateFolder('s', { id: 'f', title: 'x', e2ee: true }, { title: 'y' }, {}), e => e.statusCode === 403);
		assert.equal(puts.length, 0);
	});
});

test('updateNote: HTML notes cannot change content but can still be moved or trashed', async () => {
	await withUpstream(async (svc, puts) => {
		const existing = existingFromStored({ ...STORED_TODO, is_todo: 0, markup_language: 2, body: '<p>hi</p>' });
		await assert.rejects(svc.updateNote('s', existing, { body: '<p>changed</p>' }, {}), e => e.statusCode === 403 && /read-only/.test(e.message));
		// same body (with CRLF noise from a form post) + different parent is a plain move
		await svc.updateNote('s', existing, { title: 'ignored', body: '<p>hi</p>', parentId: 'z'.repeat(32) }, {});
		await svc.trashNote('s', existing, {});
		assert.equal(puts.length, 2);
		const moved = stamp(puts[0]);
		assert.equal(moved.title, 'T2 rawcheck', 'title is not rewritten either');
		assert.equal(moved.body, '<p>hi</p>');
		assert.equal(moved.markup_language, '2');
		assert.equal(moved.parent_id, 'z'.repeat(32));
	});
});

test('updateFolder: rename bumps user_updated_time, a move does not; icon and user_data survive', async () => {
	await withUpstream(async (svc, puts) => {
		const stored = { title: 'Nb', icon: '{"emoji":"x"}', user_data: '{"p":1}', created_time: 1700000000000, user_created_time: 1700000000000, user_updated_time: 1700000005000, deleted_time: 0 };
		const existing = { id: 'f'.repeat(32), title: 'Nb', parentId: '', createdTime: 1700000000000, userCreatedTime: 1700000000000, fields: stored };
		await svc.updateFolder('s', existing, { title: 'Renamed' }, {});
		await svc.updateFolder('s', existing, { parentId: 'p'.repeat(32) }, {});
		const [rename, move] = puts.map(stamp);
		assert.ok(Date.parse(rename.user_updated_time) > 1700000005000);
		assert.equal(Date.parse(move.user_updated_time), 1700000005000);
		for (const p of [rename, move]) {
			assert.equal(p.icon, '{"emoji":"x"}');
			assert.equal(p.user_data, '{"p":1}');
			assert.equal(Date.parse(p.created_time), 1700000000000);
		}
	});
});

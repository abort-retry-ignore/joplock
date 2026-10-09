'use strict';

// Items Joplock must never mangle in a Joplin account: HTML notes, end-to-end
// encrypted items and conflict copies - plus attachments, which the client must
// be able to download like any other resource.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { skipReason, sleep, JoplinClient, connectAccount } = require('./joplin/harness');

const skip = skipReason();
const PREFIX = `jc-grd-${Date.now().toString(36)}`;
const id32 = () => crypto.randomBytes(16).toString('hex');
const TS = '2026-01-02T03:04:05.678Z';

// A plain note as a stock client would upload it.
const rawNote = (id, parent, title, body, extra = []) => [
	title, '', body, '',
	`id: ${id}`, `parent_id: ${parent}`, `created_time: ${TS}`, `updated_time: ${TS}`,
	'is_conflict: 0', 'latitude: 0.00000000', 'longitude: 0.00000000', 'altitude: 0.0000', 'author: ', 'source_url: ',
	'is_todo: 0', 'todo_due: 0', 'todo_completed: 0', 'source: joplin-desktop', 'source_application: net.cozic.joplin-desktop',
	'application_data: ', 'order: 1767323045678', `user_created_time: ${TS}`, `user_updated_time: ${TS}`,
	'encryption_cipher_text: ', 'encryption_applied: 0', 'markup_language: 1', 'is_shared: 0', 'share_id: ',
	'conflict_original_id: ', 'master_key_id: ', 'user_data: ', 'deleted_time: 0', ...extra, 'type_: 1',
].join('\n');

describe('HTML notes', { skip, concurrency: false }, () => {
	let jp; let client;
	before(async () => { jp = await connectAccount(); client = await new JoplinClient('html').init(); });
	after(async () => { if (client) client.close(); if (jp) await jp.cleanup(PREFIX); });

	it('are rendered sanitized and read-only; content edits are refused, moves are not', async () => {
		const book = `${PREFIX}-html`;
		const title = `${PREFIX}-clip`;
		const html = '<h2>Clipped page</h2><p>hello <b>world</b></p><script>alert("x")</script><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">bad</a>';
		await client.run('mkbook', book);
		await client.run('use', book);
		await client.run('mknote', title);
		await client.run('set', title, 'markup_language', '2');
		await client.run('set', title, 'body', html);
		await client.sync();
		const n = await client.note(title);
		assert.equal(n.markup_language, 2);

		// Joplock shows it rendered and read-only, with the dangerous bits gone.
		const ed = await jp.ok('GET', `/fragments/editor/${n.id}`);
		assert.match(ed.text, /data-html-note="1"/);
		assert.match(ed.text, /HTML note/);
		const slot = /data-rendered-body="([^"]*)"/.exec(ed.text);
		assert.ok(slot, 'rendered body present');
		const rendered = slot[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
		assert.match(rendered, /<h2>Clipped page<\/h2>/);
		assert.match(rendered, /<b>world<\/b>/);
		assert.doesNotMatch(rendered, /script|onerror|javascript:|alert/i);

		// A content edit is refused and the stored HTML is untouched.
		const before = await jp.rawItem(n.id);
		const refused = await jp.updateNote(n.id, { title, body: '<p>overwritten</p>' });
		assert.equal(refused.status, 403, refused.text);
		assert.equal(await jp.rawItem(n.id), before, 'item on the server is byte-identical');

		// The real autosave path (form PUT) for a MOVE of an HTML note: allowed, body kept.
		const dest = await jp.createFolder(`${PREFIX}-html-dest`);
		const moved = await jp.request('PUT', `/fragments/editor/${n.id}`, {
			form: { title, body: n.body, parentId: dest, currentFolderId: dest },
		});
		assert.equal(moved.status, 200, moved.text);
		await sleep(300);
		await client.sync();
		const after = await client.note(title);
		assert.equal(after.parent_id, dest);
		assert.equal(after.markup_language, 2);
		assert.equal(after.body, html, 'HTML body byte-for-byte');
	});
});

describe('Joplin end-to-end encrypted items', { skip, concurrency: false }, () => {
	let jp;
	before(async () => { jp = await connectAccount(); });
	after(async () => { if (jp) await jp.cleanup(PREFIX); });

	// What a client uploads for an encrypted item: ids, parent and the ciphertext only.
	const encryptedItem = (type, id, parent) => [
		`id: ${id}`, ...(type === 1 ? [`parent_id: ${parent}`] : []),
		'encryption_cipher_text: JED01000007fakeciphertextfakeciphertextfakeciphertext',
		'encryption_applied: 1',
		`type_: ${type}`,
	].join('\n');

	it('notes show as a locked placeholder and can never be changed from Joplock', async () => {
		const folder = await jp.createFolder(`${PREFIX}-e2ee`);
		const id = id32();
		await jp.putRawItem(id, encryptedItem(1, id, folder));
		const before = await jp.rawItem(id);
		assert.match(before, /encryption_applied: 1/);

		const headers = await jp.noteHeaders();
		const h = headers.find(x => x.id === id);
		assert.ok(h, 'listed (not silently dropped)');
		assert.match(h.title, /Encrypted note/);

		const ed = await jp.ok('GET', `/fragments/editor/${id}`);
		assert.match(ed.text, /editor-e2ee/);
		assert.doesNotMatch(ed.text, /<form|<textarea/);

		const put = await jp.updateNote(id, { title: 'overwrite', body: 'plaintext', parentId: folder });
		assert.equal(put.status, 403, put.text);
		assert.match(put.text, /end-to-end encrypted/);
		const trash = await jp.request('DELETE', `/fragments/notes/${id}`);
		assert.equal(trash.status, 403, trash.text);
		const hard = await jp.request('DELETE', `/api/web/notes/${id}`);
		assert.equal(hard.status, 403, hard.text);
		assert.equal(await jp.rawItem(id), before, 'ciphertext on the server is byte-identical');
	});

	it('notebooks show as locked, cannot be renamed, moved or deleted; a parent holding them cannot be deleted half-way', async () => {
		const parent = await jp.createFolder(`${PREFIX}-e2ee-parent`);
		const encFolder = id32();
		await jp.putRawItem(encFolder, [
			`id: ${encFolder}`, `parent_id: ${parent}`, 'encryption_cipher_text: JED01000007fakefolderciphertext', 'encryption_applied: 1', 'type_: 2',
		].join('\n'));
		const folders = await jp.folders();
		const f = folders.find(x => x.id === encFolder);
		assert.ok(f, 'listed');
		assert.match(f.title, /Encrypted notebook/);
		const before = await jp.rawItem(encFolder);

		assert.equal((await jp.request('PUT', `/api/web/folders/${encFolder}`, { json: { title: 'x' } })).status, 403);
		assert.equal((await jp.request('PUT', `/api/web/folders/${encFolder}`, { json: { parentId: '' } })).status, 403);
		assert.equal((await jp.request('DELETE', `/api/web/folders/${encFolder}`)).status, 403);
		const del = await jp.request('DELETE', `/api/web/folders/${parent}`);
		assert.equal(del.status, 409, del.text);
		assert.equal(await jp.rawItem(encFolder), before, 'untouched');
		assert.ok((await jp.folders()).some(x => x.id === parent), 'the parent was not half-deleted');
	});
});

describe('Conflict copies', { skip, concurrency: false }, () => {
	let jp; let client;
	before(async () => { jp = await connectAccount(); client = await new JoplinClient('cf').init(); });
	after(async () => { if (client) client.close(); if (jp) await jp.cleanup(PREFIX); });

	it('are hidden from Joplock lists like in Joplin, and travel with a deleted notebook', async () => {
		const parent = await jp.createFolder(`${PREFIX}-conf`);
		const normal = id32();
		const conflict = id32();
		await jp.putRawItem(normal, rawNote(normal, parent, `${PREFIX}-normal`, 'normal body'));
		await jp.putRawItem(conflict, rawNote(conflict, parent, `${PREFIX}-conflict`, 'conflict body', ['is_conflict: 1']).replace('is_conflict: 0\n', '').replace('conflict_original_id: ', `conflict_original_id: ${normal}`));

		const headers = await jp.noteHeaders();
		assert.ok(headers.some(h => h.id === normal), 'normal note listed');
		assert.ok(!headers.some(h => h.id === conflict), 'conflict note hidden from the note list');
		const inFolder = (await jp.ok('GET', `/api/web/notes?folderId=${parent}`)).data.items;
		assert.ok(!inFolder.some(n => n.id === conflict));

		// the real client still has it (as a conflict)
		await client.sync();
		const theirs = await client.noteById(conflict);
		assert.ok(theirs, 'the client has the conflict copy');
		assert.equal(theirs.is_conflict, 1);

		// deleting the notebook moves BOTH notes (the hidden one must not be left pointing at nothing)
		assert.equal((await jp.request('DELETE', `/api/web/folders/${parent}`)).status, 204);
		await sleep(300);
		await client.sync();
		const normalAfter = await client.noteById(normal);
		const conflictAfter = await client.noteById(conflict);
		assert.notEqual(normalAfter.parent_id, parent, 'normal note moved out');
		assert.notEqual(conflictAfter.parent_id, parent, 'conflict copy moved out too');
		assert.equal(conflictAfter.is_conflict, 1, 'and is still a conflict copy');
	});
});

describe('Attachments uploaded in Joplock', { skip, concurrency: false }, () => {
	let jp; let client; let tmp;
	before(async () => { jp = await connectAccount(); client = await new JoplinClient('res').init(); tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-res-')); });
	after(async () => { if (client) client.close(); if (jp) await jp.cleanup(PREFIX); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

	// 1x1 PNG
	const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

	it('are downloaded by the client and look exactly like client-made attachments', async () => {
		// reference: an attachment made by the real client
		const book = `${PREFIX}-res`;
		await client.run('mkbook', book);
		await client.run('use', book);
		await client.run('mknote', `${PREFIX}-res-note`);
		const file = path.join(tmp, 'ref.png');
		fs.writeFileSync(file, PNG);
		await client.run('attach', `${PREFIX}-res-note`, file);
		await client.sync();
		const [ref] = await client.all('SELECT * FROM resources WHERE filename = ? OR title = ?', ['ref.png', 'ref.png']);
		assert.ok(ref, 'client-made resource exists');

		// the same image uploaded through Joplock's UI endpoint, linked from a note
		const resId = await jp.uploadResource('upl.png', 'image/png', PNG);
		const folder = (await jp.folders()).find(f => f.title === book);
		await jp.createNote(`${PREFIX}-res-note2`, `![upl.png](:/${resId})`, folder.id);
		await sleep(400);
		await client.sync();
		const mine = (await client.all('SELECT * FROM resources WHERE id = ?', [resId]))[0];
		assert.ok(mine, 'the client received the resource record');
		assert.equal(mine.mime, 'image/png');
		assert.equal(mine.size, PNG.length);
		assert.equal(mine.file_extension, 'png');
		for (const field of ['encryption_applied', 'encryption_blob_encrypted', 'ocr_status', 'ocr_driver_id', 'ocr_error', 'ocr_text', 'is_shared']) {
			assert.equal(mine[field], ref[field], `${field} matches what Joplin itself writes`);
		}
		const blob = path.join(client.profile, 'resources', `${resId}.png`);
		assert.ok(fs.existsSync(blob), 'the client downloaded the attachment');
		assert.deepEqual(fs.readFileSync(blob), PNG, 'byte-identical');
	});
});

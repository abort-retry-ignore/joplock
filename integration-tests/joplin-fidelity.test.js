'use strict';

// Does editing in Joplock change anything a Joplin client cares about?
// Items are created by the REAL Joplin client, synced up, then edited / moved /
// trashed through Joplock, then synced back down and compared field by field.
//
//   npm run setup:joplin-cli && npm run test:joplin

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { skipReason, sleep, JoplinClient, connectAccount } = require('./joplin/harness');

const skip = skipReason();
const PREFIX = `jc-fid-${Date.now().toString(36)}`;
const id32 = () => crypto.randomBytes(16).toString('hex');

describe('Joplock keeps Joplin note fields intact', { skip, concurrency: false }, () => {
	let jp;
	let client;
	before(async () => {
		jp = await connectAccount();
		client = await new JoplinClient('fid').init();
	});
	after(async () => {
		if (client) client.close();
		if (jp) await jp.cleanup(PREFIX);
	});

	// Create a notebook + notes in the real client, push them, and return the
	// ids as Joplock sees them.
	const seed = async (label, build) => {
		const book = `${PREFIX}-${label}`;
		await client.run('mkbook', book);
		await client.run('use', book);
		await build(book);
		await client.sync();
		return book;
	};
	const pull = async () => { await sleep(300); await client.sync(); };

	it('a to-do stays a to-do after a Joplock edit (is_todo, todo_due)', async () => {
		const title = `${PREFIX}-todo`;
		await seed('todo', async () => {
			await client.run('mktodo', title);
			await client.run('set', title, 'todo_due', '2030-05-01 10:00');
			await client.run('set', title, 'body', 'original body');
		});
		const before = await client.note(title);
		assert.equal(before.is_todo, 1);
		assert.notEqual(before.todo_due, 0);

		const r = await jp.updateNote(before.id, { title, body: 'edited in joplock' });
		assert.equal(r.status, 200, r.text);
		await pull();

		const after = await client.note(title);
		assert.equal(after.body, 'edited in joplock');
		assert.equal(after.is_todo, 1, 'still a to-do');
		assert.equal(after.todo_due, before.todo_due, 'due date kept');
		assert.equal(after.todo_completed, before.todo_completed);
	});

	it('author, source URL and location survive an edit', async () => {
		const title = `${PREFIX}-meta`;
		await seed('meta', async () => {
			await client.run('mknote', title);
			await client.run('set', title, 'author', 'Jane Author');
			await client.run('set', title, 'source_url', 'https://example.com/src');
			await client.run('set', title, 'latitude', '51.5');
			await client.run('set', title, 'longitude', '-0.12');
			await client.run('set', title, 'body', 'meta body');
		});
		const before = await client.note(title);
		await jp.updateNote(before.id, { title, body: 'meta body, edited' });
		await pull();
		const after = await client.note(title);
		assert.equal(after.body, 'meta body, edited');
		for (const f of ['author', 'source_url', 'latitude', 'longitude', 'altitude']) {
			assert.equal(after[f], before[f], `${f} unchanged`);
		}
	});

	it('order, creation times and the original source_application survive an edit', async () => {
		const title = `${PREFIX}-order`;
		await seed('order', async () => { await client.run('mknote', title); await client.run('set', title, 'body', 'x'); });
		const before = await client.note(title);
		assert.ok(before.order > 0, 'Joplin gives new notes an order');
		assert.equal(before.source_application, 'net.cozic.joplin-cli');
		await jp.updateNote(before.id, { title, body: 'y' });
		await pull();
		const after = await client.note(title);
		assert.equal(after.order, before.order, 'order');
		assert.equal(after.created_time, before.created_time, 'created_time');
		assert.equal(after.user_created_time, before.user_created_time, 'user_created_time');
		assert.equal(after.source_application, 'net.cozic.joplin-cli', 'original source_application kept');
		assert.equal(after.source, before.source);
	});

	it('user_updated_time moves on a real edit but NOT on a move, trash or restore', async () => {
		const title = `${PREFIX}-times`;
		const book = await seed('times', async () => { await client.run('mknote', title); await client.run('set', title, 'body', 'x'); });
		const other = await jp.createFolder(`${PREFIX}-times-dest`);
		const n0 = await client.note(title);

		// move only (same title/body)
		await sleep(1100);
		let r = await jp.updateNote(n0.id, { title, body: 'x', parentId: other });
		assert.equal(r.status, 200, r.text);
		await pull();
		const moved = await client.note(title);
		assert.equal(moved.parent_id, other, 'moved');
		assert.equal(moved.user_updated_time, n0.user_updated_time, 'a move leaves user_updated_time alone');
		assert.ok(moved.updated_time > n0.updated_time, 'but updated_time moves so sync sees it');

		// trash + restore
		await sleep(1100);
		assert.equal((await jp.request('DELETE', `/fragments/notes/${n0.id}`)).status, 200);
		await pull();
		const trashed = await client.note(title);
		assert.ok(trashed.deleted_time > 0, 'trashed');
		assert.equal(trashed.user_updated_time, n0.user_updated_time, 'trash leaves user_updated_time alone');
		assert.equal((await jp.request('POST', `/fragments/notes/${n0.id}/restore`)).status, 200);
		await pull();
		const restored = await client.note(title);
		assert.equal(restored.deleted_time, 0);
		assert.equal(restored.user_updated_time, n0.user_updated_time, 'restore leaves user_updated_time alone');

		// real edit
		await sleep(1100);
		await jp.updateNote(n0.id, { title, body: 'x2', parentId: restored.parent_id });
		await pull();
		const edited = await client.note(title);
		assert.ok(edited.user_updated_time > n0.user_updated_time, 'an edit does move user_updated_time');
		void book;
	});

	it('a to-do survives trash and restore', async () => {
		const title = `${PREFIX}-todo-trash`;
		await seed('todo-trash', async () => { await client.run('mktodo', title); await client.run('set', title, 'body', 'b'); });
		const n0 = await client.note(title);
		await jp.request('DELETE', `/fragments/notes/${n0.id}`);
		await jp.request('POST', `/fragments/notes/${n0.id}/restore`);
		await pull();
		const n1 = await client.note(title);
		assert.equal(n1.is_todo, 1);
		assert.equal(n1.deleted_time, 0);
	});

	// The server only stores fields its own Joplin library knows, so "unknown to
	// Joplock" here means fields Joplock does not model but a current Joplin does:
	// is_locked, extracted_resource_ids (newer than Joplock's tables), plus the
	// plugin-owned application_data / user_data.
	it('fields Joplock does not model are passed through (is_locked, extracted_resource_ids, user_data, application_data)', async () => {
		const folder = await jp.createFolder(`${PREFIX}-future`);
		const id = id32();
		const title = `${PREFIX}-future-note`;
		const ts = '2026-01-02T03:04:05.678Z';
		await jp.putRawItem(id, [
			title, '', 'future body', '',
			`id: ${id}`, `parent_id: ${folder}`, `created_time: ${ts}`, `updated_time: ${ts}`,
			'is_conflict: 0', 'latitude: 0.00000000', 'longitude: 0.00000000', 'altitude: 0.0000', 'author: ', 'source_url: ',
			'is_todo: 1', 'todo_due: 0', 'todo_completed: 0', 'source: joplin-desktop', 'source_application: net.cozic.joplin-desktop',
			'application_data: {"app":"data"}', 'order: 1767323045678', `user_created_time: ${ts}`, `user_updated_time: ${ts}`,
			'encryption_cipher_text: ', 'encryption_applied: 0', 'markup_language: 1', 'is_shared: 0', 'share_id: ',
			'conflict_original_id: ', 'master_key_id: ', 'user_data: {"plugin":"state"}', 'deleted_time: 0',
			'is_locked: 1', 'extracted_resource_ids: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			'type_: 1',
		].join('\n'));

		const r = await jp.updateNote(id, { title, body: 'future body, edited' });
		assert.equal(r.status, 200, r.text);
		const raw = await jp.rawItem(id);
		assert.match(raw, /^is_locked: 1$/m, 'is_locked survives');
		assert.match(raw, /^extracted_resource_ids: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$/m, 'extracted_resource_ids survives');
		assert.match(raw, /^user_data: \{"plugin":"state"\}$/m, 'user_data survives');
		assert.match(raw, /^application_data: \{"app":"data"\}$/m, 'application_data survives');
		assert.match(raw, /^is_todo: 1$/m);
		assert.match(raw, /^order: 1767323045678$/m);
		assert.match(raw, /^source_application: net\.cozic\.joplin-desktop$/m);
		assert.match(raw, /^future body, edited$/m);
		assert.match(raw, /^type_: 1$/m);
	});

	it('an HTML note keeps markup_language 2 and its body when moved', async () => {
		const title = `${PREFIX}-html`;
		await seed('html', async () => {
			await client.run('mknote', title);
			await client.run('set', title, 'markup_language', '2');
			await client.run('set', title, 'body', '<p>hello <b>html</b></p>');
		});
		const n0 = await client.note(title);
		assert.equal(n0.markup_language, 2);
		const dest = await jp.createFolder(`${PREFIX}-html-dest`);
		const r = await jp.updateNote(n0.id, { title, body: n0.body, parentId: dest });
		assert.equal(r.status, 200, r.text);
		await pull();
		const n1 = await client.note(title);
		assert.equal(n1.parent_id, dest);
		assert.equal(n1.markup_language, 2, 'still HTML');
		assert.equal(n1.body, '<p>hello <b>html</b></p>', 'body untouched');
	});
});

describe('Joplock keeps Joplin notebook fields intact', { skip, concurrency: false }, () => {
	let jp;
	let client;
	before(async () => { jp = await connectAccount(); client = await new JoplinClient('fidf').init(); });
	after(async () => { if (client) client.close(); if (jp) await jp.cleanup(PREFIX); });

	it('renaming or moving a notebook keeps its icon, user_data and created time', async () => {
		const parent = await jp.createFolder(`${PREFIX}-fparent`);
		const id = id32();
		const title = `${PREFIX}-ficon`;
		const ts = '2025-06-07T08:09:10.111Z';
		const icon = '{"type":1,"emoji":"📘","name":"","dataUrl":""}';
		await jp.putRawItem(id, [
			title, '',
			`id: ${id}`, `created_time: ${ts}`, `updated_time: ${ts}`, `user_created_time: ${ts}`, `user_updated_time: ${ts}`,
			'encryption_cipher_text: ', 'encryption_applied: 0', 'parent_id: ', 'is_shared: 0', 'share_id: ', 'master_key_id: ',
			`icon: ${icon}`, 'user_data: {"plugin":"x"}', 'deleted_time: 0', 'type_: 2',
		].join('\n'));

		assert.equal((await jp.request('PUT', `/api/web/folders/${id}`, { json: { title: `${title}-renamed` } })).status, 200);
		assert.equal((await jp.request('PUT', `/api/web/folders/${id}`, { json: { parentId: parent } })).status, 200);

		const raw = await jp.rawItem(id);
		assert.match(raw, new RegExp(`^icon: ${icon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), 'icon kept');
		assert.match(raw, /^user_data: \{"plugin":"x"\}$/m, 'user_data kept');
		assert.match(raw, /^created_time: 2025-06-07T08:09:10\.111Z$/m, 'created_time kept');
		assert.match(raw, new RegExp(`^parent_id: ${parent}$`, 'm'));

		await client.sync();
		const f = await client.folderById(id);
		assert.equal(f.title, `${title}-renamed`);
		assert.equal(f.parent_id, parent);
		assert.equal(f.icon, icon);
	});
});

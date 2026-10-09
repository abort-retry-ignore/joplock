'use strict';

// Nested notebooks between Joplock and the real Joplin client, both directions.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, sleep, JoplinClient, connectAccount } = require('./joplin/harness');

const skip = skipReason();
const PREFIX = `jc-nest-${Date.now().toString(36)}`;

describe('Nested notebooks between Joplock and a Joplin client', { skip, concurrency: false }, () => {
	let jp; let client;
	before(async () => { jp = await connectAccount(); client = await new JoplinClient('nest').init(); });
	after(async () => { if (client) client.close(); if (jp) await jp.cleanup(PREFIX); });
	const pull = async () => { await sleep(300); await client.sync(); };
	const parentOf = async id => (await jp.folders()).find(f => f.id === id)?.parentId;

	it('a tree built in the Joplin client appears nested in Joplock', async () => {
		const [a, b, c] = ['a', 'b', 'c'].map(x => `${PREFIX}-t1${x}`);
		await client.run('mkbook', a);
		await client.run('mkbook', '-p', a, b);
		await client.run('mkbook', '-p', b, c);
		await client.run('use', c);
		await client.run('mknote', `${PREFIX}-t1-leaf`);
		await client.sync();

		const [fa, fb, fc] = await Promise.all([a, b, c].map(t => client.folder(t)));
		assert.equal(fb.parent_id, fa.id, 'the client itself nested them');
		const folders = await jp.folders();
		const byId = Object.fromEntries(folders.map(f => [f.id, f]));
		assert.equal(byId[fa.id].parentId, '');
		assert.equal(byId[fb.id].parentId, fa.id);
		assert.equal(byId[fc.id].parentId, fb.id);

		// and the nav really renders them nested
		const nav = (await jp.ok('GET', '/fragments/nav')).text;
		assert.match(nav, new RegExp(`data-folder-id="${fc.id}"[^>]*data-parent-id="${fb.id}"[^>]*data-depth="2"`));
		const leaf = (await jp.noteHeaders()).find(n => n.title === `${PREFIX}-t1-leaf`);
		assert.equal(leaf.parentId, fc.id);
	});

	it('a tree built in Joplock arrives nested in the Joplin client', async () => {
		const a = await jp.createFolder(`${PREFIX}-t2a`);
		const b = await jp.createFolder(`${PREFIX}-t2b`, a);
		const c = await jp.createFolder(`${PREFIX}-t2c`, b);
		await jp.createNote(`${PREFIX}-t2-leaf`, 'leaf body', c);
		await pull();
		assert.equal((await client.folderById(a)).parent_id, '');
		assert.equal((await client.folderById(b)).parent_id, a);
		assert.equal((await client.folderById(c)).parent_id, b);
		assert.equal((await client.note(`${PREFIX}-t2-leaf`)).parent_id, c);
	});

	it('moves made in Joplock reach the client, and moves made in the client reach Joplock', async () => {
		const a = await jp.createFolder(`${PREFIX}-t3a`);
		const b = await jp.createFolder(`${PREFIX}-t3b`);
		const c = await jp.createFolder(`${PREFIX}-t3c`, a);
		await pull();

		// Joplock: c -> under b
		assert.equal((await jp.request('PUT', `/api/web/folders/${c}`, { json: { parentId: b } })).status, 200);
		await pull();
		assert.equal((await client.folderById(c)).parent_id, b);

		// client: c -> top level, then under a again
		await client.run('mv', c, 'root');
		await client.sync();
		await sleep(300);
		assert.equal(await parentOf(c), '', 'client moved it to the top level');
		await client.run('mv', c, a);
		await client.sync();
		await sleep(300);
		assert.equal(await parentOf(c), a);
	});

	it('both refuse to nest a notebook under its own descendant', async () => {
		const a = await jp.createFolder(`${PREFIX}-t4a`);
		const b = await jp.createFolder(`${PREFIX}-t4b`, a);
		await pull();
		await assert.rejects(client.run('mv', a, b), /Cannot move/i, 'Joplin refuses');
		const r = await jp.request('PUT', `/api/web/folders/${a}`, { json: { parentId: b } });
		assert.equal(r.status, 400, 'Joplock refuses too');
		assert.equal(await parentOf(a), '');
	});

	it('renames keep the nesting and travel both ways', async () => {
		const a = await jp.createFolder(`${PREFIX}-t5a`);
		const b = await jp.createFolder(`${PREFIX}-t5b`, a);
		await pull();
		assert.equal((await jp.request('PUT', `/api/web/folders/${b}`, { json: { title: `${PREFIX}-t5b-renamed` } })).status, 200);
		await pull();
		const rb = await client.folderById(b);
		assert.equal(rb.title, `${PREFIX}-t5b-renamed`);
		assert.equal(rb.parent_id, a, 'still nested after a Joplock rename');

		await client.run('ren', b, `${PREFIX}-t5b-again`);
		await client.sync();
		await sleep(300);
		const jb = (await jp.folders()).find(f => f.id === b);
		assert.equal(jb.title, `${PREFIX}-t5b-again`);
		assert.equal(jb.parentId, a);
	});

	it('deleting a middle notebook in Joplock promotes its children and notes; the client converges', async () => {
		const a = await jp.createFolder(`${PREFIX}-t6a`);
		const b = await jp.createFolder(`${PREFIX}-t6b`, a);
		const c = await jp.createFolder(`${PREFIX}-t6c`, b);
		const nb = await jp.createNote(`${PREFIX}-t6-note-b`, 'in the middle', b);
		const nc = await jp.createNote(`${PREFIX}-t6-note-c`, 'in the leaf', c);
		await pull();
		assert.equal((await jp.request('DELETE', `/api/web/folders/${b}`)).status, 204);
		await pull();
		assert.equal(await client.folderById(b), undefined, 'the deleted notebook is gone from the client');
		assert.equal((await client.folderById(c)).parent_id, a, 'its child was promoted');
		assert.equal((await client.noteById(nb)).parent_id, a, 'its note moved to the parent');
		assert.equal((await client.noteById(nc)).parent_id, c, 'the child keeps its own note');
	});

	it('Joplin 3 trashing a notebook with sub-notebooks removes the whole subtree from Joplock', async () => {
		const a = `${PREFIX}-t7a`;
		await client.run('mkbook', a);
		await client.run('mkbook', '-p', a, `${PREFIX}-t7b`);
		await client.run('use', `${PREFIX}-t7b`);
		await client.run('mknote', `${PREFIX}-t7-note`);
		await client.sync();
		const fa = await client.folder(a);
		const fb = await client.folder(`${PREFIX}-t7b`);
		await sleep(300);
		assert.ok((await jp.folders()).some(f => f.id === fb.id), 'visible first');

		await client.run('rmbook', '-f', a);
		await client.sync();
		await sleep(400);
		const ids = (await jp.folders()).map(f => f.id);
		assert.ok(!ids.includes(fa.id) && !ids.includes(fb.id), 'neither level is listed any more');
		assert.ok(!(await jp.noteHeaders()).some(n => n.title === `${PREFIX}-t7-note` && !n.deletedTime), 'the note is not in a live notebook');
	});
});

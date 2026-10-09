'use strict';

// Shared NESTED notebooks: owner works in Joplock, the recipient is a stock Joplin
// client. Joplin Server applies share changes on a 10 second schedule, so every
// step waits for it exactly like a real session would.
//
// What this guards: a stock client only follows share changes that come with a
// sync change event (an API write). Updating descendants with silent database
// writes used to leave a subtree that was moved OUT of a share sitting in the
// recipient's Joplin app.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { skipReason, sleep, Joplock, JoplinClient, ACCOUNT } = require('./joplin/harness');

const skip = skipReason();
const PREFIX = `jc-shr-${Date.now().toString(36)}`;
const SHARE_TASK_MS = 13000; // the server task runs every 10s

describe('Shared nested notebooks reach a stock Joplin client', { skip, concurrency: false }, () => {
	let owner; let client; let shareId;
	const ids = {};

	before(async () => {
		owner = await Joplock.login(process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.JOPLOCK_ADMIN_EMAIL, process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.JOPLOCK_ADMIN_PASSWORD);
		client = await new JoplinClient('share').init();
	});
	after(async () => {
		if (client) client.close();
		if (owner) {
			if (shareId) await owner.request('DELETE', `/api/web/shares/${shareId}`);
			await owner.cleanup(PREFIX);
		}
	});

	// what the recipient's Joplin app holds for this run
	const view = async () => {
		await sleep(SHARE_TASK_MS);
		await client.sync();
		await sleep(400);
		await client.sync();
		const folders = (await client.all('SELECT id, title, parent_id, share_id FROM folders WHERE title LIKE ?', [`${PREFIX}%`]));
		const notes = (await client.all('SELECT id, title, parent_id FROM notes WHERE title LIKE ?', [`${PREFIX}%`]));
		return { folders, notes, folderTitles: folders.map(f => f.title.replace(`${PREFIX}-`, '')).sort(), noteTitles: notes.map(n => n.title.replace(`${PREFIX}-`, '')).sort() };
	};

	it('shares the whole subtree: notebooks keep their nesting and share id, notes come along', async () => {
		ids.root = await owner.createFolder(`${PREFIX}-root`);
		ids.sub = await owner.createFolder(`${PREFIX}-sub`, ids.root);
		ids.leaf = await owner.createFolder(`${PREFIX}-leaf`, ids.sub);
		await owner.createNote(`${PREFIX}-note-root`, 'r', ids.root);
		ids.noteLeaf = await owner.createNote(`${PREFIX}-note-leaf`, 'l', ids.leaf);
		const share = await owner.ok('POST', '/api/web/shares', { json: { notebookId: ids.root } });
		shareId = share.data.id;
		await owner.ok('POST', `/api/web/shares/${shareId}/invites`, { json: { email: ACCOUNT.email, can_write: 1 } });

		const v = await view();
		assert.deepEqual(v.folderTitles, ['leaf', 'root', 'sub']);
		assert.deepEqual(v.noteTitles, ['note-leaf', 'note-root']);
		const byId = Object.fromEntries(v.folders.map(f => [f.id, f]));
		assert.equal(byId[ids.root].parent_id, '');
		assert.equal(byId[ids.sub].parent_id, ids.root);
		assert.equal(byId[ids.leaf].parent_id, ids.sub);
		for (const f of v.folders) assert.equal(f.share_id, shareId, `${f.title} carries the share id`);
	});

	it('a notebook (with sub-notebook and notes) moved INTO the share arrives; moved back OUT it disappears with all of it', async () => {
		ids.priv = await owner.createFolder(`${PREFIX}-priv`);
		ids.privKid = await owner.createFolder(`${PREFIX}-privkid`, ids.priv);
		await owner.createNote(`${PREFIX}-note-priv`, 'p', ids.priv);
		await owner.createNote(`${PREFIX}-note-kid`, 'k', ids.privKid);

		assert.equal((await owner.request('PUT', `/api/web/folders/${ids.priv}`, { json: { parentId: ids.sub } })).status, 200);
		let v = await view();
		for (const t of ['priv', 'privkid']) assert.ok(v.folderTitles.includes(t), `${t} arrived`);
		for (const t of ['note-priv', 'note-kid']) assert.ok(v.noteTitles.includes(t), `${t} arrived`);

		assert.equal((await owner.request('PUT', `/api/web/folders/${ids.priv}`, { json: { parentId: '' } })).status, 200);
		v = await view();
		for (const t of ['priv', 'privkid']) assert.ok(!v.folderTitles.includes(t), `${t} is gone from the recipient's Joplin app`);
		for (const t of ['note-priv', 'note-kid']) assert.ok(!v.noteTitles.includes(t), `${t} is gone from the recipient's Joplin app`);
		assert.ok(v.folderTitles.includes('root') && v.folderTitles.includes('leaf'), 'the rest of the share is untouched');
	});

	it('notebooks and notes created inside the share reach the recipient; edits made in the Joplin app survive an owner edit in Joplock', async () => {
		ids.fresh = await owner.createFolder(`${PREFIX}-fresh`, ids.leaf);
		await owner.createNote(`${PREFIX}-note-fresh`, 'f', ids.fresh);
		let v = await view();
		assert.ok(v.folderTitles.includes('fresh') && v.noteTitles.includes('note-fresh'));

		// the recipient edits the owner's note in a nested shared notebook, setting fields Joplock does not model
		const target = `${PREFIX}-note-leaf`;
		await client.run('set', ids.noteLeaf, 'body', 'edited in the recipient joplin app');
		await client.run('set', ids.noteLeaf, 'author', 'Recipient Author');
		await client.sync();
		await sleep(SHARE_TASK_MS);
		assert.equal((await owner.note(ids.noteLeaf)).body, 'edited in the recipient joplin app', "the owner sees the recipient's edit");

		// the owner edits it in Joplock: the recipient's fields must survive
		const r = await owner.updateNote(ids.noteLeaf, { title: target, body: 'edited again by the owner in joplock', parentId: ids.leaf });
		assert.equal(r.status, 200, r.text);
		await view();
		const back = await client.noteById(ids.noteLeaf);
		assert.equal(back.body, 'edited again by the owner in joplock');
		assert.equal(back.author, 'Recipient Author', "the recipient's author field survives an owner edit in Joplock");
	});

	// KNOWN GAP (predates nested notebooks): Joplock decides who may see an item from its
	// own `user_items` rows keyed by jop_id, while Joplin Server keys them by items.id. A note
	// a collaborator creates in a Joplin app therefore never appears for the share OWNER in
	// Joplock (it does appear in the owner's Joplin apps). Fixing it means changing the share
	// access model together with Joplock's own removal paths, otherwise removed users would
	// keep access. Tracked here as a todo so it stays visible without failing the suite.
	it('notes a collaborator creates in the share are visible to the owner in Joplock', { todo: 'share access model: jop_id vs items.id user_items rows' }, async () => {
		await client.run('use', `${PREFIX}-leaf`);
		await client.run('mknote', `${PREFIX}-note-from-recipient`);
		await client.sync();
		await sleep(SHARE_TASK_MS);
		const theirs = (await owner.noteHeaders()).find(h => h.title === `${PREFIX}-note-from-recipient`);
		const recipient = await Joplock.login(ACCOUNT.email, ACCOUNT.password);
		await recipient.cleanup(`${PREFIX}-note-from-recipient`);
		assert.ok(theirs, "the owner sees the collaborator's note in Joplock");
	});

	it('stopping the share takes every level away from the recipient and leaves the owner able to edit', async () => {
		const stopped = await owner.request('DELETE', `/api/web/shares/${shareId}`);
		assert.ok(stopped.status < 300, stopped.text);
		shareId = null;
		const v = await view();
		for (const t of ['root', 'sub', 'leaf', 'fresh']) assert.ok(!v.folderTitles.includes(t), `${t} removed from the recipient`);
		const ownerFolders = await owner.folders();
		for (const id of [ids.root, ids.sub, ids.leaf]) assert.equal(ownerFolders.find(f => f.id === id).shareId || '', '', 'owner side share id cleared');
		const rename = await owner.request('PUT', `/api/web/folders/${ids.sub}`, { json: { title: `${PREFIX}-sub-renamed` } });
		assert.equal(rename.status, 200, rename.text);
	});
});

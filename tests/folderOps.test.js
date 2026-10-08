const test = require('node:test');
const assert = require('node:assert/strict');
const { createFolderOps } = require('../app/items/folderOps');

const USER = { id: 'u1', sessionId: 's1' };

// Minimal in-memory world: folders/notes arrays + recorded writes.
const world = ({ folders = [], notes = [], vaults = [], shareSyncOn = true } = {}) => {
	const calls = [];
	const state = { folders: folders.map(f => ({ parentId: '', ownerId: 'u1', shareId: '', isShared: false, deletedTime: 0, ...f })), notes: notes.map(n => ({ shareId: '', isShared: false, ownerId: 'u1', ...n })) };
	let seq = 0;
	const itemService = {
		foldersByUserId: async () => state.folders.map(f => ({ ...f })),
		folderByUserIdAndJopId: async (userId, id) => { const f = state.folders.find(x => x.id === id); return f ? { ...f } : null; },
		notesByUserId: async (userId, opts = {}) => state.notes.filter(n => !opts.folderId || n.parentId === opts.folderId).map(n => ({ ...n })),
	};
	const itemWriteService = {
		createFolder: async (sid, folder) => { const id = `new${++seq}`; calls.push(['createFolder', folder]); state.folders.push({ id, ownerId: 'u1', deletedTime: 0, ...folder }); return { id }; },
		updateFolder: async (sid, existing, updates) => { calls.push(['updateFolder', existing.id, updates]); Object.assign(state.folders.find(f => f.id === existing.id), updates); },
		updateNote: async (sid, existing, updates) => { calls.push(['updateNote', existing.id, updates]); Object.assign(state.notes.find(n => n.id === existing.id), updates); },
		deleteFolder: async (sid, id) => { calls.push(['deleteFolder', id]); state.folders = state.folders.filter(f => f.id !== id); },
	};
	const vaultService = { getVaultFolderIdSet: async () => new Set(vaults) };
	const sync = [];
	const shareSync = shareSyncOn ? {
		setSubtreeShare: async a => { sync.push(['subtree', a]); },
		setItemsShare: async a => { sync.push(['items', a]); },
	} : undefined;
	const ops = createFolderOps({ itemService, itemWriteService, vaultService, shareSync });
	return { ops, calls, sync, state };
};
const ctx = {};
const rejects = (promise, status, re) => assert.rejects(promise, e => { assert.equal(e.statusCode, status, e.message); if (re) assert.match(e.message, re); return true; });

const tree = () => [
	{ id: 'work', title: 'Work' },
	{ id: 'proj', title: 'Projects', parentId: 'work' },
	{ id: 'alpha', title: 'Alpha', parentId: 'proj' },
	{ id: 'home', title: 'Home' },
];

// ── create ──
test('createFolder creates at the top level or under a parent', async () => {
	const w = world({ folders: tree() });
	const top = await w.ops.createFolder({ user: USER, title: ' Top ', requestContext: ctx });
	assert.equal(top.parentId, '');
	const sub = await w.ops.createFolder({ user: USER, title: 'Sub', parentId: 'proj', requestContext: ctx });
	assert.equal(sub.parentId, 'proj');
	assert.deepEqual(w.calls[0][1], { title: 'Top', parentId: '', shareId: '', isShared: false });
	assert.equal(w.calls[1][1].parentId, 'proj');
	assert.deepEqual(w.sync, []);
});

test('createFolder validates title and parent', async () => {
	const w = world({ folders: tree() });
	await rejects(w.ops.createFolder({ user: USER, title: '  ' }), 400, /title/i);
	await rejects(w.ops.createFolder({ user: USER, title: 'x', parentId: 'nope' }), 404, /Parent notebook/);
});

test('createFolder refuses to nest under a vault', async () => {
	const w = world({ folders: tree(), vaults: ['home'] });
	await rejects(w.ops.createFolder({ user: USER, title: 'x', parentId: 'home' }), 400, /Vault/);
	assert.equal(w.calls.length, 0);
});

test('createFolder in a shared notebook inherits the share and grants recipients; recipients are refused', async () => {
	const w = world({ folders: [{ id: 'sh', title: 'Shared', shareId: 'S1', isShared: true }] });
	const out = await w.ops.createFolder({ user: USER, title: 'Kid', parentId: 'sh', requestContext: ctx });
	assert.equal(out.shareId, 'S1');
	assert.equal(w.calls[0][1].shareId, 'S1');
	assert.equal(w.calls[0][1].isShared, true);
	assert.deepEqual(w.sync.map(s => [s[0], s[1].shareId, s[1].folderId]), [['subtree', 'S1', out.id]]);

	const theirs = world({ folders: [{ id: 'sh', title: 'Shared', shareId: 'S1', isShared: true, ownerId: 'someone-else' }] });
	await rejects(theirs.ops.createFolder({ user: USER, title: 'Kid', parentId: 'sh' }), 403);
});

// ── move ──
test('moveFolder reparents, including to the top level', async () => {
	const w = world({ folders: tree() });
	const r = await w.ops.moveFolder({ user: USER, folderId: 'alpha', targetParentId: 'home', requestContext: ctx });
	assert.equal(r.changed, true);
	assert.deepEqual(w.calls[0], ['updateFolder', 'alpha', { parentId: 'home' }]);
	await w.ops.moveFolder({ user: USER, folderId: 'proj', targetParentId: '', requestContext: ctx });
	assert.deepEqual(w.calls[1], ['updateFolder', 'proj', { parentId: '' }]);
	assert.deepEqual(w.sync, []);
});

test('moveFolder to where it already is does nothing', async () => {
	const w = world({ folders: tree() });
	const r = await w.ops.moveFolder({ user: USER, folderId: 'proj', targetParentId: 'work' });
	assert.equal(r.changed, false);
	assert.equal(w.calls.length, 0);
});

test('moveFolder rejects self, descendants and unknown notebooks', async () => {
	const w = world({ folders: tree() });
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'work', targetParentId: 'work' }), 400, /itself/);
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'work', targetParentId: 'alpha' }), 400, /sub-notebooks/);
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'ghost', targetParentId: 'home' }), 404);
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'alpha', targetParentId: 'ghost' }), 404);
	assert.equal(w.calls.length, 0);
});

test('moveFolder keeps vaults at the top level and leaf-only', async () => {
	const w = world({ folders: tree(), vaults: ['home'] });
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'home', targetParentId: 'work' }), 400, /top level/);
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'alpha', targetParentId: 'home' }), 400, /Vault/);
});

const sharedTree = () => [
	{ id: 'shared', title: 'Shared', shareId: 'S1', isShared: true },
	{ id: 'sub', title: 'Sub', parentId: 'shared', shareId: 'S1', isShared: true },
	{ id: 'leaf', title: 'Leaf', parentId: 'sub', shareId: 'S1', isShared: true },
	{ id: 'private', title: 'Private' },
	{ id: 'pkid', title: 'PKid', parentId: 'private' },
];

test('moving a notebook INTO a share stamps the subtree and grants recipients', async () => {
	const w = world({ folders: sharedTree() });
	const r = await w.ops.moveFolder({ user: USER, folderId: 'pkid', targetParentId: 'sub', requestContext: ctx });
	assert.equal(r.shareChanged, true);
	assert.deepEqual(w.calls[0], ['updateFolder', 'pkid', { parentId: 'sub', shareId: 'S1', isShared: true }]);
	assert.deepEqual(w.sync, [['subtree', { ownerId: 'u1', folderId: 'pkid', shareId: 'S1', previousShareId: '' }]]);
});

test('moving a notebook OUT of a share clears the subtree and revokes recipients', async () => {
	const w = world({ folders: sharedTree() });
	await w.ops.moveFolder({ user: USER, folderId: 'sub', targetParentId: 'private', requestContext: ctx });
	assert.deepEqual(w.calls[0], ['updateFolder', 'sub', { parentId: 'private', shareId: '', isShared: false }]);
	assert.deepEqual(w.sync, [['subtree', { ownerId: 'u1', folderId: 'sub', shareId: '', previousShareId: 'S1' }]]);
});

test('moving within the same share changes the parent only (no share churn)', async () => {
	const w = world({ folders: sharedTree() });
	await w.ops.moveFolder({ user: USER, folderId: 'leaf', targetParentId: 'shared', requestContext: ctx });
	assert.deepEqual(w.calls[0], ['updateFolder', 'leaf', { parentId: 'shared' }]);
	assert.deepEqual(w.sync, []);
});

test('a share root cannot be nested, but the owner-only rules hold', async () => {
	const w = world({ folders: sharedTree() });
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'shared', targetParentId: 'private' }), 400, /Stop sharing/);

	const recipient = world({ folders: sharedTree().map(f => f.shareId ? { ...f, ownerId: 'owner2' } : f) });
	await rejects(recipient.ops.moveFolder({ user: USER, folderId: 'sub', targetParentId: '' }), 403, /owner/);
	// ...and a recipient cannot drop their own notebook into someone else's share
	await rejects(recipient.ops.moveFolder({ user: USER, folderId: 'pkid', targetParentId: 'sub' }), 403);
});

test('a subtree containing a vault cannot be moved into a share', async () => {
	const w = world({ folders: [...sharedTree(), { id: 'v', title: 'V', parentId: 'private' }], vaults: ['v'] });
	await rejects(w.ops.moveFolder({ user: USER, folderId: 'private', targetParentId: 'sub' }), 400, /Vault notebooks cannot be shared/);
});

// ── delete (promote) ──
test('deleting a nested notebook promotes sub-notebooks and moves its notes to the parent', async () => {
	const w = world({
		folders: tree(),
		notes: [{ id: 'n1', title: 'A', parentId: 'proj' }, { id: 'n2', title: 'B', parentId: 'alpha' }],
	});
	const r = await w.ops.deleteFolder({ user: USER, folderId: 'proj', requestContext: ctx });
	assert.deepEqual(r.promotedFolders, ['alpha']);
	assert.equal(r.movedNotes, 1);
	assert.equal(r.destinationId, 'work');
	assert.deepEqual(w.calls.map(c => c.slice(0, 2)), [['updateFolder', 'alpha'], ['updateNote', 'n1'], ['deleteFolder', 'proj']]);
	assert.deepEqual(w.calls[0][2], { parentId: 'work' });
	assert.deepEqual(w.calls[1][2], { parentId: 'work' });
	assert.equal(w.state.notes.find(n => n.id === 'n2').parentId, 'alpha', 'the child keeps its own notes');
});

test('deleting a top-level notebook sends its notes to General and promotes children to the top level', async () => {
	const w = world({
		folders: [...tree(), { id: 'gen', title: 'General' }],
		notes: [{ id: 'n1', title: 'A', parentId: 'work' }],
	});
	const r = await w.ops.deleteFolder({ user: USER, folderId: 'work', requestContext: ctx });
	assert.equal(r.destinationId, 'gen');
	assert.deepEqual(r.promotedFolders, ['proj']);
	assert.deepEqual(w.calls[0], ['updateFolder', 'proj', { parentId: '' }]);
	assert.deepEqual(w.calls[1], ['updateNote', 'n1', { parentId: 'gen' }]);
});

test('deleting creates General when it does not exist and ignores a nested notebook that merely has that name', async () => {
	const w = world({
		folders: [{ id: 'a', title: 'A' }, { id: 'g2', title: 'General', parentId: 'a' }],
		notes: [{ id: 'n1', title: 'N', parentId: 'a' }],
	});
	const r = await w.ops.deleteFolder({ user: USER, folderId: 'a', requestContext: ctx });
	assert.equal(w.calls[0][0], 'createFolder');
	assert.equal(w.calls[0][1].title, 'General');
	assert.equal(w.calls[0][1].parentId, '');
	assert.equal(r.destinationId, 'new1');
});

test('deleting an unknown notebook is a 404 and writes nothing', async () => {
	const w = world({ folders: tree() });
	await rejects(w.ops.deleteFolder({ user: USER, folderId: 'ghost' }), 404);
	assert.equal(w.calls.length, 0);
});

test('deleting a shared root un-shares promoted children and moved notes; recipients are revoked', async () => {
	const w = world({
		folders: sharedTree(),
		notes: [{ id: 'n1', title: 'N', parentId: 'shared', shareId: 'S1', isShared: true }],
	});
	const r = await w.ops.deleteFolder({ user: USER, folderId: 'shared', requestContext: ctx });
	assert.deepEqual(r.promotedFolders, ['sub']);
	assert.deepEqual(w.calls.find(c => c[0] === 'updateFolder'), ['updateFolder', 'sub', { parentId: '', shareId: '', isShared: false }]);
	const noteCall = w.calls.find(c => c[0] === 'updateNote');
	assert.deepEqual(noteCall[2], { parentId: w.state.notes[0].parentId, shareId: '', isShared: false });
	assert.deepEqual(w.sync.map(s => [s[0], s[1].shareId, s[1].previousShareId]), [['subtree', '', 'S1'], ['items', '', 'S1']]);
});

test('deleting inside a share keeps promoted items in the share', async () => {
	const w = world({
		folders: sharedTree(),
		notes: [{ id: 'n1', title: 'N', parentId: 'sub', shareId: 'S1', isShared: true }],
	});
	await w.ops.deleteFolder({ user: USER, folderId: 'sub', requestContext: ctx });
	assert.deepEqual(w.calls[0], ['updateFolder', 'leaf', { parentId: 'shared' }]);
	assert.deepEqual(w.calls[1], ['updateNote', 'n1', { parentId: 'shared' }]);
	assert.deepEqual(w.sync, []);
});

test('a recipient cannot delete the owner\'s shared notebook', async () => {
	const w = world({ folders: sharedTree().map(f => f.shareId ? { ...f, ownerId: 'owner2' } : f) });
	await rejects(w.ops.deleteFolder({ user: USER, folderId: 'sub' }), 403);
	assert.equal(w.calls.length, 0);
});

test('operations work without a vault service or share sync', async () => {
	const w = world({ folders: tree(), shareSyncOn: false });
	await w.ops.moveFolder({ user: USER, folderId: 'alpha', targetParentId: 'home' });
	await w.ops.deleteFolder({ user: USER, folderId: 'home' });
	assert.ok(w.calls.length > 0);
});

// ── picker ──
test('pickerEntries: tree order, disables the moved subtree, vaults and foreign shares', async () => {
	const w = world({ folders: [...tree(), { id: 'v', title: 'V' }, { id: 'theirs', title: 'Theirs', shareId: 'S9', ownerId: 'other' }], vaults: ['v'] });
	const entries = await w.ops.pickerEntries({ user: USER, excludeId: 'proj' });
	assert.deepEqual(entries.map(e => e.id), ['work', 'proj', 'alpha', 'home', 'v', 'theirs']);
	const dis = Object.fromEntries(entries.map(e => [e.id, e.disabled]));
	assert.deepEqual(dis, { work: false, proj: true, alpha: true, home: false, v: true, theirs: true });
	assert.equal(entries.find(e => e.id === 'alpha').depth, 2);
});

// ── share eligibility ──
test('prepareForShare lifts a nested notebook to the top level and leaves a top-level one alone', async () => {
	const w = world({ folders: tree() });
	const r = await w.ops.prepareForShare({ user: USER, folderId: 'proj', requestContext: ctx });
	assert.equal(r.liftedToTopLevel, true);
	assert.deepEqual(w.calls[0], ['updateFolder', 'proj', { parentId: '' }]);
	const top = await w.ops.prepareForShare({ user: USER, folderId: 'home', requestContext: ctx });
	assert.equal(top.liftedToTopLevel, false);
	assert.equal(w.calls.length, 1);
});

test('prepareForShare refuses a notebook inside a share, one with a vault below it, and non-owners', async () => {
	const inside = world({ folders: sharedTree() });
	await rejects(inside.ops.prepareForShare({ user: USER, folderId: 'sub' }), 400, /already shared/);
	assert.equal(inside.calls.length, 0);

	const withVault = world({ folders: [...tree(), { id: 'v', title: 'V', parentId: 'work' }], vaults: ['v'] });
	await rejects(withVault.ops.prepareForShare({ user: USER, folderId: 'work' }), 400, /vault/i);

	const theirs = world({ folders: sharedTree().map(f => ({ ...f, ownerId: 'owner2' })) });
	await rejects(theirs.ops.prepareForShare({ user: USER, folderId: 'shared' }), 403);
});

test('shareEligibility reports nesting without writing', async () => {
	const w = world({ folders: tree() });
	const e = await w.ops.shareEligibility({ user: USER, folderId: 'alpha' });
	assert.deepEqual([e.nested, e.insideShare, e.containsVault, e.isOwner], [true, false, false, true]);
	assert.equal(w.calls.length, 0);
});

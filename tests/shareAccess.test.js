'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
	deriveShareFieldsForMove,
	resolveItemShareAccess,
	resolveFolderShareState,
	assertCanWrite,
	assertOwnerForDestructive,
} = require('../app/items/shareAccess');

// ---------------------------------------------------------------------------
// deriveShareFieldsForMove
// ---------------------------------------------------------------------------

test('deriveShareFieldsForMove: null target → { shareId:"", isShared:false }', () => {
	assert.deepEqual(deriveShareFieldsForMove(null), { shareId: '', isShared: false });
});

test('deriveShareFieldsForMove: undefined target → { shareId:"", isShared:false }', () => {
	assert.deepEqual(deriveShareFieldsForMove(undefined), { shareId: '', isShared: false });
});

test('deriveShareFieldsForMove: target with empty shareId → cleared', () => {
	assert.deepEqual(deriveShareFieldsForMove({ shareId: '' }), { shareId: '', isShared: false });
});

test('deriveShareFieldsForMove: target with shareId set → { shareId, isShared:true }', () => {
	assert.deepEqual(deriveShareFieldsForMove({ shareId: 'abc123' }), { shareId: 'abc123', isShared: true });
});

test('deriveShareFieldsForMove: shareId set overrides isShared:false on target', () => {
	// The implementation checks target.shareId truthiness, not isShared.
	// If shareId is set, isShared becomes true regardless.
	assert.deepEqual(
		deriveShareFieldsForMove({ shareId: 'abc123', isShared: false }),
		{ shareId: 'abc123', isShared: true }
	);
});

test('deriveShareFieldsForMove: plain object without shareId → cleared', () => {
	assert.deepEqual(deriveShareFieldsForMove({ id: 'folder1', title: 'Projects' }), { shareId: '', isShared: false });
});

// ---------------------------------------------------------------------------
// assertCanWrite
// ---------------------------------------------------------------------------

test('assertCanWrite: null access throws 404', () => {
	assert.throws(() => assertCanWrite(null), (/** @type {Error & {statusCode?:number}} */ err) => {
		assert.equal(err.statusCode, 404);
		assert.match(err.message, /Not found/);
		return true;
	});
});

test('assertCanWrite: access with canWrite:false throws 403', () => {
	assert.throws(() => assertCanWrite({ canWrite: false }), (/** @type {Error & {statusCode?:number}} */ err) => {
		assert.equal(err.statusCode, 403);
		assert.match(err.message, /Shared items are read-only/);
		return true;
	});
});

test('assertCanWrite: access with canWrite:true does not throw', () => {
	assert.doesNotThrow(() => assertCanWrite({ canWrite: true }));
});

// ---------------------------------------------------------------------------
// assertOwnerForDestructive
// ---------------------------------------------------------------------------

test('assertOwnerForDestructive: null access throws 404', () => {
	assert.throws(() => assertOwnerForDestructive(null), (/** @type {Error & {statusCode?:number}} */ err) => {
		assert.equal(err.statusCode, 404);
		assert.match(err.message, /Not found/);
		return true;
	});
});

test('assertOwnerForDestructive: access with isOwner:false throws 403', () => {
	assert.throws(() => assertOwnerForDestructive({ isOwner: false }), (/** @type {Error & {statusCode?:number}} */ err) => {
		assert.equal(err.statusCode, 403);
		assert.match(err.message, /Only the owner can move or delete this item/);
		return true;
	});
});

test('assertOwnerForDestructive: access with isOwner:true does not throw', () => {
	assert.doesNotThrow(() => assertOwnerForDestructive({ isOwner: true }));
});

// ---------------------------------------------------------------------------
// resolveItemShareAccess
// ---------------------------------------------------------------------------

test('resolveItemShareAccess: returns null when itemService returns null', async () => {
	const itemService = {
		noteByUserIdAndJopId: async () => null,
	};
	const result = await resolveItemShareAccess(itemService, 'user1', 'note1');
	assert.equal(result, null);
});

test('resolveItemShareAccess: itemService rejection caught, returns null', async () => {
	const itemService = {
		noteByUserIdAndJopId: async () => { throw new Error('DB down'); },
	};
	const result = await resolveItemShareAccess(itemService, 'user1', 'note1');
	assert.equal(result, null);
});

test('resolveItemShareAccess: owner note with shareId → isOwner true, canWrite true, isShared true', async () => {
	const itemService = {
		noteByUserIdAndJopId: async () => ({ id: 'note1', ownerId: 'user1', shareId: 'share1' }),
	};
	const result = await resolveItemShareAccess(itemService, 'user1', 'note1');
	assert.ok(result, 'should return access object');
	assert.equal(result.isOwner, true);
	assert.equal(result.canWrite, true);
	assert.equal(result.canRead, true);
	assert.equal(result.isShared, true);
	assert.equal(result.shareId, 'share1');
	assert.equal(result.ownerId, 'user1');
});

test('resolveItemShareAccess: non-owner note with shareId → isOwner false, canWrite false', async () => {
	const itemService = {
		noteByUserIdAndJopId: async () => ({ id: 'note1', ownerId: 'user2', shareId: 'share1' }),
	};
	const result = await resolveItemShareAccess(itemService, 'user1', 'note1');
	assert.ok(result);
	assert.equal(result.isOwner, false);
	assert.equal(result.canWrite, false);
	assert.equal(result.canRead, true);
	assert.equal(result.isShared, true);
	assert.equal(result.ownerId, 'user2');
});

test('resolveItemShareAccess: note with no ownerId → isOwner true (ownerId empty)', async () => {
	const itemService = {
		noteByUserIdAndJopId: async () => ({ id: 'note1', shareId: 'share1' }),
	};
	const result = await resolveItemShareAccess(itemService, 'user1', 'note1');
	assert.ok(result);
	assert.equal(result.isOwner, true);
	assert.equal(result.ownerId, '');
});

test('resolveItemShareAccess: note with isShared:true, no shareId → isShared true from flag', async () => {
	const itemService = {
		noteByUserIdAndJopId: async () => ({ id: 'note1', ownerId: 'user1', isShared: true }),
	};
	const result = await resolveItemShareAccess(itemService, 'user1', 'note1');
	assert.ok(result);
	assert.equal(result.isShared, true);
	assert.equal(result.shareId, '');
});

test('resolveItemShareAccess: note with empty shareId and isShared:false → isShared:false', async () => {
	const itemService = {
		noteByUserIdAndJopId: async () => ({ id: 'note1', ownerId: 'user1', shareId: '', isShared: false }),
	};
	const result = await resolveItemShareAccess(itemService, 'user1', 'note1');
	assert.ok(result);
	assert.equal(result.isShared, false);
	assert.equal(result.shareId, '');
});

test('resolveItemShareAccess: passes options through to noteByUserIdAndJopId', async () => {
	let receivedOptions = null;
	const itemService = {
		noteByUserIdAndJopId: async (_uid, _nid, opts) => {
			receivedOptions = opts;
			return { id: 'note1', ownerId: 'user1' };
		},
	};
	await resolveItemShareAccess(itemService, 'user1', 'note1', { deleted: 'all' });
	assert.deepEqual(receivedOptions, { deleted: 'all' });
});

// ---------------------------------------------------------------------------
// resolveFolderShareState
// ---------------------------------------------------------------------------

test('resolveFolderShareState: returns null when itemService returns null', async () => {
	const itemService = {
		folderByUserIdAndJopId: async () => null,
	};
	const result = await resolveFolderShareState(itemService, 'user1', 'folder1');
	assert.equal(result, null);
});

test('resolveFolderShareState: itemService rejection caught, returns null', async () => {
	const itemService = {
		folderByUserIdAndJopId: async () => { throw new Error('DB down'); },
	};
	const result = await resolveFolderShareState(itemService, 'user1', 'folder1');
	assert.equal(result, null);
});

test('resolveFolderShareState: owner folder with shareId → isOwner true, canWrite true, isShared true', async () => {
	const itemService = {
		folderByUserIdAndJopId: async () => ({ id: 'folder1', ownerId: 'user1', shareId: 'share1' }),
	};
	const result = await resolveFolderShareState(itemService, 'user1', 'folder1');
	assert.ok(result);
	assert.equal(result.isOwner, true);
	assert.equal(result.canWrite, true);
	assert.equal(result.isShared, true);
	assert.equal(result.shareId, 'share1');
	assert.equal(result.ownerId, 'user1');
});

test('resolveFolderShareState: non-owner folder with shareId → isOwner false, canWrite false', async () => {
	const itemService = {
		folderByUserIdAndJopId: async () => ({ id: 'folder1', ownerId: 'user2', shareId: 'share1' }),
	};
	const result = await resolveFolderShareState(itemService, 'user1', 'folder1');
	assert.ok(result);
	assert.equal(result.isOwner, false);
	assert.equal(result.canWrite, false);
	assert.equal(result.isShared, true);
	assert.equal(result.ownerId, 'user2');
});

test('resolveFolderShareState: folder with no ownerId → isOwner true', async () => {
	const itemService = {
		folderByUserIdAndJopId: async () => ({ id: 'folder1', shareId: 'share1' }),
	};
	const result = await resolveFolderShareState(itemService, 'user1', 'folder1');
	assert.ok(result);
	assert.equal(result.isOwner, true);
});

test('resolveFolderShareState: folder with isShared:true, no shareId → isShared true from flag', async () => {
	const itemService = {
		folderByUserIdAndJopId: async () => ({ id: 'folder1', ownerId: 'user1', isShared: true }),
	};
	const result = await resolveFolderShareState(itemService, 'user1', 'folder1');
	assert.ok(result);
	assert.equal(result.isShared, true);
	assert.equal(result.shareId, '');
});

test('resolveFolderShareState: folder with empty shareId and no isShared → isShared false', async () => {
	const itemService = {
		folderByUserIdAndJopId: async () => ({ id: 'folder1', ownerId: 'user1', shareId: '' }),
	};
	const result = await resolveFolderShareState(itemService, 'user1', 'folder1');
	assert.ok(result);
	assert.equal(result.isShared, false);
});

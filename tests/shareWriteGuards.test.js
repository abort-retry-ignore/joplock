'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertShareWriteAccess } = require('../app/routes/_helpers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock itemService with a controlled noteByUserIdAndJopId */
const makeItemService = (noteFn) => ({
	noteByUserIdAndJopId: noteFn,
});

// ---------------------------------------------------------------------------
// assertShareWriteAccess
// ---------------------------------------------------------------------------

test('assertShareWriteAccess: new item path (null) → no throw', async () => {
	const itemService = makeItemService(async () => null);
	await assert.doesNotReject(() => assertShareWriteAccess(itemService, 'user1', 'newNote'));
});

test('assertShareWriteAccess: itemService rejection → new-item path, no throw', async () => {
	const itemService = makeItemService(async () => { throw new Error('DB down'); });
	await assert.doesNotReject(() => assertShareWriteAccess(itemService, 'user1', 'note1'));
});

test('assertShareWriteAccess: owner can write → no throw', async () => {
	const itemService = makeItemService(async () => ({
		id: 'note1', ownerId: 'user1', shareId: 'share1', isShared: true,
	}));
	await assert.doesNotReject(() => assertShareWriteAccess(itemService, 'user1', 'note1'));
});

test('assertShareWriteAccess: non-owner cannot write → throws 403', async () => {
	const itemService = makeItemService(async () => ({
		id: 'note1', ownerId: 'user2', shareId: 'share1', isShared: true,
	}));
	await assert.rejects(
		() => assertShareWriteAccess(itemService, 'user1', 'note1'),
		(err) => {
			assert.equal(err.statusCode, 403);
			assert.match(err.message, /Shared items are read-only/);
			return true;
		}
	);
});

test('assertShareWriteAccess: non-owner non-shared note w/o shareId → canWrite true, no throw', async () => {
	// No shareId means the note is not in a shared context; canWrite is owner-based.
	// When ownerId is empty (legacy), isOwner=true → canWrite=true, so no throw.
	const itemService = makeItemService(async () => ({
		id: 'note1', ownerId: '', shareId: '',
	}));
	await assert.doesNotReject(() => assertShareWriteAccess(itemService, 'user1', 'note1'));
});

test('assertShareWriteAccess: passes through to resolveItemShareAccess correctly', async () => {
	// Verify it uses the correct userId and itemId
	let capturedUserId = null;
	let capturedItemId = null;
	const itemService = makeItemService(async (userId, itemId) => {
		capturedUserId = userId;
		capturedItemId = itemId;
		return { id: 'note1', ownerId: userId, shareId: '' };
	});
	await assertShareWriteAccess(itemService, 'userX', 'noteY');
	assert.equal(capturedUserId, 'userX');
	assert.equal(capturedItemId, 'noteY');
});

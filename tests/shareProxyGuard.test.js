'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const { inspectAndGuard, BUFFER_CAP_BYTES } = require('../app/proxy/shareProxyGuard');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner000000000000000000000000001';
const READER_ID = 'reader000000000000000000000000001';
const NOTE_ID = 'note0000000000000000000000000001';
const SHARED_NOTE_ID = 'shnote00000000000000000000000001';
const NON_SHARED_NOTE_ID = 'nsnote00000000000000000000000001';

/** Make a fake Node.js IncomingMessage-like object from a Buffer */
const makeRequest = (method, pathname, buffer, extraHeaders = {}) => {
	const readable = Readable.from(buffer !== null ? [buffer] : []);
	readable.method = method;
	readable.url = pathname;
	readable.headers = { 'content-type': 'application/octet-stream', ...extraHeaders };
	return readable;
};

/** Minimal mock context for shareProxyGuard tests */
const makeCtx = (overrides = {}) => ({
	itemService: {
		async noteByUserIdAndJopId(userId, noteId, _opts) {
			if (noteId === SHARED_NOTE_ID) {
				// Shared note owned by OWNER_ID
				return { id: SHARED_NOTE_ID, ownerId: OWNER_ID, shareId: 'share1' };
			}
			if (noteId === NON_SHARED_NOTE_ID) {
				// Non-shared note, owned by whoever looks at it
				return { id: NON_SHARED_NOTE_ID, ownerId: userId, shareId: '', isShared: false };
			}
			if (noteId === NOTE_ID) {
				return { id: NOTE_ID, ownerId: userId, shareId: '', isShared: false };
			}
			return null;
		},
		async folderByUserIdAndJopId() {
			return null;
		},
		...overrides.itemService,
	},
	authenticatedUser: overrides.authUserFn || (async (_req) => ({ user: { id: OWNER_ID } })),
	log: overrides.log || (() => {}),
});

// ---------------------------------------------------------------------------
// DELETE /api/items/root:/<id>.md: — single note delete
// ---------------------------------------------------------------------------

test('shareProxyGuard: DELETE non-shared note → allow (stream through)', async () => {
	const req = makeRequest('DELETE', `/api/items/root:/${NON_SHARED_NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${NON_SHARED_NOTE_ID}.md:`, makeCtx());
	assert.equal(result.action, 'allow');
	assert.equal(result.buffer, null);
});

test('shareProxyGuard: DELETE shared note by owner → allow', async () => {
	const req = makeRequest('DELETE', `/api/items/root:/${SHARED_NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${SHARED_NOTE_ID}.md:`, makeCtx());
	assert.equal(result.action, 'allow');
	assert.equal(result.buffer, null);
});

test('shareProxyGuard: DELETE shared note by non-owner → reject 403', async () => {
	const ctx = makeCtx({
		authUserFn: async () => ({ user: { id: READER_ID } }),
	});
	const req = makeRequest('DELETE', `/api/items/root:/${SHARED_NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${SHARED_NOTE_ID}.md:`, ctx);
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
	assert.match(result.message, /Only the owner can delete this item/);
});

test('shareProxyGuard: DELETE non-existent note → allow (stream through)', async () => {
	const ctx = makeCtx({
		itemService: {
			async noteByUserIdAndJopId() { return null; },
			async folderByUserIdAndJopId() { return null; },
		},
	});
	const req = makeRequest('DELETE', `/api/items/root:/nonexistentnote00000000001.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/nonexistentnote00000000001.md:`, ctx);
	assert.equal(result.action, 'allow');
});

test('shareProxyGuard: DELETE path without note id → allow', async () => {
	// path that doesn't match the note id regex (noteIdFromItemPath returns null)
	const req = makeRequest('DELETE', '/api/items/root:/something.md:', null);
	const result = await inspectAndGuard(req, '/api/items/root:/something.md:', makeCtx());
	assert.equal(result.action, 'allow');
});

// ---------------------------------------------------------------------------
// DELETE /api/batch_items — batch note deletes
// ---------------------------------------------------------------------------

test('shareProxyGuard: batch DELETE with shared non-owned note → reject 403', async () => {
	const ctx = makeCtx({
		authUserFn: async () => ({ user: { id: READER_ID } }),
	});
	const batchBody = JSON.stringify({
		items: [`root:/${SHARED_NOTE_ID}.md:`, `root:/${NON_SHARED_NOTE_ID}.md:`],
	});
	const req = makeRequest('DELETE', '/api/batch_items', Buffer.from(batchBody, 'utf8'));
	const result = await inspectAndGuard(req, '/api/batch_items', ctx);
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
});

test('shareProxyGuard: batch DELETE all allowed → allow', async () => {
	const ctx = makeCtx({
		authUserFn: async () => ({ user: { id: OWNER_ID } }),
	});
	const batchBody = JSON.stringify({
		items: [`root:/${SHARED_NOTE_ID}.md:`, `root:/${NON_SHARED_NOTE_ID}.md:`],
	});
	const req = makeRequest('DELETE', '/api/batch_items', Buffer.from(batchBody, 'utf8'));
	const result = await inspectAndGuard(req, '/api/batch_items', ctx);
	assert.equal(result.action, 'allow');
});

test('shareProxyGuard: batch DELETE with invalid JSON → allow', async () => {
	const ctx = makeCtx({
		authUserFn: async () => ({ user: { id: READER_ID } }),
	});
	const req = makeRequest('DELETE', '/api/batch_items', Buffer.from('not json', 'utf8'));
	const result = await inspectAndGuard(req, '/api/batch_items', ctx);
	assert.equal(result.action, 'allow');
});

test('shareProxyGuard: batch DELETE with non-array items → allow', async () => {
	const ctx = makeCtx({
		authUserFn: async () => ({ user: { id: READER_ID } }),
	});
	const req = makeRequest('DELETE', '/api/batch_items', Buffer.from(JSON.stringify({ items: 'not-array' }), 'utf8'));
	const result = await inspectAndGuard(req, '/api/batch_items', ctx);
	assert.equal(result.action, 'allow');
});

// ---------------------------------------------------------------------------
// No authentication → stream through
// ---------------------------------------------------------------------------

test('shareProxyGuard: DELETE without authenticated user → stream', async () => {
	const ctx = makeCtx({
		authUserFn: async () => null, // no user
	});
	const req = makeRequest('DELETE', `/api/items/root:/${SHARED_NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${SHARED_NOTE_ID}.md:`, ctx);
	assert.equal(result.action, 'stream');
});

test('shareProxyGuard: DELETE with auth throwing → stream', async () => {
	const ctx = makeCtx({
		authUserFn: async () => { throw new Error('auth error'); },
	});
	const req = makeRequest('DELETE', `/api/items/root:/${SHARED_NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${SHARED_NOTE_ID}.md:`, ctx);
	assert.equal(result.action, 'stream');
});

// ---------------------------------------------------------------------------
// GET requests → stream through
// ---------------------------------------------------------------------------

test('shareProxyGuard: GET non-intercepted path → stream', async () => {
	const req = makeRequest('GET', `/api/items/root:/${NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:`, makeCtx());
	assert.equal(result.action, 'stream');
});

// ---------------------------------------------------------------------------
// BUFFER_CAP_BYTES export
// ---------------------------------------------------------------------------

test('shareProxyGuard: exports BUFFER_CAP_BYTES', () => {
	assert.equal(BUFFER_CAP_BYTES, 10 * 1024 * 1024);
});

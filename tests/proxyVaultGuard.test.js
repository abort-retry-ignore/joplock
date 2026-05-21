'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');

const {
	shouldInspect,
	parseJoplinItem,
	noteIdFromItemPath,
	bufferRequest,
	extractMultipartFile,
	inspectAndGuard,
	BUFFER_CAP_BYTES,
	MODEL_TYPE_NOTE,
} = require('../app/proxy/vaultProxyGuard');

const { serializeNote, serializeFolder } = require('../app/items/itemWriteService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VAULT_FOLDER_ID = 'vaultfolder000000000000000000001';
const NOTE_ID = 'note0000000000000000000000000001';
const NON_VAULT_FOLDER_ID = 'normalfolder00000000000000000001';
const USER_ID = 'user0000000000000000000000000001';

const ENCRYPTED_MARKER = '<!--joplock-encrypted-start-->';
const ENCRYPTED_BODY = `> **This note is encrypted**\n\n${ENCRYPTED_MARKER}\n{"joplock_encrypted":1,"v":2}\n<!--joplock-encrypted-end-->`;

/** Build a minimal multipart/form-data buffer with a single `file` field */
const buildMultipartBuffer = (fieldName, content, boundary = 'TESTBOUNDARY') => {
	const contentBuffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
	const header =
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="${fieldName}"; filename="upload.md"\r\n` +
		`Content-Type: text/plain\r\n` +
		`\r\n`;
	const footer = `\r\n--${boundary}--\r\n`;
	return {
		buffer: Buffer.concat([Buffer.from(header), contentBuffer, Buffer.from(footer)]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
};

/** Make a fake Node.js IncomingMessage-like object from a Buffer */
const makeRequest = (method, pathname, buffer, extraHeaders = {}) => {
	const readable = Readable.from(buffer !== null ? [buffer] : []);
	readable.method = method;
	readable.url = pathname;
	readable.headers = { 'content-type': 'application/octet-stream', ...extraHeaders };
	return readable;
};

/** Minimal mock vaultService: treats VAULT_FOLDER_ID as vault */
const makeVaultService = ({ vaultFolderIds = [VAULT_FOLDER_ID] } = {}) => ({
	async getVaultByFolderId(_userId, folderId) {
		if (vaultFolderIds.includes(folderId)) return { folderId };
		return null;
	},
});

/** Minimal mock itemService: knows one existing note in a vault */
const makeItemService = ({ existingNoteParentId = VAULT_FOLDER_ID } = {}) => ({
	async noteByUserIdAndJopId(_userId, noteId) {
		if (noteId === NOTE_ID) return { id: NOTE_ID, parentId: existingNoteParentId };
		return null;
	},
});

const makeCtx = (overrides = {}) => ({
	vaultService: makeVaultService(),
	itemService: makeItemService(),
	authenticatedUser: async () => ({ user: { id: USER_ID } }),
	log: () => {},
	...overrides,
});

// ---------------------------------------------------------------------------
// shouldInspect
// ---------------------------------------------------------------------------

test('shouldInspect: single note PUT /content returns true', () => {
	assert.ok(shouldInspect('PUT', `/api/items/root:/${NOTE_ID}.md:/content`));
});

test('shouldInspect: batch PUT returns true', () => {
	assert.ok(shouldInspect('PUT', '/api/batch_items'));
});

test('shouldInspect: single note DELETE returns true', () => {
	assert.ok(shouldInspect('DELETE', `/api/items/root:/${NOTE_ID}.md:`));
});

test('shouldInspect: batch DELETE returns true', () => {
	assert.ok(shouldInspect('DELETE', '/api/batch_items'));
});

test('shouldInspect: GET does not intercept', () => {
	assert.ok(!shouldInspect('GET', `/api/items/root:/${NOTE_ID}.md:`));
});

test('shouldInspect: resource blob PUT does not intercept', () => {
	assert.ok(!shouldInspect('PUT', `/api/items/root:/.resource/${NOTE_ID}:/content`));
});

test('shouldInspect: delta GET does not intercept', () => {
	assert.ok(!shouldInspect('GET', '/api/items/root:/delta'));
});

// ---------------------------------------------------------------------------
// noteIdFromItemPath
// ---------------------------------------------------------------------------

test('noteIdFromItemPath: extracts uuid from single content path', () => {
	assert.equal(noteIdFromItemPath(`root:/${NOTE_ID}.md:/content`), NOTE_ID);
});

test('noteIdFromItemPath: extracts uuid from batch item name', () => {
	assert.equal(noteIdFromItemPath(`root:/${NOTE_ID}.md:`), NOTE_ID);
});

test('noteIdFromItemPath: returns null for resource path', () => {
	assert.equal(noteIdFromItemPath(`root:/.resource/${NOTE_ID}:`), null);
});

// ---------------------------------------------------------------------------
// parseJoplinItem — round-trips with serializeNote / serializeFolder
// ---------------------------------------------------------------------------

test('parseJoplinItem: round-trips a serialized note', () => {
	const note = serializeNote({
		id: NOTE_ID,
		title: 'My Note',
		body: 'Some content\nwith multiple lines',
		parentId: VAULT_FOLDER_ID,
	});
	const parsed = parseJoplinItem(note.body);
	assert.ok(parsed, 'should parse successfully');
	assert.equal(parsed.title, 'My Note');
	assert.ok(parsed.body.includes('Some content'), 'body should include content');
	assert.equal(parsed.meta.type_, '1');
	assert.equal(parsed.meta.parent_id, VAULT_FOLDER_ID);
	assert.equal(parsed.meta.id, NOTE_ID);
});

test('parseJoplinItem: round-trips a serialized folder (type_ 2)', () => {
	const folder = serializeFolder({
		id: VAULT_FOLDER_ID,
		title: 'Vault',
		parentId: '',
	});
	const parsed = parseJoplinItem(folder.body);
	assert.ok(parsed);
	assert.equal(parsed.meta.type_, '2');
});

test('parseJoplinItem: returns null for empty string', () => {
	assert.equal(parseJoplinItem(''), null);
});

test('parseJoplinItem: handles encrypted body without corruption', () => {
	const note = serializeNote({
		id: NOTE_ID,
		title: 'Encrypted Note',
		body: ENCRYPTED_BODY,
		parentId: VAULT_FOLDER_ID,
	});
	const parsed = parseJoplinItem(note.body);
	assert.ok(parsed);
	assert.ok(parsed.body.includes(ENCRYPTED_MARKER), 'encrypted marker must survive round-trip');
});

// ---------------------------------------------------------------------------
// extractMultipartFile
// ---------------------------------------------------------------------------

test('extractMultipartFile: extracts file field from multipart', () => {
	const content = 'hello world content';
	const { buffer, contentType } = buildMultipartBuffer('file', content);
	const result = extractMultipartFile(buffer, contentType);
	assert.ok(result);
	assert.equal(result.toString('utf8'), content);
});

test('extractMultipartFile: returns null when boundary missing', () => {
	const result = extractMultipartFile(Buffer.from('data'), 'application/octet-stream');
	assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// inspectAndGuard: non-intercepted paths
// ---------------------------------------------------------------------------

test('inspectAndGuard: GET returns stream', async () => {
	const req = makeRequest('GET', `/api/items/root:/${NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:`, makeCtx());
	assert.equal(result.action, 'stream');
});

test('inspectAndGuard: unauthenticated request returns stream (let upstream 401)', async () => {
	const itemText = serializeNote({ id: NOTE_ID, title: 'T', body: 'B', parentId: VAULT_FOLDER_ID }).body;
	const { buffer, contentType } = buildMultipartBuffer('file', itemText);
	const req = makeRequest('PUT', `/api/items/root:/${NOTE_ID}.md:/content`, buffer, { 'content-type': contentType });
	const ctx = makeCtx({
		authenticatedUser: async () => ({ user: null, error: 'no session' }),
	});
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:/content`, ctx);
	assert.equal(result.action, 'stream');
});

// ---------------------------------------------------------------------------
// inspectAndGuard: single PUT — note write
// ---------------------------------------------------------------------------

test('inspectAndGuard: single PUT non-vault note is allowed', async () => {
	const note = serializeNote({ id: NOTE_ID, title: 'T', body: 'plaintext', parentId: NON_VAULT_FOLDER_ID });
	const { buffer, contentType } = buildMultipartBuffer('file', note.body);
	const req = makeRequest('PUT', `/api/items/root:/${NOTE_ID}.md:/content`, buffer, { 'content-type': contentType });
	const ctx = makeCtx({
		itemService: makeItemService({ existingNoteParentId: NON_VAULT_FOLDER_ID }),
	});
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:/content`, ctx);
	assert.equal(result.action, 'allow');
});

test('inspectAndGuard: single PUT vault note with encrypted body is allowed', async () => {
	const note = serializeNote({ id: NOTE_ID, title: 'T', body: ENCRYPTED_BODY, parentId: VAULT_FOLDER_ID });
	const { buffer, contentType } = buildMultipartBuffer('file', note.body);
	const req = makeRequest('PUT', `/api/items/root:/${NOTE_ID}.md:/content`, buffer, { 'content-type': contentType });
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:/content`, makeCtx());
	assert.equal(result.action, 'allow');
});

test('inspectAndGuard: single PUT vault note with plaintext body is rejected (403)', async () => {
	const note = serializeNote({ id: NOTE_ID, title: 'T', body: 'plain text leak!', parentId: VAULT_FOLDER_ID });
	const { buffer, contentType } = buildMultipartBuffer('file', note.body);
	const req = makeRequest('PUT', `/api/items/root:/${NOTE_ID}.md:/content`, buffer, { 'content-type': contentType });
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:/content`, makeCtx());
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
});

test('inspectAndGuard: single PUT moving vault note to non-vault with plaintext is rejected', async () => {
	// Note currently in vault (existingNote.parentId = VAULT_FOLDER_ID),
	// being moved to non-vault (parsed parent_id = NON_VAULT_FOLDER_ID),
	// body is plaintext — assertVaultNoteBodyEncrypted checks existingParent.
	const note = serializeNote({ id: NOTE_ID, title: 'T', body: 'plain', parentId: NON_VAULT_FOLDER_ID });
	const { buffer, contentType } = buildMultipartBuffer('file', note.body);
	const req = makeRequest('PUT', `/api/items/root:/${NOTE_ID}.md:/content`, buffer, { 'content-type': contentType });
	// existing note is in vault
	const ctx = makeCtx({ itemService: makeItemService({ existingNoteParentId: VAULT_FOLDER_ID }) });
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:/content`, ctx);
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
});

test('inspectAndGuard: single PUT folder item (type_ 2) is allowed without vault check', async () => {
	const folder = serializeFolder({ id: VAULT_FOLDER_ID, title: 'Vault', parentId: '' });
	const { buffer, contentType } = buildMultipartBuffer('file', folder.body);
	const req = makeRequest('PUT', `/api/items/root:/${VAULT_FOLDER_ID}.md:/content`, buffer, { 'content-type': contentType });
	const result = await inspectAndGuard(req, `/api/items/root:/${VAULT_FOLDER_ID}.md:/content`, makeCtx());
	assert.equal(result.action, 'allow');
});

test('inspectAndGuard: single PUT body over cap streams through without inspection', async () => {
	// Build a request stream that exceeds BUFFER_CAP_BYTES
	const bigChunk = Buffer.alloc(BUFFER_CAP_BYTES + 1, 0x41);
	const boundary = 'BIGBOUNDARY';
	const header = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.md"\r\nContent-Type: text/plain\r\n\r\n`,
	);
	const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
	const bigBuffer = Buffer.concat([header, bigChunk, footer]);
	const req = makeRequest('PUT', `/api/items/root:/${NOTE_ID}.md:/content`, bigBuffer, {
		'content-type': `multipart/form-data; boundary=${boundary}`,
	});
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:/content`, makeCtx());
	assert.equal(result.action, 'stream');
});

// ---------------------------------------------------------------------------
// inspectAndGuard: batch PUT
// ---------------------------------------------------------------------------

test('inspectAndGuard: batch PUT vault note with encrypted body is allowed', async () => {
	const note = serializeNote({ id: NOTE_ID, title: 'T', body: ENCRYPTED_BODY, parentId: VAULT_FOLDER_ID });
	const batchBody = JSON.stringify({ items: [{ name: `root:/${NOTE_ID}.md:`, body: note.body }] });
	const buffer = Buffer.from(batchBody);
	const req = makeRequest('PUT', '/api/batch_items', buffer, { 'content-type': 'application/json' });
	const result = await inspectAndGuard(req, '/api/batch_items', makeCtx());
	assert.equal(result.action, 'allow');
});

test('inspectAndGuard: batch PUT vault note with plaintext body is rejected', async () => {
	const note = serializeNote({ id: NOTE_ID, title: 'T', body: 'plaintext leak!', parentId: VAULT_FOLDER_ID });
	const batchBody = JSON.stringify({ items: [{ name: `root:/${NOTE_ID}.md:`, body: note.body }] });
	const buffer = Buffer.from(batchBody);
	const req = makeRequest('PUT', '/api/batch_items', buffer, { 'content-type': 'application/json' });
	const result = await inspectAndGuard(req, '/api/batch_items', makeCtx());
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
});

test('inspectAndGuard: batch PUT non-note items (folder) are allowed', async () => {
	const folder = serializeFolder({ id: VAULT_FOLDER_ID, title: 'Vault', parentId: '' });
	const batchBody = JSON.stringify({ items: [{ name: `root:/${VAULT_FOLDER_ID}.md:`, body: folder.body }] });
	const buffer = Buffer.from(batchBody);
	const req = makeRequest('PUT', '/api/batch_items', buffer, { 'content-type': 'application/json' });
	const result = await inspectAndGuard(req, '/api/batch_items', makeCtx());
	assert.equal(result.action, 'allow');
});

test('inspectAndGuard: batch PUT with mixed items rejects if any vault note is plaintext', async () => {
	const safeNote = serializeNote({ id: 'safenote00000000000000000000001', title: 'S', body: 'safe', parentId: NON_VAULT_FOLDER_ID });
	const vaultNote = serializeNote({ id: NOTE_ID, title: 'V', body: 'plaintext!', parentId: VAULT_FOLDER_ID });
	const batchBody = JSON.stringify({
		items: [
			{ name: `root:/safenote00000000000000000000001.md:`, body: safeNote.body },
			{ name: `root:/${NOTE_ID}.md:`, body: vaultNote.body },
		],
	});
	const buffer = Buffer.from(batchBody);
	const req = makeRequest('PUT', '/api/batch_items', buffer, { 'content-type': 'application/json' });
	const ctx = makeCtx({
		itemService: {
			async noteByUserIdAndJopId(_uid, noteId) {
				if (noteId === NOTE_ID) return { id: NOTE_ID, parentId: VAULT_FOLDER_ID };
				return null;
			},
		},
	});
	const result = await inspectAndGuard(req, '/api/batch_items', ctx);
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
});

// ---------------------------------------------------------------------------
// inspectAndGuard: DELETE — single
// ---------------------------------------------------------------------------

test('inspectAndGuard: single DELETE non-vault note is allowed', async () => {
	const req = makeRequest('DELETE', `/api/items/root:/${NOTE_ID}.md:`, null);
	const ctx = makeCtx({
		itemService: makeItemService({ existingNoteParentId: NON_VAULT_FOLDER_ID }),
	});
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:`, ctx);
	assert.equal(result.action, 'allow');
});

test('inspectAndGuard: single DELETE vault note is rejected (403)', async () => {
	const req = makeRequest('DELETE', `/api/items/root:/${NOTE_ID}.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/${NOTE_ID}.md:`, makeCtx());
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
});

test('inspectAndGuard: single DELETE unknown note (not in DB) is allowed', async () => {
	const req = makeRequest('DELETE', `/api/items/root:/unknownnote.md:`, null);
	const result = await inspectAndGuard(req, `/api/items/root:/unknownnote.md:`, makeCtx());
	assert.equal(result.action, 'allow');
});

// ---------------------------------------------------------------------------
// inspectAndGuard: DELETE — batch
// ---------------------------------------------------------------------------

test('inspectAndGuard: batch DELETE vault note is rejected', async () => {
	const batchBody = JSON.stringify({ items: [`root:/${NOTE_ID}.md:`] });
	const buffer = Buffer.from(batchBody);
	const req = makeRequest('DELETE', '/api/batch_items', buffer, { 'content-type': 'application/json' });
	const result = await inspectAndGuard(req, '/api/batch_items', makeCtx());
	assert.equal(result.action, 'reject');
	assert.equal(result.status, 403);
});

test('inspectAndGuard: batch DELETE non-vault note is allowed', async () => {
	const batchBody = JSON.stringify({ items: [`root:/${NOTE_ID}.md:`] });
	const buffer = Buffer.from(batchBody);
	const req = makeRequest('DELETE', '/api/batch_items', buffer, { 'content-type': 'application/json' });
	const ctx = makeCtx({
		itemService: makeItemService({ existingNoteParentId: NON_VAULT_FOLDER_ID }),
	});
	const result = await inspectAndGuard(req, '/api/batch_items', ctx);
	assert.equal(result.action, 'allow');
});

test('inspectAndGuard: batch DELETE resource path items are allowed (not notes)', async () => {
	const batchBody = JSON.stringify({ items: [`root:/.resource/${NOTE_ID}:`] });
	const buffer = Buffer.from(batchBody);
	const req = makeRequest('DELETE', '/api/batch_items', buffer, { 'content-type': 'application/json' });
	const result = await inspectAndGuard(req, '/api/batch_items', makeCtx());
	assert.equal(result.action, 'allow');
});

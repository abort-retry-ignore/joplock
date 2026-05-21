'use strict';

/**
 * vaultProxyGuard.js
 *
 * Pre-proxy interception layer that prevents the Joplin Server sync proxy from
 * being used to overwrite vault notes with plaintext or delete vault note
 * ciphertext.
 *
 * Covered attack surfaces:
 *  - PUT  /api/items/root:/<id>.md:/content   (single note write, multipart)
 *  - PUT  /api/batch_items                    (batch write, JSON)
 *  - DELETE /api/items/root:/<id>.md:         (single note delete)
 *  - DELETE /api/batch_items                  (batch delete, JSON)
 *
 * Items that are not Note type (type_ != 1) are allowed through without vault
 * checks (folders, resources, resource blobs).
 *
 * When the request body exceeds BUFFER_CAP_BYTES, it is streamed through
 * without inspection (documented limitation; no normal note body reaches
 * this size).
 */

const { isEncryptedBody } = require('../items/itemService');
const { assertVaultNoteBodyEncrypted } = require('../routes/_helpers');

// Item type constants (mirrors Joplin's ModelType enum)
const MODEL_TYPE_NOTE = 1;

// 10 MB — well above any realistic note body; protects streaming performance
// for resource blob writes that share the same proxy path.
const BUFFER_CAP_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// URL pattern helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the given method + pathname should be intercepted for
 * vault enforcement.
 *
 * joplinPublicBasePath is stripped from pathname before this call.
 */
const shouldInspect = (method, strippedPathname) => {
	const m = method.toUpperCase();
	const p = strippedPathname;

	if (m === 'PUT') {
		// Single note content write: /api/items/root:/<uuid>.md:/content
		if (/^\/api\/items\/root:\/[^/]+\.md:\/content$/.test(p)) return true;
		// Batch write: /api/batch_items
		if (p === '/api/batch_items') return true;
	}

	if (m === 'DELETE') {
		// Single note delete: /api/items/root:/<uuid>.md:
		if (/^\/api\/items\/root:\/[^/]+\.md:$/.test(p)) return true;
		// Batch delete: /api/batch_items
		if (p === '/api/batch_items') return true;
	}

	return false;
};

/**
 * Extracts the note UUID from item name/path strings such as:
 *   "root:/<uuid>.md:"
 *   "/api/items/root:/<uuid>.md:"
 *   "/api/items/root:/<uuid>.md:/content"
 * Returns null if not a note item path.
 */
const noteIdFromItemPath = str => {
	const m = `${str || ''}`.match(/root:\/([^/]+)\.md:/);
	if (!m) return null;
	return m[1];
};

// ---------------------------------------------------------------------------
// Joplin item .md format parser
// ---------------------------------------------------------------------------

/**
 * Parses a Joplin serialized item (the .md text format).
 *
 * Format (from itemWriteService.serializeNote):
 *   <title>
 *
 *   <body>
 *
 *   key: value
 *   ...
 *   type_: 1
 *
 * Returns { title, body, meta } where meta is a key→value map of the trailing
 * metadata block.  Returns null if the text cannot be parsed.
 */
const parseJoplinItem = text => {
	if (typeof text !== 'string' || !text.trim()) return null;

	// The metadata block is the contiguous run of "key: value" lines at the
	// end of the document.  We walk backwards to find it.
	const lines = text.split('\n');
	const metaKeyRe = /^([a-z_][a-z0-9_]*): (.*)$/;

	let metaEnd = lines.length - 1;
	// Trim trailing blank lines
	while (metaEnd >= 0 && lines[metaEnd].trim() === '') metaEnd--;

	let metaStart = metaEnd;
	while (metaStart > 0 && metaKeyRe.test(lines[metaStart - 1])) metaStart--;

	// Must have at least one meta line (type_ at minimum)
	if (metaStart > metaEnd) return null;

	const meta = {};
	for (let i = metaStart; i <= metaEnd; i++) {
		const match = lines[i].match(metaKeyRe);
		if (match) meta[match[1]] = match[2];
	}

	// Everything above the meta block is title + blank line + body
	const preMetaLines = lines.slice(0, metaStart);
	// Remove the trailing blank line that separates body from meta
	while (preMetaLines.length && preMetaLines[preMetaLines.length - 1].trim() === '') {
		preMetaLines.pop();
	}

	const title = preMetaLines[0] || '';
	// Body is everything after the first line and the blank separator
	const bodyLines = preMetaLines.slice(1);
	// Drop the leading blank line separator between title and body
	if (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
	const body = bodyLines.join('\n');

	return { title, body, meta };
};

// ---------------------------------------------------------------------------
// Body buffering
// ---------------------------------------------------------------------------

/**
 * Buffers the request stream up to capBytes.
 * Resolves { buffer, overCap: false } on success.
 * Resolves { buffer: null, overCap: true } when cap is exceeded.
 */
const bufferRequest = (request, capBytes = BUFFER_CAP_BYTES) => {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		let capped = false;

		request.on('data', chunk => {
			if (capped) return;
			total += chunk.length;
			if (total > capBytes) {
				capped = true;
				resolve({ buffer: null, overCap: true });
				return;
			}
			chunks.push(chunk);
		});

		request.on('end', () => {
			if (!capped) resolve({ buffer: Buffer.concat(chunks), overCap: false });
		});

		request.on('error', reject);
	});
};

// ---------------------------------------------------------------------------
// Multipart file field extractor
// ---------------------------------------------------------------------------

/**
 * Extracts the value of the first `file` field from a multipart body.
 * Returns the raw bytes as a Buffer, or null if not found.
 *
 * Joplin single-item PUT sends the .md content as a multipart file field
 * named "file".
 */
const extractMultipartFile = (buffer, contentType) => {
	const match = (contentType || '').match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!match) return null;
	const boundary = match[1] || match[2];
	const boundaryBuf = Buffer.from(`--${boundary}`);

	let pos = buffer.indexOf(boundaryBuf);
	while (pos !== -1) {
		const afterBoundary = pos + boundaryBuf.length;
		// Skip \r\n after boundary marker
		const headerStart = buffer[afterBoundary] === 0x0d && buffer[afterBoundary + 1] === 0x0a
			? afterBoundary + 2 : afterBoundary;

		const headerEnd = buffer.indexOf('\r\n\r\n', headerStart);
		if (headerEnd === -1) break;

		const headerStr = buffer.slice(headerStart, headerEnd).toString('utf8');
		const nameMatch = headerStr.match(/name="([^"]+)"/);
		const fieldName = nameMatch ? nameMatch[1] : '';

		const bodyStart = headerEnd + 4;
		const nextBoundary = buffer.indexOf(boundaryBuf, bodyStart);
		const bodyEnd = nextBoundary !== -1 ? nextBoundary - 2 : buffer.length;

		if (fieldName === 'file') {
			return buffer.slice(bodyStart, bodyEnd);
		}

		pos = nextBoundary;
	}

	return null;
};

// ---------------------------------------------------------------------------
// Vault enforcement logic per-item
// ---------------------------------------------------------------------------

/**
 * For a single note write, verifies that the body is encrypted when the note
 * is in (or being moved to) a vault folder.
 *
 * existingNoteId: the note UUID (already exists in DB — may be null for
 *                 brand-new notes being synced for the first time)
 * parsedParentId: parent_id from the serialized item
 * itemBody:       the plaintext portion of the serialized item (note content)
 *
 * Throws with statusCode=403 if vault enforcement fails.
 */
const enforceNoteWrite = async ({ vaultService, itemService, userId, existingNoteId, parsedParentId, itemBody }) => {
	// Determine the existing parent (if note already exists in DB)
	let existingParentId = null;
	if (existingNoteId) {
		const existingNote = await itemService.noteByUserIdAndJopId(userId, existingNoteId).catch(() => null);
		existingParentId = existingNote ? existingNote.parentId : null;
	}

	// assertVaultNoteBodyEncrypted checks both existing and target parent.
	// We override the error statusCode to 403.
	try {
		await assertVaultNoteBodyEncrypted(
			vaultService, userId,
			existingParentId,
			parsedParentId !== undefined ? parsedParentId : existingParentId,
			itemBody,
		);
	} catch (err) {
		if (err.statusCode === 400) {
			err.statusCode = 403;
			err.message = 'Vault notes must be saved encrypted. The Joplin sync client cannot overwrite vault note ciphertext with plaintext.';
		}
		throw err;
	}
};

/**
 * For a single note delete, verifies that the note is not inside a vault.
 * Throws with statusCode=403 if vault enforcement fails.
 */
const enforceNoteDelete = async ({ vaultService, itemService, userId, noteId }) => {
	if (!vaultService || !userId || !noteId) return;

	const existingNote = await itemService.noteByUserIdAndJopId(userId, noteId).catch(() => null);
	if (!existingNote) return; // note doesn't exist (already gone) — allow

	const parentId = existingNote.parentId;
	if (!parentId) return;

	const vault = await vaultService.getVaultByFolderId(userId, parentId).catch(() => null);
	if (vault) {
		const err = new Error('Vault notes cannot be deleted via the sync proxy. Use the Joplock UI to trash vault notes.');
		err.statusCode = 403;
		throw err;
	}
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main guard entry point, called from the proxy handler in createServer.js.
 *
 * Returns one of:
 *  { action: 'allow', buffer }   — forward buffer to upstream (buffer may be
 *                                   null for DELETE/stream-through cases)
 *  { action: 'stream' }          — stream original request through unchanged
 *                                   (body not consumed; only used when not
 *                                   intercepted or body overCap)
 *  { action: 'reject', status, message } — send error response, do not proxy
 *
 * ctx must contain: vaultService, itemService, authenticatedUser, log
 * request: the Node.js IncomingMessage
 * strippedPathname: the request pathname with joplinPublicBasePath removed
 */
const inspectAndGuard = async (request, strippedPathname, ctx) => {
	const { vaultService, itemService, authenticatedUser, log } = ctx;
	const method = request.method.toUpperCase();

	if (!shouldInspect(method, strippedPathname)) {
		return { action: 'stream' };
	}

	// Resolve user from session cookie.
	// If auth fails, let the upstream handle it (don't consume the body).
	let userId;
	try {
		const auth = await authenticatedUser(request, { isHeartbeat: true });
		if (!auth || !auth.user) {
			// Unknown user — stream through; upstream will 401.
			return { action: 'stream' };
		}
		userId = auth.user.id;
	} catch {
		return { action: 'stream' };
	}

	// DELETE /api/items/root:/<id>.md: — single note delete
	if (method === 'DELETE' && /^\/api\/items\/root:\/[^/]+\.md:$/.test(strippedPathname)) {
		const noteId = noteIdFromItemPath(strippedPathname);
		try {
			await enforceNoteDelete({ vaultService, itemService, userId, noteId });
		} catch (err) {
			log(`vault proxy guard: blocked DELETE ${strippedPathname} — ${err.message}`);
			return { action: 'reject', status: err.statusCode || 403, message: err.message };
		}
		// No body to replay for DELETE
		return { action: 'allow', buffer: null };
	}

	// DELETE /api/batch_items — batch note deletes
	if (method === 'DELETE' && strippedPathname === '/api/batch_items') {
		const { buffer, overCap } = await bufferRequest(request);
		if (overCap) {
			log('vault proxy guard: batch DELETE body over cap — streaming without inspection');
			return { action: 'stream' };
		}

		let items;
		try {
			const parsed = JSON.parse(buffer.toString('utf8'));
			items = Array.isArray(parsed.items) ? parsed.items : [];
		} catch {
			// Malformed JSON — let upstream handle it
			return { action: 'allow', buffer };
		}

		for (const itemName of items) {
			const noteId = noteIdFromItemPath(itemName);
			if (!noteId) continue; // not a note — skip
			try {
				await enforceNoteDelete({ vaultService, itemService, userId, noteId });
			} catch (err) {
				log(`vault proxy guard: blocked batch DELETE item ${itemName} — ${err.message}`);
				return { action: 'reject', status: err.statusCode || 403, message: err.message };
			}
		}

		return { action: 'allow', buffer };
	}

	// PUT /api/items/root:/<id>.md:/content — single note write (multipart)
	if (method === 'PUT' && /^\/api\/items\/root:\/[^/]+\.md:\/content$/.test(strippedPathname)) {
		const { buffer, overCap } = await bufferRequest(request);
		if (overCap) {
			log('vault proxy guard: single PUT body over cap — streaming without inspection');
			return { action: 'stream' };
		}

		const contentType = request.headers['content-type'] || '';
		const fileData = extractMultipartFile(buffer, contentType);
		if (!fileData) {
			// Can't parse — let upstream handle it
			return { action: 'allow', buffer };
		}

		const itemText = fileData.toString('utf8');
		const parsed = parseJoplinItem(itemText);
		if (!parsed) {
			return { action: 'allow', buffer };
		}

		const typeNum = parseInt(parsed.meta.type_ || '0', 10);
		if (typeNum !== MODEL_TYPE_NOTE) {
			// Not a note (folder, resource, etc.) — allow without vault check
			return { action: 'allow', buffer };
		}

		const noteId = parsed.meta.id || noteIdFromItemPath(strippedPathname);
		const parsedParentId = parsed.meta.parent_id || null;

		try {
			await enforceNoteWrite({
				vaultService, itemService, userId,
				existingNoteId: noteId,
				parsedParentId,
				itemBody: parsed.body,
			});
		} catch (err) {
			log(`vault proxy guard: blocked PUT ${strippedPathname} — ${err.message}`);
			return { action: 'reject', status: err.statusCode || 403, message: err.message };
		}

		return { action: 'allow', buffer };
	}

	// PUT /api/batch_items — batch note writes (JSON)
	if (method === 'PUT' && strippedPathname === '/api/batch_items') {
		const { buffer, overCap } = await bufferRequest(request);
		if (overCap) {
			log('vault proxy guard: batch PUT body over cap — streaming without inspection');
			return { action: 'stream' };
		}

		let batchItems;
		try {
			const parsed = JSON.parse(buffer.toString('utf8'));
			batchItems = Array.isArray(parsed.items) ? parsed.items : [];
		} catch {
			return { action: 'allow', buffer };
		}

		for (const batchItem of batchItems) {
			const noteId = noteIdFromItemPath(batchItem.name || '');
			if (!noteId) continue; // not a note path

			const itemText = typeof batchItem.body === 'string' ? batchItem.body : '';
			const parsed = parseJoplinItem(itemText);
			if (!parsed) continue;

			const typeNum = parseInt(parsed.meta.type_ || '0', 10);
			if (typeNum !== MODEL_TYPE_NOTE) continue;

			const parsedParentId = parsed.meta.parent_id || null;

			try {
				await enforceNoteWrite({
					vaultService, itemService, userId,
					existingNoteId: noteId,
					parsedParentId,
					itemBody: parsed.body,
				});
			} catch (err) {
				log(`vault proxy guard: blocked batch PUT item ${batchItem.name} — ${err.message}`);
				return { action: 'reject', status: err.statusCode || 403, message: err.message };
			}
		}

		return { action: 'allow', buffer };
	}

	// Fallback (shouldInspect returned true but no branch matched — defensive)
	return { action: 'stream' };
};

module.exports = {
	shouldInspect,
	parseJoplinItem,
	noteIdFromItemPath,
	bufferRequest,
	extractMultipartFile,
	inspectAndGuard,
	BUFFER_CAP_BYTES,
	MODEL_TYPE_NOTE,
};

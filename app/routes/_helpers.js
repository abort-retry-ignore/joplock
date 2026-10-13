'use strict';
// Static serving (serveFile) and the service worker template: docs/agents/pwa-mobile.md; vault write guard: docs/agents/vaults-and-save-safety.md

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { isEncryptedBody } = require('../items/itemService');

// ─── Content types ────────────────────────────────────────────────────────────

const contentTypes = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.woff2': 'font/woff2',
};

// ─── Response helpers ─────────────────────────────────────────────────────────

const send = (response, statusCode, body, headers = {}) => {
	response.writeHead(statusCode, headers);
	response.end(body);
};

const sendJson = (response, statusCode, body) => {
	send(response, statusCode, JSON.stringify(body), {
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
	});
};

const makeSendHtml = (request, log) => (response, statusCode, html) => {
	const acceptEncoding = (request && request.headers && request.headers['accept-encoding']) || '';
	if (acceptEncoding.includes('gzip') && html && html.length > 512) {
		zlib.gzip(Buffer.from(html), (err, compressed) => {
			if (err) {
				if (log) log(`gzip error: ${err.message}, sending uncompressed`);
				response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
				response.end(html);
			} else {
				if (log) log(`gzip ${html.length}b -> ${compressed.length}b (${Math.round((1 - compressed.length / html.length) * 100)}% reduction)`);
				response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
				response.end(compressed);
			}
		});
	} else {
		if (log && html && html.length > 512) log(`gzip skipped (no accept-encoding: gzip from client)`);
		response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
		response.end(html);
	}
};

const expiredSessionCookie = () => 'sessionId=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

const redirect = (response, location, extraHeaders = {}) => {
	response.writeHead(302, { Location: location, ...extraHeaders });
	response.end();
};

// ─── Body parsing ─────────────────────────────────────────────────────────────

const readBody = request => {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => { body += chunk; });
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});
};

const readRawBody = request => {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on('data', chunk => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
};

// Minimal multipart parser — extracts the first file field
const parseMultipart = (buffer, contentType) => {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!match) return null;
	const boundary = match[1] || match[2];
	const boundaryBuf = Buffer.from(`--${boundary}`);

	let start = buffer.indexOf(boundaryBuf);
	if (start === -1) return null;
	start += boundaryBuf.length;

	const headerEnd = buffer.indexOf('\r\n\r\n', start);
	if (headerEnd === -1) return null;
	const headerStr = buffer.slice(start, headerEnd).toString('utf8');

	const fnMatch = headerStr.match(/filename="([^"]+)"/);
	const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);
	const filename = fnMatch ? fnMatch[1] : 'upload';
	const fileMime = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';

	const bodyStart = headerEnd + 4;
	const endBoundary = buffer.indexOf(boundaryBuf, bodyStart);
	const bodyEnd = endBoundary !== -1 ? endBoundary - 2 : buffer.length;

	return { filename, mime: fileMime, data: buffer.slice(bodyStart, bodyEnd) };
};

const parseBody = async request => {
	const raw = await readBody(request);
	if (!raw) return {};
	const contentType = request.headers['content-type'] || '';
	if (contentType.includes('application/json')) {
		return JSON.parse(raw);
	}
	const params = new URLSearchParams(raw);
	const result = {};
	for (const [key, value] of params) {
		result[key] = value;
	}
	return result;
};

// ─── Static file serving ──────────────────────────────────────────────────────

const fileExists = filePath => {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
};

// Compressible text assets are served gzip/brotli (negotiated), with an ETag so a stale copy
// revalidates with a 304 instead of re-downloading, and Vary: Accept-Encoding. Measured: the
// shipped JS+CSS is 2.5 MB raw, 0.77 MB gzipped, and the reverse proxy in front does not compress
// JS/CSS. A request carrying ?v=<asset version> (app/assetVersion.js changes it with any shipped
// file) is immutable for a year; everything else revalidates after five minutes.
const COMPRESSIBLE = new Set(['.css', '.js', '.json', '.svg', '.html', '.webmanifest']);
const MIN_COMPRESS_BYTES = 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

const staticCache = new Map(); // filePath -> { mtimeMs, size, etag, body, gzip, br }

const cacheEntry = (filePath, stat) => {
	const cached = staticCache.get(filePath);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
	const body = fs.readFileSync(filePath);
	const entry = {
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 20)}"`,
		body,
		gzip: null,
		br: null,
	};
	staticCache.set(filePath, entry);
	return entry;
};

const encoded = (entry, encoding) => {
	if (!entry[encoding]) {
		entry[encoding] = new Promise((resolve, reject) => {
			const done = (error, result) => (error ? reject(error) : resolve(result));
			if (encoding === 'br') {
				zlib.brotliCompress(entry.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: entry.body.length } }, done);
			} else {
				zlib.gzip(entry.body, { level: 9 }, done);
			}
		});
	}
	return entry[encoding];
};

const chooseEncoding = acceptEncoding => {
	const accepted = `${acceptEncoding || ''}`.toLowerCase();
	// "name" or "name;q=<non-zero>" as one list item; "name;q=0" means refused
	const allows = name => new RegExp(`(^|,)\\s*${name}\\s*(;\\s*q=(?!0(\\.0*)?\\s*(,|$))[0-9.]+)?\\s*(,|$)`).test(accepted);
	if (allows('br')) return 'br';
	if (allows('gzip')) return 'gzip';
	return null;
};

const matchesEtag = (ifNoneMatch, etag) => {
	if (!ifNoneMatch) return false;
	if (ifNoneMatch.trim() === '*') return true;
	const bare = etag.replace(/^W\//, '');
	return ifNoneMatch.split(',').some(candidate => candidate.trim().replace(/^W\//, '') === bare);
};

const cacheControlFor = (filePath, versioned) => {
	const extension = path.extname(filePath).toLowerCase();
	const name = path.basename(filePath);
	if (extension === '.html') return 'no-store';
	if (extension === '.woff2') return 'public, max-age=31536000, immutable';
	if (name === 'service-worker.js' || extension === '.webmanifest') return 'no-cache';
	if (versioned) return 'public, max-age=31536000, immutable';
	return 'public, max-age=300';
};

// request is optional (without it the file is sent as is); versioned says the URL carried ?v=
const serveFile = (response, filePath, request = null, { versioned = false } = {}) => {
	const extension = path.extname(filePath).toLowerCase();
	const contentType = contentTypes[extension] || 'application/octet-stream';
	const stat = fs.statSync(filePath);
	const headers = {
		'Cache-Control': cacheControlFor(filePath, versioned),
		'Content-Type': contentType,
	};
	const buffered = COMPRESSIBLE.has(extension) && stat.size <= MAX_BUFFERED_BYTES;
	if (!buffered) {
		// images, fonts, big files: stream as is, with a cheap validator
		headers['ETag'] = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
		if (request && matchesEtag(request.headers['if-none-match'], headers['ETag'])) {
			response.writeHead(304, headers);
			response.end();
			return;
		}
		headers['Content-Length'] = stat.size;
		response.writeHead(200, headers);
		fs.createReadStream(filePath).pipe(response);
		return;
	}

	const entry = cacheEntry(filePath, stat);
	headers['Vary'] = 'Accept-Encoding';
	const encoding = request && stat.size >= MIN_COMPRESS_BYTES ? chooseEncoding(request.headers['accept-encoding']) : null;
	headers['ETag'] = encoding ? entry.etag.replace(/"$/, `-${encoding}"`) : entry.etag;
	if (request && matchesEtag(request.headers['if-none-match'], headers['ETag'])) {
		response.writeHead(304, headers);
		response.end();
		return;
	}
	const sendBody = (body, encodingName) => {
		if (encodingName) headers['Content-Encoding'] = encodingName;
		headers['Content-Length'] = body.length;
		response.writeHead(200, headers);
		response.end(body);
	};
	if (!encoding) {
		sendBody(entry.body, null);
		return;
	}
	encoded(entry, encoding).then(body => sendBody(body, encoding), () => {
		entry[encoding] = null;
		delete headers['ETag'];
		headers['ETag'] = entry.etag;
		sendBody(entry.body, null);
	});
};

// Compress the app's own root-level assets once at startup (off the event loop), so the first
// visitor does not pay brotli level 11 on a 800 KB file.
const warmStaticCache = publicDir => {
	let names = [];
	try {
		names = fs.readdirSync(publicDir);
	} catch {
		return;
	}
	for (const name of names) {
		const filePath = path.join(publicDir, name);
		try {
			const stat = fs.statSync(filePath);
			if (!stat.isFile() || !COMPRESSIBLE.has(path.extname(name).toLowerCase()) || stat.size < MIN_COMPRESS_BYTES || stat.size > MAX_BUFFERED_BYTES) continue;
			const entry = cacheEntry(filePath, stat);
			encoded(entry, 'br').catch(() => { entry.br = null; });
			encoded(entry, 'gzip').catch(() => { entry.gzip = null; });
		} catch { /* skip */ }
	}
};

// The service worker is a template: its cache name carries the asset version (app/assetVersion.js)
// so a changed deployment is a byte-different worker the browser installs, with no hand-bumped
// string. It is never cached by the browser or any proxy.
const serveServiceWorker = (response, filePath, version) => {
	const source = fs.readFileSync(filePath, 'utf8').replaceAll('__ASSET_VERSION__', version);
	response.writeHead(200, {
		'Cache-Control': 'no-cache',
		'Content-Type': contentTypes['.js'],
		'Content-Length': Buffer.byteLength(source),
		'Service-Worker-Allowed': '/',
	});
	response.end(source);
};

// ─── Domain helpers ───────────────────────────────────────────────────────────

const TRASH_FOLDER_ID = 'de1e7ede1e7ede1e7ede1e7ede1e7ede';
const ALL_NOTES_FOLDER_ID = '__all_notes__';

const allNotesFolder = count => ({
	id: ALL_NOTES_FOLDER_ID,
	parentId: '',
	title: 'All Notes',
	noteCount: count,
	createdTime: 0,
	updatedTime: 0,
	isVirtualAllNotes: true,
});

const trashFolder = count => ({
	id: TRASH_FOLDER_ID,
	parentId: '',
	title: 'Trash',
	noteCount: count,
	createdTime: 0,
	updatedTime: 0,
});

const selectedFolderForNav = currentFolderId => currentFolderId === ALL_NOTES_FOLDER_ID ? ALL_NOTES_FOLDER_ID : currentFolderId;

const normalizeStoredFolderId = folderId => folderId === '__all__' ? ALL_NOTES_FOLDER_ID : `${folderId || ''}`;

const mapNavNotes = notes => notes.map(note => note.deletedTime ? { ...note, parentId: TRASH_FOLDER_ID } : note);

// Items read from the database carry `fields` (every stored Joplin field, used so a
// rewrite can pass them through). That is internal: never send it to the browser.
const publicItem = item => {
	if (!item || typeof item !== 'object' || !('fields' in item)) return item;
	const { fields, ...rest } = item; // eslint-disable-line no-unused-vars
	return rest;
};
const publicItems = items => (Array.isArray(items) ? items.map(publicItem) : items);

const contentDispositionFilename = value => `${value || 'attachment'}`.replace(/[\r\n"]/g, '_');

const shouldInlineResource = mime => /^(image\/.+|application\/pdf|text\/plain)$/i.test(`${mime || ''}`);

// ─── Nav helpers ─────────────────────────────────────────────────────────────

// Wraps a navigationFragment in the OOB swap div used by htmx partial updates.
const navPanelOob = html => `<div id="nav-panel" hx-swap-oob="innerHTML">${html}</div>`;

// Fetches fresh nav data and renders the full nav + OOB wrapper in one call.
//   navDataFn(userId) → { folders, counts }
//   selectedFolderId, selectedNoteId — what to highlight
//   query — optional search query string
//   contextFolderId — defaults to selectedFolderForNav(selectedFolderId)
const rebuildNavOob = async (navDataFn, userId, selectedFolderId, selectedNoteId, query = '', contextFolderId) => {
	const templates = require('../templates');
	const { folders, counts } = await navDataFn(userId);
	const selFolder = selectedFolderForNav(selectedFolderId);
	return navPanelOob(templates.navigationFragment(
		folders, counts, selFolder, selectedNoteId, query,
		contextFolderId !== undefined ? contextFolderId : selFolder,
	));
};

const nextConflictCopyTitle = (title, existingTitles) => {
	const source = `${title || 'Untitled note'}`.trim() || 'Untitled note';
	const base = source.replace(/-\d+$/, '');
	const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`^${escapedBase}-(\\d+)$`);
	let maxSuffix = 0;
	for (const existingTitle of existingTitles) {
		const match = `${existingTitle || ''}`.match(re);
		if (match) maxSuffix = Math.max(maxSuffix, Number(match[1] || 0));
	}
	return `${base}-${maxSuffix + 1}`;
};

const assertVaultNoteBodyEncrypted = async (vaultService, userId, existingParentId, targetParentId, body, noteId, opts) => {
	if (!vaultService || !userId) return;
	// `enforceExistingVault` = require ciphertext even when the note is being
	// moved out of a vault into a plain folder.  This is the SYNC-PROXY policy:
	// external Joplin clients don't understand vaults and must not be able to
	// strip ciphertext by re-parenting.  The UI PUT/autosave path never passes
	// this flag — vault notes cannot change parentId at all (the guard runs
	// in the PUT handler before this call).
	const enforceExistingVault = !!(opts && opts.enforceExistingVault);
	const currentFolderId = `${existingParentId || ''}`;
	const nextFolderId = `${targetParentId !== undefined ? targetParentId : currentFolderId}`;
	const [existingVault, targetVault] = await Promise.all([
		currentFolderId ? vaultService.getVaultByFolderId(userId, currentFolderId).catch(() => null) : Promise.resolve(null),
		nextFolderId && nextFolderId !== currentFolderId ? vaultService.getVaultByFolderId(userId, nextFolderId).catch(() => null) : Promise.resolve(null),
	]);
	const bodyStr = `${body || ''}`;
	// Vault ciphertext must never be written to a non-vault folder.
	// Only applies when the folder *changes* — same-folder saves (where
	// targetVault is null because nextFolderId===currentFolderId is
	// short-circuited) are normal vault operations and pass through.
	if (nextFolderId !== currentFolderId && !targetVault && existingVault && isEncryptedBody(bodyStr)) {
		const error = new Error('Vault encrypted data cannot be written outside a vault folder');
		error.statusCode = 400;
		throw error;
	}
	// Determine whether we're writing to a vault (same-folder or target) or
	// the proxy is forcing vault-level enforcement on a vault→plain move.
	// ParentId changes for vault notes are rejected by the PUT handler
	// before we get here, so same-folder + proxy are the only vault-tied
	// paths that remain.
	const effectiveTargetVault = targetVault
		|| (nextFolderId === currentFolderId ? existingVault : null)
		|| (enforceExistingVault ? existingVault : null);
	if (!effectiveTargetVault) return;
	if (!isEncryptedBody(bodyStr)) {
		const error = new Error('Vault notes must be saved encrypted');
		error.statusCode = 400;
		throw error;
	}
	// Extract the Joplock ciphertext blob and check its embedded metadata.
	const START = '<!--joplock-encrypted-start-->';
	const END = '<!--joplock-encrypted-end-->';
	const startIdx = bodyStr.indexOf(START);
	const endIdx = bodyStr.indexOf(END);
	if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return; // legacy shape; encrypted marker already asserted above
	const json = bodyStr.slice(startIdx + START.length, endIdx).trim();
	let meta = null;
	try { meta = JSON.parse(json); } catch (e) { meta = null; }
	if (!meta || !meta.joplock_encrypted) return; // unknown / v1 shape — best-effort only
	const targetVaultId = `${(effectiveTargetVault && effectiveTargetVault.folderId) || nextFolderId || ''}`;
	if (meta.vault && targetVaultId && `${meta.vault}` !== targetVaultId) {
		const error = new Error('Encrypted body was produced for a different vault than the target folder');
		error.statusCode = 400;
		error.reason = 'vault-mismatch';
		throw error;
	}
	if (meta.noteId && noteId && `${meta.noteId}` !== `${noteId}`) {
		const error = new Error('Encrypted body was produced for a different note');
		error.statusCode = 400;
		error.reason = 'note-mismatch';
		throw error;
	}
};

const assertShareWriteAccess = async (itemService, userId, itemId) => {
	const { resolveItemShareAccess, assertCanWrite } = require('../items/shareAccess');
	const access = await resolveItemShareAccess(itemService, userId, itemId);
	if (!access) return; // new item path
	assertCanWrite(access);
};

module.exports = {
	chooseEncoding,
	matchesEtag,
	publicItem,
	publicItems,
	// response
	send,
	sendJson,
	makeSendHtml,
	expiredSessionCookie,
	redirect,
	// body
	readBody,
	readRawBody,
	parseMultipart,
	parseBody,
	// files
	fileExists,
	serveServiceWorker,
	serveFile,
	warmStaticCache,
	// domain
	TRASH_FOLDER_ID,
	ALL_NOTES_FOLDER_ID,
	allNotesFolder,
	trashFolder,
	selectedFolderForNav,
	normalizeStoredFolderId,
	mapNavNotes,
	contentDispositionFilename,
	shouldInlineResource,
	nextConflictCopyTitle,
	navPanelOob,
	rebuildNavOob,
	assertVaultNoteBodyEncrypted,
	assertShareWriteAccess,
};

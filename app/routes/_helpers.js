'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

const serveFile = (response, filePath) => {
	const extension = path.extname(filePath).toLowerCase();
	const contentType = contentTypes[extension] || 'application/octet-stream';
	const stat = fs.statSync(filePath);
	response.writeHead(200, {
		'Cache-Control': extension === '.html' ? 'no-store' : (extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=300'),
		'Content-Length': stat.size,
		'Content-Type': contentType,
	});
	fs.createReadStream(filePath).pipe(response);
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

module.exports = {
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
	serveFile,
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
};

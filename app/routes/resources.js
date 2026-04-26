'use strict';

const { send, sendJson, readRawBody, parseMultipart, contentDispositionFilename, shouldInlineResource } = require('./_helpers');
const templates = require('../templates');

const handle = async (url, request, response, ctx) => {
	const { authenticatedUser, itemService, itemWriteService, upstreamRequestContext } = ctx;

	// GET /resources/:id
	if (url.pathname.startsWith('/resources/') && request.method === 'GET') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { send(response, 401, 'Unauthorized', { 'Content-Type': 'text/plain' }); return true; }

			const resourceId = decodeURIComponent(url.pathname.slice('/resources/'.length));
			if (!resourceId || !/^[0-9a-zA-Z]{32}$/.test(resourceId)) {
				send(response, 400, 'Invalid resource ID', { 'Content-Type': 'text/plain' });
				return true;
			}

			const [meta, blob] = await Promise.all([
				itemService.resourceMetaByUserId(auth.user.id, resourceId),
				itemService.resourceBlobByUserId(auth.user.id, resourceId),
			]);

			if (!blob) { send(response, 404, 'Resource not found', { 'Content-Type': 'text/plain' }); return true; }

			const mime = (meta && meta.mime) || 'application/octet-stream';
			const filename = contentDispositionFilename((meta && (meta.filename || meta.title)) || `${resourceId}`);
			const download = url.searchParams.get('download') === '1';
			const disposition = `${download || !shouldInlineResource(mime) ? 'attachment' : 'inline'}; filename="${filename}"`;
			response.writeHead(200, {
				'Content-Type': mime,
				'Content-Length': blob.length,
				'Cache-Control': 'no-store',
				'Content-Disposition': disposition,
			});
			response.end(blob);
		} catch {
			send(response, 500, 'Error loading resource', { 'Content-Type': 'text/plain' });
		}
		return true;
	}

	// POST /fragments/upload
	if (url.pathname === '/fragments/upload' && request.method === 'POST') {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { sendJson(response, 401, { error: 'Session expired' }); return true; }

			const contentType = request.headers['content-type'] || '';
			if (!contentType.includes('multipart/form-data')) {
				sendJson(response, 400, { error: 'Expected multipart/form-data' });
				return true;
			}

			const rawBody = await readRawBody(request);
			const file = parseMultipart(rawBody, contentType);
			if (!file || !file.data.length) {
				sendJson(response, 400, { error: 'No file uploaded' });
				return true;
			}

			const extMatch = file.filename.match(/\.([^.]+)$/);
			const fileExtension = extMatch ? extMatch[1].toLowerCase() : '';

			const created = await itemWriteService.createResource(auth.user.sessionId, {
				title: file.filename,
				mime: file.mime,
				filename: file.filename,
				fileExtension,
				size: file.data.length,
			}, file.data, upstreamRequestContext(request));

			const isImage = file.mime.startsWith('image/');
			const markdown = isImage
				? `![${file.filename}](:/${created.id})`
				: `[${file.filename}](:/${created.id})`;

			sendJson(response, 200, { resourceId: created.id, markdown });
		} catch (error) {
			sendJson(response, error.statusCode || 500, { error: error.message || 'Upload failed' });
		}
		return true;
	}

	return false;
};

module.exports = { handle };

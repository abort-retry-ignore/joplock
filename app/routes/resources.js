'use strict';

const { send, sendJson, readRawBody, parseMultipart, contentDispositionFilename, shouldInlineResource } = require('./_helpers');

const escapeHtml = value => `${value}`
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll("'", '&#39;');

const handle = async (url, request, response, ctx) => {
	const { authenticatedUser, itemService, itemWriteService, upstreamRequestContext } = ctx;

	// GET|HEAD /resources/:id
	if (url.pathname.startsWith('/resources/') && (request.method === 'GET' || request.method === 'HEAD')) {
		try {
			const auth = await authenticatedUser(request);
			if (auth.error) { send(response, 401, 'Unauthorized', { 'Content-Type': 'text/plain' }); return true; }

			const resourceId = decodeURIComponent(url.pathname.slice('/resources/'.length));
			if (!resourceId || !/^[0-9a-zA-Z]{32}$/.test(resourceId)) {
				send(response, 400, 'Invalid resource ID', { 'Content-Type': 'text/plain' });
				return true;
			}

			const meta = await itemService.resourceMetaByUserId(auth.user.id, resourceId);
			const mime = (meta && meta.mime) || 'application/octet-stream';
			const filename = contentDispositionFilename((meta && (meta.filename || meta.title)) || `${resourceId}`);
			const download = url.searchParams.get('download') === '1';
			const disposition = `${download || !shouldInlineResource(mime) ? 'attachment' : 'inline'}; filename="${filename}"`;
			if (request.method === 'HEAD') {
				if (!meta) { send(response, 404, 'Resource not found', { 'Content-Type': 'text/plain' }); return true; }
				response.writeHead(200, {
					'Content-Type': mime,
					'Cache-Control': 'no-store',
					'Content-Disposition': disposition,
				});
				response.end();
				return true;
			}

			const blob = await itemService.resourceBlobByUserId(auth.user.id, resourceId);
			if (!blob) { send(response, 404, 'Resource not found', { 'Content-Type': 'text/plain' }); return true; }

			const viewer = url.searchParams.get('viewer') === '1';
			if (viewer) {
				const title = escapeHtml(filename);
				const resourceUrl = `/resources/${encodeURIComponent(resourceId)}`;
				let body;
				if (/^image\//i.test(mime)) {
					body = `<img src="${resourceUrl}" alt="${title}" class="resource-viewer-page-img" />`;
				} else if (/^text\//i.test(mime)) {
					// Embed text inline — avoids iframe auth issues on iOS PWA
					const text = blob.toString('utf8');
					body = `<pre class="resource-viewer-page-text">${escapeHtml(text)}</pre>`;
				} else if (mime === 'application/pdf') {
					// PDFs: use object tag which handles auth cookie better than iframe on some browsers
					body = `<object data="${resourceUrl}" type="application/pdf" class="resource-viewer-page-frame"><p style="color:#fff;padding:16px">PDF preview not available. <a href="${resourceUrl}?download=1" style="color:#6ee7b7">Save file</a></p></object>`;
				} else {
					body = `<div class="resource-viewer-page-unsupported"><p>Preview not available for this file type.</p><a class="resource-viewer-page-btn" href="${resourceUrl}?download=1">Save file</a></div>`;
				}
				send(response, 200, `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
	<meta name="theme-color" content="#08110b" />
	<title>${title}</title>
	<style>
		:root { color-scheme: dark; }
		body { margin: 0; font-family: system-ui, sans-serif; background: #000; color: #fff; }
		.resource-viewer-page { min-height: 100vh; display: flex; flex-direction: column; }
		.resource-viewer-page-bar { display: flex; align-items: center; gap: 10px; padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px; background: #111827; border-bottom: 1px solid rgba(255,255,255,0.12); }
		.resource-viewer-page-btn { appearance: none; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); color: #fff; border-radius: 10px; padding: 8px 14px; font: inherit; }
		.resource-viewer-page-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
		.resource-viewer-page-body { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; background: #000; }
		.resource-viewer-page-img { max-width: 100%; max-height: calc(100vh - 64px - env(safe-area-inset-top, 0px)); object-fit: contain; }
		.resource-viewer-page-frame { width: 100%; height: calc(100vh - 64px - env(safe-area-inset-top, 0px)); border: 0; background: #fff; }
		.resource-viewer-page-text { max-width: 100%; width: 100%; box-sizing: border-box; padding: 16px; margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; font-size: 14px; color: #e5e7eb; background: #111; overflow: auto; max-height: calc(100vh - 64px - env(safe-area-inset-top, 0px)); }
		.resource-viewer-page-unsupported { display: flex; flex-direction: column; align-items: center; gap: 16px; color: #9ca3af; padding: 32px; text-align: center; }
	</style>
</head>
<body>
	<div class="resource-viewer-page">
		<div class="resource-viewer-page-bar">
			<button type="button" class="resource-viewer-page-btn" onclick="history.length > 1 ? history.back() : window.close()">Back</button>
			<div class="resource-viewer-page-title">${title}</div>
			<a class="resource-viewer-page-btn" href="${resourceUrl}?download=1">Save</a>
		</div>
		<div class="resource-viewer-page-body">${body}</div>
	</div>
</body>
</html>`, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
				return true;
			}
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

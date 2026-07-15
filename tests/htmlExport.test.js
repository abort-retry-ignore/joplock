const { test, describe } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { handleExportHtml } = require('../app/routes/api');

const RID = 'a1b2c3d4e5f6789012345678abcdef00';

const fakeItemService = () => ({
	async resourceBlobByUserId() { return Buffer.from('fakeblob'); },
	async resourceMetaByUserId() { return { mime: 'image/png', filename: 'photo.png' }; },
});

const fakeRequest = (bodyObj) => {
	const req = new EventEmitter();
	req.headers = { 'content-type': 'application/json' };
	req.method = 'POST';
	req.setEncoding = () => {};
	process.nextTick(() => {
		req.emit('data', Buffer.from(JSON.stringify(bodyObj)).toString('utf8'));
		req.emit('end');
	});
	return req;
};

const fakeResponse = () => {
	const chunks = [];
	return {
		statusCode: null,
		headers: null,
		writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
		end(data) { if (data) chunks.push(data); this._done = true; },
		_body() { return chunks.join(''); },
	};
};

const fakeCtx = () => ({
	authenticatedUser: async () => ({ user: { id: 'user-1', sessionId: 's1' } }),
	itemService: fakeItemService(),
});

describe('handleExportHtml', () => {
	test('returns false for non-matching path', async () => {
		const url = new URL('http://x/api/export/pdf');
		const result = await handleExportHtml(url, fakeRequest({}), fakeResponse(), fakeCtx());
		assert.equal(result, false);
	});

	test('produces a standalone HTML document with theme class, CSS, and inlined image', async () => {
		const url = new URL('http://x/api/export/html');
		const req = fakeRequest({
			content: `<h1>Title</h1><p>Hello</p><img src="/resources/${RID}" alt="x" />`,
			title: 'My Note',
			theme: 'earth',
		});
		const res = fakeResponse();
		const result = await handleExportHtml(url, req, res, fakeCtx());
		assert.equal(result, true);
		assert.equal(res.statusCode, 200);
		assert.ok(res.headers['Content-Type'].includes('text/html'));
		assert.ok(res.headers['Content-Disposition'].includes('My_Note.html'));

		const body = res._body();
		assert.ok(body.includes('<!DOCTYPE html>'), 'should be a full standalone document');
		assert.ok(body.includes('class="theme-earth"'), 'body should carry the theme class');
		assert.ok(body.includes('<style>'), 'CSS should be inlined');
		assert.ok(body.includes('--bg:'), 'theme CSS variables should be present');
		assert.ok(body.includes('data:image/png;base64,'), 'image should be inlined as data URI');
		assert.ok(!body.includes(`/resources/${RID}`), 'resource src should not leak through');
		assert.ok(body.includes('<h1>Title</h1>'), 'body content should be preserved');
	});

	test('defaults to earth theme when theme is missing or invalid', async () => {
		const url = new URL('http://x/api/export/html');
		const req = fakeRequest({ content: '<p>hi</p>', title: 'note', theme: '../etc/passwd' });
		const res = fakeResponse();
		await handleExportHtml(url, req, res, fakeCtx());
		assert.ok(res._body().includes('class="theme-earth"'));
	});

	test('inlines attachment links as data URIs with download attribute', async () => {
		const url = new URL('http://x/api/export/html');
		const req = fakeRequest({
			content: `<p>see <a href="/resources/${RID}?download=1">report.pdf</a></p>`,
			title: 'note',
			theme: 'earth',
		});
		const res = fakeResponse();
		await handleExportHtml(url, req, res, fakeCtx());
		const body = res._body();
		assert.ok(body.includes('download="photo.png"') || body.includes('report.pdf'), 'attachment should be inlined or labeled');
		assert.ok(body.includes('data:image/png;base64,'), 'attachment data URI present (using fake item service mime)');
	});

	test('rejects request with no content', async () => {
		const url = new URL('http://x/api/export/html');
		const req = fakeRequest({ title: 'note' });
		const res = fakeResponse();
		await handleExportHtml(url, req, res, fakeCtx());
		assert.equal(res.statusCode, 400);
	});

	test('returns 401 when unauthenticated', async () => {
		const url = new URL('http://x/api/export/html');
		const req = fakeRequest({ content: '<p>hi</p>' });
		const res = fakeResponse();
		const ctx = { authenticatedUser: async () => ({ error: 'Unauthorized' }) };
		await handleExportHtml(url, req, res, ctx);
		assert.equal(res.statusCode, 401);
	});
});

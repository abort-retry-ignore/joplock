'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { serveFile, warmStaticCache, chooseEncoding, matchesEtag } = require('../app/routes/_helpers');

const big = `${'function joplock(){return "static asset"}\n'.repeat(400)}`; // compressible, > 1 KB

const withServer = async (files, fn) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-static-'));
	for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://x');
		serveFile(response, path.join(dir, url.pathname.slice(1)), request, { versioned: url.searchParams.has('v') });
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const get = (pathname, headers = {}) => new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port: server.address().port, path: pathname, headers }, res => {
			const chunks = [];
			res.on('data', c => chunks.push(c));
			res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
		}).on('error', reject);
	});
	try { await fn({ dir, get }); } finally { server.close(); }
};

test('Accept-Encoding negotiation: br over gzip over identity, q=0 refuses', () => {
	assert.equal(chooseEncoding('gzip, deflate, br'), 'br');
	assert.equal(chooseEncoding('gzip'), 'gzip');
	assert.equal(chooseEncoding('br;q=0, gzip'), 'gzip');
	assert.equal(chooseEncoding('br;q=0.5, gzip'), 'br');
	assert.equal(chooseEncoding('identity'), null);
	assert.equal(chooseEncoding(''), null);
	assert.equal(chooseEncoding(undefined), null);
});

test('If-None-Match matching handles lists, weak validators and *', () => {
	assert.equal(matchesEtag('"a", "b"', '"b"'), true);
	assert.equal(matchesEtag('W/"b"', '"b"'), true);
	assert.equal(matchesEtag('*', '"b"'), true);
	assert.equal(matchesEtag('"c"', '"b"'), false);
	assert.equal(matchesEtag(undefined, '"b"'), false);
});

test('serves gzip and brotli that decompress to the original, with Vary and a per-encoding ETag', async () => {
	await withServer({ 'app.js': big }, async ({ get }) => {
		const gz = await get('/app.js', { 'accept-encoding': 'gzip' });
		assert.equal(gz.status, 200);
		assert.equal(gz.headers['content-encoding'], 'gzip');
		assert.equal(gz.headers['vary'], 'Accept-Encoding');
		assert.equal(zlib.gunzipSync(gz.body).toString(), big);
		assert.ok(gz.body.length < big.length / 5, 'repetitive source must shrink a lot');
		assert.equal(Number(gz.headers['content-length']), gz.body.length);
		assert.match(gz.headers['etag'], /-gzip"$/);

		const br = await get('/app.js', { 'accept-encoding': 'gzip, br' });
		assert.equal(br.headers['content-encoding'], 'br');
		assert.equal(zlib.brotliDecompressSync(br.body).toString(), big);
		assert.match(br.headers['etag'], /-br"$/);

		const plain = await get('/app.js');
		assert.equal(plain.headers['content-encoding'], undefined);
		assert.equal(plain.body.toString(), big);
		assert.equal(plain.headers['vary'], 'Accept-Encoding');
		assert.doesNotMatch(plain.headers['etag'], /-(gzip|br)"$/);
	});
});

test('a matching If-None-Match gets a 304 with the validators, a stale one the full body', async () => {
	await withServer({ 'styles.css': big.replace(/function/g, '.rule') }, async ({ get }) => {
		const first = await get('/styles.css', { 'accept-encoding': 'br' });
		const etag = first.headers['etag'];
		const cached = await get('/styles.css', { 'accept-encoding': 'br', 'if-none-match': etag });
		assert.equal(cached.status, 304);
		assert.equal(cached.body.length, 0);
		assert.equal(cached.headers['etag'], etag);
		assert.ok(cached.headers['cache-control']);
		const stale = await get('/styles.css', { 'accept-encoding': 'br', 'if-none-match': '"old"' });
		assert.equal(stale.status, 200);
		// an ETag from another encoding is not a match for this one
		const other = await get('/styles.css', { 'accept-encoding': 'gzip', 'if-none-match': etag });
		assert.equal(other.status, 200);
	});
});

test('cache headers: versioned URLs are immutable, the rest revalidate; worker, manifest and html are never reused blindly', async () => {
	await withServer({ 'app.js': big, 'service-worker.js': big, 'manifest.webmanifest': big, 'page.html': big, 'font.woff2': 'x'.repeat(2000) }, async ({ get }) => {
		assert.equal((await get('/app.js?v=abc123')).headers['cache-control'], 'public, max-age=31536000, immutable');
		assert.equal((await get('/app.js')).headers['cache-control'], 'public, max-age=300');
		assert.equal((await get('/service-worker.js?v=abc123')).headers['cache-control'], 'no-cache');
		assert.equal((await get('/manifest.webmanifest?v=abc123')).headers['cache-control'], 'no-cache');
		assert.equal((await get('/page.html?v=1')).headers['cache-control'], 'no-store');
		assert.equal((await get('/font.woff2')).headers['cache-control'], 'public, max-age=31536000, immutable');
	});
});

test('content types are right for compressed responses', async () => {
	await withServer({ 'app.js': big, 'styles.css': big }, async ({ get }) => {
		assert.match((await get('/app.js', { 'accept-encoding': 'gzip' })).headers['content-type'], /^text\/javascript/);
		assert.match((await get('/styles.css', { 'accept-encoding': 'gzip' })).headers['content-type'], /^text\/css/);
	});
});

test('small files and already-compressed types are not compressed; images stream with a weak validator and 304', async () => {
	await withServer({ 'tiny.js': 'var a=1;', 'icon.png': Buffer.alloc(5000, 7) }, async ({ get }) => {
		const tiny = await get('/tiny.js', { 'accept-encoding': 'gzip, br' });
		assert.equal(tiny.headers['content-encoding'], undefined);
		assert.equal(tiny.body.toString(), 'var a=1;');
		const png = await get('/icon.png', { 'accept-encoding': 'gzip, br' });
		assert.equal(png.headers['content-encoding'], undefined);
		assert.equal(png.body.length, 5000);
		assert.match(png.headers['etag'], /^W\//);
		const again = await get('/icon.png', { 'if-none-match': png.headers['etag'] });
		assert.equal(again.status, 304);
	});
});

test('editing a file invalidates its cached body, compression and ETag', async () => {
	await withServer({ 'app.js': big }, async ({ dir, get }) => {
		const a = await get('/app.js', { 'accept-encoding': 'gzip' });
		const next = `${big}// changed\n`;
		fs.writeFileSync(path.join(dir, 'app.js'), next);
		const future = new Date(Date.now() + 5000);
		fs.utimesSync(path.join(dir, 'app.js'), future, future);
		const b = await get('/app.js', { 'accept-encoding': 'gzip' });
		assert.notEqual(b.headers['etag'], a.headers['etag']);
		assert.equal(zlib.gunzipSync(b.body).toString(), next);
	});
});

test('warming the cache tolerates a missing directory and compresses real files without error', async () => {
	assert.doesNotThrow(() => warmStaticCache(path.join(os.tmpdir(), 'joplock-does-not-exist')));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-warm-'));
	fs.writeFileSync(path.join(dir, 'app.js'), big);
	assert.doesNotThrow(() => warmStaticCache(dir));
});

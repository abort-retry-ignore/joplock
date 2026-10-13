'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeAssetVersion, assetVersion } = require('../app/assetVersion');
const { serveServiceWorker } = require('../app/routes/_helpers');

const tempPublic = files => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-assets-'));
	for (const [name, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), content);
	}
	return dir;
};

test('the asset version is stable for unchanged files and changes with any shipped file', () => {
	const dir = tempPublic({ 'app.js': 'a', 'styles.css': 'b', 'tinymce/tinymce.min.js': 't', 'tinymce/plugins/x.js': 'p' });
	const v1 = computeAssetVersion(dir);
	assert.match(v1, /^[0-9a-f]{10}$/);
	assert.equal(computeAssetVersion(dir), v1);
	fs.writeFileSync(path.join(dir, 'app.js'), 'a2');
	const v2 = computeAssetVersion(dir);
	assert.notEqual(v2, v1);
	fs.writeFileSync(path.join(dir, 'tinymce/tinymce.min.js'), 't2');
	assert.notEqual(computeAssetVersion(dir), v2);
	// vendor files other than the entry point are not hashed
	const v3 = computeAssetVersion(dir);
	fs.writeFileSync(path.join(dir, 'tinymce/plugins/x.js'), 'p2');
	assert.equal(computeAssetVersion(dir), v3);
});

test('a file added to public/ changes the version, and a missing directory does not throw', () => {
	const dir = tempPublic({ 'app.js': 'a' });
	const before = computeAssetVersion(dir);
	fs.writeFileSync(path.join(dir, 'viewport.js'), 'v');
	assert.notEqual(computeAssetVersion(dir), before);
	assert.match(computeAssetVersion(path.join(dir, 'nope')), /^[0-9a-f]{10}$/);
});

test('the real public/ yields one version, and every template uses it', () => {
	const v = assetVersion();
	assert.match(v, /^[0-9a-f]{10}$/);
	const templates = require('../app/templates');
	assert.ok(templates.layoutPage({ user: null }).includes(`/styles.css?v=${v}`));
	assert.ok(templates.layoutPage({ user: { id: 'u', email: 'a@b.c' }, navContent: '', editorContent: '', settings: {} }).includes(`assetVersion:"${v}"`));
});

test('the served service worker carries the version in its cache name and is never cached', () => {
	const dir = tempPublic({ 'service-worker.js': "const CACHE_NAME = 'joplock-shell-__ASSET_VERSION__'; // __ASSET_VERSION__\n" });
	let status; let headers; let body;
	const response = { writeHead: (s, h) => { status = s; headers = h; }, end: b => { body = b; } };
	serveServiceWorker(response, path.join(dir, 'service-worker.js'), 'abc123');
	assert.equal(status, 200);
	assert.equal(body, "const CACHE_NAME = 'joplock-shell-abc123'; // abc123\n");
	assert.equal(headers['Cache-Control'], 'no-cache');
	assert.equal(headers['Service-Worker-Allowed'], '/');
	assert.match(headers['Content-Type'], /javascript/);
	assert.equal(headers['Content-Length'], Buffer.byteLength(body));
});

test('the shipped service worker is a template, not a hand-versioned file', () => {
	const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');
	assert.match(sw, /const CACHE_NAME = 'joplock-shell-__ASSET_VERSION__'/);
	assert.doesNotMatch(sw, /joplock-shell-v\d+/);
});

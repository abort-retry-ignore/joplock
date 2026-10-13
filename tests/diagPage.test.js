'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const templates = require('../app/templates');
const { diagOptions, viewportContent } = require('../app/templates/diag');
const routeDiag = require('../app/routes/diag');

const scriptOf = html => html.split('<script>')[1].split('</script>')[0];

test('diag options only accept known values', () => {
	assert.deepEqual(diagOptions(new URLSearchParams('')), { shell: 'current', iw: false, zoom: false });
	assert.deepEqual(diagOptions(new URLSearchParams('shell=vv&iw=1&zoom=1')), { shell: 'vv', iw: true, zoom: true });
	assert.equal(diagOptions(new URLSearchParams('shell=<script>')).shell, 'current');
});

test('viewport meta mirrors the app by default and varies only as requested', () => {
	assert.equal(viewportContent({ iw: false, zoom: false }), 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
	assert.match(viewportContent({ iw: true, zoom: false }), /interactive-widget=resizes-content/);
	assert.doesNotMatch(viewportContent({ iw: false, zoom: true }), /user-scalable|maximum-scale/);
});

test('diag page renders each variant and its script parses', () => {
	for (const q of ['', 'shell=vv', 'shell=vv&iw=1', 'shell=current&zoom=1']) {
		const html = templates.diagPage({ query: new URLSearchParams(q) });
		assert.match(html, /^<!DOCTYPE html>/);
		assert.doesNotThrow(() => new vm.Script(scriptOf(html)), `script for "${q}" must parse`);
		assert.doesNotMatch(html, /\$\{/, 'no unrendered template placeholder');
	}
	assert.match(templates.diagPage({ query: new URLSearchParams('shell=vv') }), /id="shell" class="shell-vv"/);
});

test('every reported field survives the server-side client-log key filter', () => {
	// /api/web/client-log drops keys matching this pattern, so a field named like one is lost silently.
	const dropped = /text|body|content|password|key|secret|token/i;
	const keys = [...scriptOf(templates.diagPage({})).matchAll(/put\('([A-Za-z0-9_]+)'/g)].map(m => m[1]);
	assert.ok(keys.length > 30, 'expected the snapshot to report many fields');
	for (const extra of ['label', 'rid', 'n', 'auto']) keys.push(extra);
	for (const key of keys) assert.doesNotMatch(key, dropped, `report field "${key}" would be dropped by the server`);
});

const run = async ({ pathname = '/diag', method = 'GET', debug = true, user = { id: 'u1' } } = {}) => {
	const out = { html: null, redirect: null };
	const ctx = {
		isDebug: () => debug,
		templates,
		sendHtml: (_res, status, html) => { out.status = status; out.html = html; },
		authenticatedUser: async () => (user ? { user } : { error: 'no' }),
	};
	const response = { writeHead: (status, headers) => { out.status = status; out.redirect = headers && headers.Location; }, end() {} };
	out.handled = await routeDiag.handle(new URL(`http://x${pathname}`), { method, headers: {} }, response, ctx);
	return out;
};

test('/diag is served to a signed-in user in debug mode', async () => {
	const out = await run({ pathname: '/diag?shell=vv' });
	assert.equal(out.handled, true);
	assert.equal(out.status, 200);
	assert.match(out.html, /shell-vv/);
});

test('/diag does not exist when debug is off, or for other paths and methods', async () => {
	assert.equal((await run({ debug: false })).handled, false);
	assert.equal((await run({ pathname: '/diagnostics' })).handled, false);
	assert.equal((await run({ method: 'POST' })).handled, false);
});

test('/diag redirects an anonymous visitor to the login page', async () => {
	const out = await run({ user: null });
	assert.equal(out.handled, true);
	assert.equal(out.status, 302);
	assert.equal(out.redirect, '/login');
});

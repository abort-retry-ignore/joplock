'use strict';

// Why these exist: with apple-mobile-web-app-status-bar-style=black-translucent, an iOS
// home-screen app sizes innerHeight / 100dvh / 100svh as (screen height - top safe-area inset),
// anchored at the top, while 100lvh/100vh still report the real screen. The app stops that
// many points above the bottom edge (a dead band under it) and every `position: fixed;
// bottom: ...` element floats too high. Measured on an iPhone Air: screen 812, innerHeight
// 751, top inset 61. Leaving the meta tag out gives the normal layout (content below the
// status bar, bottom edge on the hardware), which is what herdr-web-ui ships. iOS bakes the
// value in at install time, so changing it needs the icon removed and added again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const templates = require('../app/templates');

const publicDir = path.join(__dirname, '..', 'public');
const stylesSrc = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

const user = { id: 'u1', email: 'a@example.com', isAdmin: false };

test('no real page head asks iOS for the black-translucent status bar', () => {
	const pages = {
		login: templates.layoutPage({ user: null }),
		app: templates.layoutPage({ user, navContent: '', editorContent: '', settings: {} }),
		diag: templates.diagPage({}),
	};
	for (const [name, html] of Object.entries(pages)) {
		assert.doesNotMatch(html, /apple-mobile-web-app-status-bar-style/, `${name} page must not set a status bar style`);
		assert.doesNotMatch(html, /black-translucent/, `${name} page must not use black-translucent`);
	}
});

test('home-screen app meta that must stay is still present', () => {
	const html = templates.layoutPage({ user: null });
	assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes"/);
	assert.match(html, /<meta name="mobile-web-app-capable" content="yes"/);
	assert.match(html, /viewport-fit=cover/);
	assert.match(html, /<link rel="manifest"/);
});

test('every apple-touch-startup-image link points at a real file with matching pixel size', () => {
	const html = templates.layoutPage({ user: null });
	const links = [...html.matchAll(/<link rel="apple-touch-startup-image" href="\/apple-splash\/(\d+)x(\d+)\.png" media="([^"]+)"/g)];
	assert.ok(links.length >= 24, `expected the splash set, got ${links.length}`);
	for (const [, w, h, media] of links) {
		const file = path.join(publicDir, 'apple-splash', `${w}x${h}.png`);
		assert.ok(fs.existsSync(file), `${w}x${h}.png is referenced but missing`);
		const dw = Number(/device-width: (\d+)px/.exec(media)[1]);
		const dh = Number(/device-height: (\d+)px/.exec(media)[1]);
		const dpr = Number(/pixel-ratio: (\d+)/.exec(media)[1]);
		const portrait = /portrait/.test(media);
		assert.deepEqual([Number(w), Number(h)], portrait ? [dw * dpr, dh * dpr] : [dh * dpr, dw * dpr], `${w}x${h} does not match its media query: ${media}`);
	}
	const sizes = links.map(l => `${l[1]}x${l[2]}`);
	assert.ok(sizes.includes('1260x2736'), 'iPhone Air portrait splash (420x912 @3x)');
	assert.ok(sizes.includes('1206x2622'), 'iPhone 16/17 Pro portrait splash (402x874 @3x)');
});

test('every 100vh in the stylesheet has a 100dvh fallback line next to it (iOS home-screen apps overflow on 100vh)', () => {
	const lines = stylesSrc.split('\n');
	const missing = [];
	lines.forEach((line, i) => {
		if (!/100vh/.test(line)) return;
		if (/^\s*\.app \{/.test(line)) return; // desktop shell, display:none in the mobile shell
		const near = lines.slice(Math.max(0, i - 1), i + 3).join('\n');
		if (!/100dvh/.test(near)) missing.push(`${i + 1}: ${line.trim()}`);
	});
	assert.deepEqual(missing, []);
});

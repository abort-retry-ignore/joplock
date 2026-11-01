'use strict';

// The note is drawn on --bg-editor in every editor and shell. Desktop markdown mode always did
// (.col-editor), but rendered mode (TinyMCE: its host, edit area and iframe body) and the phone's
// editor screen used --bg. On themes where the two differ (8 of 21) switching modes changed the
// page colour; on the light "fruit" theme rendered mode turned visibly cream/yellow (#f5f5f0 vs white).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const { themeOptions } = require('../app/templates/shared');

const block = selector => {
	const m = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.#*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
	assert.ok(m, `no CSS block for ${selector}`);
	return m[1];
};

test('every selectable theme defines --bg-editor', () => {
	for (const [slug] of themeOptions) assert.match(block(`.theme-${slug}`), /--bg-editor:\s*[^;]+;/, `theme ${slug} has no --bg-editor`);
});

test('every editor surface paints --bg-editor', () => {
	assert.match(block('.col-editor'), /background:\s*var\(--bg-editor\)/, 'desktop editor column');
	assert.match(block('.tinymce-host'), /background:\s*var\(--bg-editor\)/, 'rendered-mode host');
	assert.match(css, /\.tox \.tox-edit-area,\s*\.tox \.tox-edit-area__iframe\s*\{\s*background:\s*var\(--bg-editor\) !important;/, 'TinyMCE edit area');
	assert.match(block('#mobile-editor-screen'), /background:\s*var\(--bg-editor\)/, 'phone editor screen');
});

test('the TinyMCE iframe receives --bg-editor and paints its body with it', () => {
	const sync = /function _syncTinyMCEThemeVars\(\)\{[\s\S]*?var vars=\[([^\]]*)\]/.exec(app);
	assert.ok(sync, '_syncTinyMCEThemeVars not found');
	assert.match(sync[1], /'--bg-editor'/, '--bg-editor must be forwarded into the iframe');
	assert.match(app, /body\{font-family:'\+fontFamily\+';font-size:'\+fontSize\+';line-height:1\.7;color:var\(--text\);background:var\(--bg-editor,var\(--bg\)\)\}/);
});

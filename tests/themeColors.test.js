'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { themeColor, parseThemeColors, DEFAULT_THEME } = require('../app/themeColors');
const { themeOptions } = require('../app/templates/shared');
const templates = require('../app/templates');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

test('every selectable theme has a theme-color in the stylesheet', () => {
	const colors = parseThemeColors(css);
	for (const [slug] of themeOptions) assert.match(colors[slug] || '', /^#[0-9a-f]{3,8}$/, `theme ${slug} has no --theme-color`);
});

test('themeColor reads the stylesheet value and falls back to the default theme', () => {
	assert.equal(themeColor('nord'), parseThemeColors(css).nord);
	assert.equal(themeColor('not-a-theme'), parseThemeColors(css)[DEFAULT_THEME]);
	assert.equal(themeColor(undefined), parseThemeColors(css)[DEFAULT_THEME]);
});

test('pages put the user\'s theme colour in the head, and the login page the login theme\'s', () => {
	const app = templates.layoutPage({ user: { id: 'u', email: 'a@b.c' }, navContent: '', editorContent: '', settings: { theme: 'nord' } });
	assert.match(app, new RegExp(`<meta name="theme-color" content="${themeColor('nord')}"`));
	const login = templates.layoutPage({ user: null });
	assert.match(login, new RegExp(`<meta name="theme-color" content="${themeColor('dark-grey')}"`));
	assert.match(login, /class="theme-dark-grey/);
});

test('the manifest matches the default theme, has a stable id and does not lock the orientation', () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'));
	assert.equal(manifest.id, '/');
	assert.equal(manifest.orientation, undefined);
	assert.equal(manifest.theme_color, themeColor(DEFAULT_THEME));
	const bg = new RegExp(`\\.theme-${DEFAULT_THEME}\\s*\\{[^}]*--bg:\\s*(#[0-9a-fA-F]+)`).exec(css)[1].toLowerCase();
	assert.equal(manifest.background_color, bg);
});

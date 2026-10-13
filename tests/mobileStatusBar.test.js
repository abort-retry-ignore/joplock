'use strict';

// The markdown editor's word-count / heading-outline bar is a desktop feature. In the mobile
// shell it is not created at all (it cost a row of screen under the editor and recounted words
// on every keystroke), while the user's mdStatusBar setting still governs the desktop shell.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `function ${name} not found in app.js`);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error(`no closing brace for ${name}`);
}

function optionsPassed({ mobile, setting }) {
	let captured = null;
	const ctx = vm.createContext({
		window: { JoplockMd: { createExtensions: (_C, _hooks, opts) => { captured = opts; return []; } } },
		console,
		_mdStatusBar: setting,
		_mdInlineWidgets: true,
		_mdLivePreview: false,
		_mdFolding: true,
		isMobileShellMode: () => mobile,
		_cmExtraHooks: () => ({}),
	});
	vm.runInContext(`${extractFn('_cmExtraExtensions')}; _cmExtraExtensions({});`, ctx);
	return captured;
}

test('the desktop shell follows the mdStatusBar setting', () => {
	assert.equal(optionsPassed({ mobile: false, setting: true }).statusBar, true);
	assert.equal(optionsPassed({ mobile: false, setting: false }).statusBar, false);
});

test('the mobile shell never gets the status bar, whatever the setting says', () => {
	assert.equal(optionsPassed({ mobile: true, setting: true }).statusBar, false);
	assert.equal(optionsPassed({ mobile: true, setting: false }).statusBar, false);
});

test('other markdown extras are unaffected by the shell', () => {
	for (const mobile of [true, false]) {
		const o = optionsPassed({ mobile, setting: true });
		assert.equal(o.inlineWidgets, true);
		assert.equal(o.folding, true);
		assert.equal(o.livePreview, false);
	}
});

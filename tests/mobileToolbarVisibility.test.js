'use strict';

// setMobileToolbarVisible(false) is called when the viewport handler thinks the keyboard went
// away and 200ms after the rich editor blurs. In markdown mode that used to hide the formatting
// toolbar for good (nothing re-showed it), so it vanished the moment a line was tapped. It must
// ignore "hide" in markdown mode; only a locked vault hides it.

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

function run({ mode, show, form }) {
	const tb = { style: { display: '' } };
	let repositioned = 0;
	const ctx = vm.createContext({
		_editorMode: mode,
		mobileEditorToolbar: () => tb,
		activeEditorForm: () => form || null,
		positionTinyMCEHost: () => { repositioned++; },
		setTimeout: fn => fn(),
	});
	vm.runInContext(`${extractFn('setMobileToolbarVisible')}; setMobileToolbarVisible(${show});`, ctx);
	return { display: tb.style.display, repositioned };
}

test('markdown mode keeps the toolbar when asked to hide it', () => {
	for (const mode of ['markdown', 'md']) {
		assert.equal(run({ mode, show: false }).display, 'flex');
		assert.equal(run({ mode, show: true }).display, 'flex');
	}
});

test('a locked vault hides the markdown toolbar whatever is asked', () => {
	const locked = { dataset: { encrypted: '1', vaultUnlocked: '0' } };
	assert.equal(run({ mode: 'markdown', show: true, form: locked }).display, 'none');
	assert.equal(run({ mode: 'markdown', show: false, form: locked }).display, 'none');
	const unlocked = { dataset: { encrypted: '1', vaultUnlocked: '1' } };
	assert.equal(run({ mode: 'markdown', show: false, form: unlocked }).display, 'flex');
});

test('rich mode leaves the toolbar to CSS (TinyMCE has its own) and just repositions the host', () => {
	for (const show of [true, false]) {
		const r = run({ mode: 'rich', show });
		assert.equal(r.display, '');
		assert.equal(r.repositioned, 1);
	}
});

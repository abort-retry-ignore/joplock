/**
 * Settings → "Open notes in: Markdown" must actually open notes in CM6.
 *
 * Two regressions this pins:
 *   1. `_joplockConfig` must be inlined before app.js so `_cfg.noteOpenMode`
 *      is set when app.js parses (otherwise it sticks at 'preview').
 *   2. initEditorPanel must not let mobile read-only (`_mobileRO`) force
 *      rendered mode — that made the setting a no-op on tablet/narrow windows.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `function ${name} not found in app.js`);
	let depth = 0, i = start;
	while (i < appSrc.length) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
		i++;
	}
	throw new Error(`Could not find closing brace for function ${name}`);
}

test('preferredEditorMode reads live _joplockConfig, not only the parse-time snapshot', () => {
	const src = extractFn('preferredEditorMode');
	assert.ok(src.includes('window._joplockConfig'), 'must re-read live config');
	assert.ok(src.includes("==='markdown'?'markdown':'rich'"), 'markdown preference must map to markdown mode');
});

test('initEditorPanel uses preferredEditorMode and does not let mobile RO force rich', () => {
	const src = extractFn('initEditorPanel');
	assert.ok(src.includes('preferredEditorMode()'), 'initEditorPanel must honor Settings noteOpenMode via preferredEditorMode()');
	assert.ok(!src.includes('_mobileRO?false:_defaultNoteOpenMode'), 'must not let mobile read-only override the open-mode preference');
	assert.ok(src.includes('_tinymceReadonly=_mobileRO&&_editorMode!==\'markdown\''), 'mobile read-only applies only when the note opens rendered');
});

test('preferredEditorMode: live markdown config wins over a stale preview snapshot', () => {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		window: dom.window,
		document: dom.window.document,
		_defaultNoteOpenMode: 'preview',
	});
	dom.window._joplockConfig = { noteOpenMode: 'markdown' };
	vm.runInContext(extractFn('preferredEditorMode'), ctx);
	assert.equal(vm.runInContext('preferredEditorMode()', ctx), 'markdown');
});

test('preferredEditorMode: missing live config falls back to snapshot', () => {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		window: dom.window,
		document: dom.window.document,
		_defaultNoteOpenMode: 'markdown',
	});
	vm.runInContext(extractFn('preferredEditorMode'), ctx);
	assert.equal(vm.runInContext('preferredEditorMode()', ctx), 'markdown');
});

test('preferredEditorMode: preview / unknown → rich', () => {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		window: dom.window,
		document: dom.window.document,
		_defaultNoteOpenMode: 'preview',
	});
	dom.window._joplockConfig = { noteOpenMode: 'preview' };
	vm.runInContext(extractFn('preferredEditorMode'), ctx);
	assert.equal(vm.runInContext('preferredEditorMode()', ctx), 'rich');
});

'use strict';

// A rendered note that has been read-only since it loaded (the phone's default) must never be converted
// back to markdown by the leave/flush/mode-switch paths: HTML -> markdown is not exact, so the conversion
// rewrote the note (`|---|` -> `| --- |`, `1. ` -> `1.  `, the final newline) and saved an edit nobody made.
// An editor that has been editable since the load (pencil on, or desktop) still converts, so real edits
// are never lost. Browser coverage: playwright-tests/mobile-readonly-no-save.spec.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `function ${name} not found in app.js`);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}' && --depth === 0) return appSrc.slice(start, i + 1);
	}
	throw new Error(`no closing brace for ${name}`);
}

const sandbox = () => {
	const ctx = {
		calls: 0, _tinymceReadonly: true, _tinymceEditableSinceLoad: false, _tinymceEditor: null,
		_log() {}, tinyMCESyncToTA() { ctx.calls++; return true; },
		_isHtmlNoteActive: () => false, _applyFormReadonly() {}, _jopEditBtnApi: undefined,
	};
	vm.createContext(ctx);
	vm.runInContext(['_syncTinyMCEIfEditable', '_applyTinyMCEReadonly', '_setTinyMCEReadonly'].map(extractFn).join('\n'), ctx);
	return ctx;
};

test('a view that has been read-only since it loaded is not converted; an editable one is', () => {
	const ctx = sandbox();
	assert.equal(vm.runInContext('_syncTinyMCEIfEditable()', ctx), false);
	assert.equal(ctx.calls, 0, 'read-only since load: no HTML -> markdown conversion');
	ctx._tinymceEditableSinceLoad = true;
	assert.equal(vm.runInContext('_syncTinyMCEIfEditable()', ctx), true);
	assert.equal(ctx.calls, 1);
});

test('turning edit mode on marks the editor editable for the rest of the load; turning it off does not undo that', () => {
	const ctx = sandbox();
	vm.runInContext('_setTinyMCEReadonly(false)', ctx);
	assert.equal(ctx._tinymceEditableSinceLoad, true, 'pencil on');
	vm.runInContext('_setTinyMCEReadonly(true)', ctx);
	assert.equal(ctx._tinymceEditableSinceLoad, true, 'pencil off again: an edit made meanwhile may still be unsynced');
	vm.runInContext('_syncTinyMCEIfEditable()', ctx);
	assert.equal(ctx.calls, 1, 'so leaving converts it');
});

test('loading content starts over from the current read-only state', () => {
	const body = extractFn('_setTinyMCEContent');
	assert.match(body, /_tinymceEditableSinceLoad=!_tinymceReadonly;/);
	assert.match(extractFn('_applyTinyMCEReadonly'), /if\(!_tinymceReadonly\)_tinymceEditableSinceLoad=true;/);
});

test('the leave, flush and mode-switch paths convert only through the guard', () => {
	for (const name of ['flushSave', 'buildFlushRequest', 'overwriteWithLocalEdits', 'setEditorMode']) {
		const body = extractFn(name);
		assert.match(body, /_syncTinyMCEIfEditable\(\)/, `${name} uses the guard`);
		assert.doesNotMatch(body.replace(/_syncTinyMCEIfEditable\(\)/g, ''), /tinyMCESyncToTA\(\)/, `${name} must not convert unguarded`);
	}
	// deliberate edits made in the rendered editor still convert right away (they need an editable editor anyway)
	for (const name of ['replaceTinyMCETextExpansion', 'insertProseCompletionTinyMCE']) assert.match(extractFn(name), /tinyMCESyncToTA\(\)/);
});

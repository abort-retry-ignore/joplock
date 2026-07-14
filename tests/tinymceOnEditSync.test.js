/**
 * Integration-style tests for the TinyMCE onEdit sync path.
 *
 * Two sync strategies coexist:
 *   * Production (fast path, _dbg=false): onEdit calls markEdited() +
 *     scheduleSave() but skips per-event tinymceToMarkdown(). The debounced
 *     scheduleSave timer calls _lazyTinyMCESyncBeforeSave() ONCE per save
 *     cycle, right before hashing. Collapses N events (input+change+
 *     ExecCommand+SetContent) per user action into 1 conversion.
 *   * Debug (_dbg=true): full per-event sync + log so we can trace bugs.
 *
 * This file pins:
 *   * Wiring: onEdit is registered on input, change, ExecCommand, SetContent.
 *   * Fast path: mutation triggers markEdited/scheduleSave; textarea is NOT
 *     eagerly synced (that happens lazily before save).
 *   * Debug path: mutation eagerly syncs into #note-body.
 *   * Load guards (_tinymceSuppressEdits) still suppress everything.
 *   * Read-only editor never syncs.
 *   * _lazyTinyMCESyncBeforeSave short-circuits for markdown mode, hidden
 *     host, readonly, suppressed, or missing editor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// ---------------------------------------------------------------------------
// Extract onEdit + _lazyTinyMCESyncBeforeSave source
// ---------------------------------------------------------------------------

function extractOnEditBody() {
	const marker = 'function onEdit(){';
	const idx = appSrc.indexOf(marker);
	assert.ok(idx !== -1, 'function onEdit not found in app.js');
	const bodyStart = idx + marker.length;
	let depth = 1, i = bodyStart;
	while (i < appSrc.length && depth > 0) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') depth--;
		i++;
	}
	return appSrc.slice(bodyStart, i - 1);
}

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

// ---------------------------------------------------------------------------
// Fake editor + JSDOM sandbox
// ---------------------------------------------------------------------------

function makeSandbox({ initialTaValue = '', initialHtml = '<p>hello</p>', dbg = false, editorMode = 'rich' } = {}) {
	const dom = new JSDOM(`<!DOCTYPE html>
		<body>
			<form id="note-editor-form">
				<textarea name="body" id="note-body">${initialTaValue}</textarea>
			</form>
			<div id="tinymce-host" class="tinymce-host tinymce-host-visible"></div>
		</body>`, { url: 'https://joplock.test' });

	const listeners = new Map();
	let currentContent = initialHtml;
	const editor = {
		getContent() { return currentContent; },
		setContent(html) {
			currentContent = html;
			(listeners.get('SetContent') || []).forEach(fn => fn({}));
		},
		insertContent(html) {
			currentContent = currentContent + html;
			(listeners.get('SetContent') || []).forEach(fn => fn({}));
		},
		on(name, fn) {
			if (!listeners.has(name)) listeners.set(name, []);
			listeners.get(name).push(fn);
		},
		fire(name, data) {
			(listeners.get(name) || []).forEach(fn => fn(data || {}));
		},
	};

	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		Event: dom.window.Event,
		editor,
		_tinymceEditor: editor,
		_tinymceSuppressEdits: false,
		_tinymceReadonly: false,
		_editorMode: editorMode,
		_dbg: !!dbg,
		_saveScheduled: 0,
		_editedMarked: 0,
		_logs: [],
	});

	vm.runInContext(`
		function activeEditorForm(){return document.getElementById('note-editor-form')}
		function queryActiveEditor(sel){var f=activeEditorForm();return f?f.querySelector(sel):null}
		function getTA(){return queryActiveEditor('#note-body')}
		function tinymceToMarkdown(html){return String(html||'').replace(/<[^>]+>/g,'')}
		function markEdited(){_editedMarked++}
		function scheduleSave(){_saveScheduled++}
		function _log(){_logs.push(Array.from(arguments).join(' '))}
	`, ctx);

	vm.runInContext(extractFn('_lazyTinyMCESyncBeforeSave'), ctx);
	vm.runInContext(`function onEdit(){${extractOnEditBody()}}`, ctx);
	vm.runInContext(`editor.on('ExecCommand',onEdit); editor.on('SetContent',onEdit); editor.on('input',onEdit); editor.on('change',onEdit);`, ctx);

	return { ctx, editor, dom };
}

function taValue(ctx) { return vm.runInContext('document.getElementById("note-body").value', ctx); }
function saveCount(ctx) { return vm.runInContext('_saveScheduled', ctx); }
function editedCount(ctx) { return vm.runInContext('_editedMarked', ctx); }

// ---------------------------------------------------------------------------
// Fast path (production): schedules save, does NOT eagerly sync
// ---------------------------------------------------------------------------

test('fast path: onEdit schedules save + marks edited but does NOT eagerly sync #note-body', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(saveCount(ctx), 1, 'input must schedule save');
	assert.equal(editedCount(ctx), 1, 'input must markEdited');
	assert.equal(taValue(ctx), 'hello', 'fast path must NOT sync eagerly (lazy sync runs in scheduleSave timer)');
});

test('fast path: multiple events per user action collapse into N scheduleSave calls but 0 syncs', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'x', initialHtml: '<p>x</p>', dbg: false });
	editor.getContent = () => '<h2>x</h2>';
	editor.fire('SetContent');
	editor.fire('ExecCommand', { command: 'FormatBlock' });
	editor.fire('input');
	editor.fire('change');
	assert.equal(saveCount(ctx), 4, 'each event schedules save (debounce coalesces at scheduleSave layer)');
	assert.equal(taValue(ctx), 'x', 'no eager sync in fast path');
});

test('fast path: _lazyTinyMCESyncBeforeSave() picks up latest TinyMCE content', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	editor.getContent = () => '<h2>heading</h2>';
	editor.fire('ExecCommand', { command: 'FormatBlock' });
	assert.equal(taValue(ctx), 'hello', 'not yet synced');
	const changed = vm.runInContext('_lazyTinyMCESyncBeforeSave()', ctx);
	assert.equal(changed, true, 'lazy sync must report the textarea changed');
	assert.equal(taValue(ctx), 'heading', 'textarea now reflects TinyMCE content');
});

test('fast path: _lazyTinyMCESyncBeforeSave() returns false when content matches', () => {
	const { ctx } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	const changed = vm.runInContext('_lazyTinyMCESyncBeforeSave()', ctx);
	assert.equal(changed, false);
});

// ---------------------------------------------------------------------------
// Debug path: eager sync + log
// ---------------------------------------------------------------------------

test('debug path: onEdit eagerly syncs into #note-body', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: true });
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(taValue(ctx), 'hello world', 'debug path must sync every event');
	assert.ok(saveCount(ctx) >= 1, 'debug path must schedule at least one save');
	const logs = vm.runInContext('_logs.join("\\n")', ctx);
	assert.ok(/onEdit sync \(debug\)/.test(logs), 'debug path must log sync activity');
});

test('debug path: ExecCommand also eagerly syncs (this is the H2-via-dropdown bug we caught)', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'line1', initialHtml: '<p>line1</p>', dbg: true });
	editor.getContent = () => '<h2>line1</h2>';
	editor.fire('ExecCommand', { command: 'FormatBlock' });
	assert.equal(taValue(ctx), 'line1', 'text content is same (stripped HTML tags)');
	assert.ok(saveCount(ctx) >= 1);
});

// ---------------------------------------------------------------------------
// Guards: suppressed / readonly / hidden host / markdown mode
// ---------------------------------------------------------------------------

test('suppressed: SetContent from _setTinyMCEContent-style load does NOT sync in either path', () => {
	for (const dbg of [false, true]) {
		const { ctx, editor } = makeSandbox({ initialTaValue: 'orig', initialHtml: '<p>orig</p>', dbg });
		vm.runInContext('_tinymceSuppressEdits = true;', ctx);
		editor.setContent('<p>from server</p>');
		assert.equal(taValue(ctx), 'orig', `dbg=${dbg}: suppressed setContent must not sync`);
		assert.equal(saveCount(ctx), 0, `dbg=${dbg}: suppressed setContent must not schedule`);
	}
});

test('readonly: no sync, no scheduleSave in either path', () => {
	for (const dbg of [false, true]) {
		const { ctx, editor } = makeSandbox({ initialTaValue: 'orig', initialHtml: '<p>orig</p>', dbg });
		vm.runInContext('_tinymceReadonly = true;', ctx);
		editor.getContent = () => '<p>tampered</p>';
		editor.fire('ExecCommand', { command: 'FormatBlock' });
		assert.equal(taValue(ctx), 'orig', `dbg=${dbg}: readonly must not sync`);
		assert.equal(saveCount(ctx), 0, `dbg=${dbg}: readonly must not schedule`);
	}
});

test('_lazyTinyMCESyncBeforeSave: no-op in markdown mode (CM6 owns the sync)', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', editorMode: 'markdown' });
	editor.getContent = () => '<p>changed by tinymce ghost</p>';
	const changed = vm.runInContext('_lazyTinyMCESyncBeforeSave()', ctx);
	assert.equal(changed, false, 'markdown mode must skip lazy sync');
	assert.equal(taValue(ctx), 'hello', 'markdown mode textarea untouched');
});

test('_lazyTinyMCESyncBeforeSave: no-op when TinyMCE host is hidden', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>' });
	vm.runInContext('document.getElementById("tinymce-host").classList.remove("tinymce-host-visible")', ctx);
	editor.getContent = () => '<p>changed</p>';
	const changed = vm.runInContext('_lazyTinyMCESyncBeforeSave()', ctx);
	assert.equal(changed, false);
	assert.equal(taValue(ctx), 'hello');
});

test('_lazyTinyMCESyncBeforeSave: no-op when suppressed or readonly', () => {
	{
		const { ctx, editor } = makeSandbox({ initialHtml: '<p>x</p>' });
		vm.runInContext('_tinymceSuppressEdits = true;', ctx);
		editor.getContent = () => '<p>y</p>';
		assert.equal(vm.runInContext('_lazyTinyMCESyncBeforeSave()', ctx), false);
	}
	{
		const { ctx, editor } = makeSandbox({ initialHtml: '<p>x</p>' });
		vm.runInContext('_tinymceReadonly = true;', ctx);
		editor.getContent = () => '<p>y</p>';
		assert.equal(vm.runInContext('_lazyTinyMCESyncBeforeSave()', ctx), false);
	}
});

// ---------------------------------------------------------------------------
// Static wiring guards: keep the four listeners in app.js source AND keep the
// lazy sync wired into scheduleSave + scheduleSaveTitle + _activeEditorIsDirty
// ---------------------------------------------------------------------------

test('app.js: onEdit is wired to all four TinyMCE event names', () => {
	for (const evt of ['input', 'change', 'ExecCommand', 'SetContent']) {
		assert.ok(
			appSrc.includes(`editor.on('${evt}',onEdit)`),
			`onEdit must be wired to '${evt}' — otherwise a class of TinyMCE mutations goes unsynced`
		);
	}
});

test('app.js: _lazyTinyMCESyncBeforeSave is called from scheduleSave before hashing', () => {
	// scheduleSave's setTimeout body must call _lazyTinyMCESyncBeforeSave()
	// BEFORE formHash(form). If it runs after, hash reflects stale textarea.
	const src = extractFn('scheduleSave');
	const syncIdx = src.indexOf('_lazyTinyMCESyncBeforeSave()');
	const hashIdx = src.indexOf('formHash(form)');
	assert.ok(syncIdx !== -1, 'scheduleSave must call _lazyTinyMCESyncBeforeSave');
	assert.ok(hashIdx !== -1);
	assert.ok(syncIdx < hashIdx, 'lazy sync must run BEFORE formHash — otherwise fast path saves are silently skipped');
});

test('app.js: _activeEditorIsDirty calls _lazyTinyMCESyncBeforeSave before formHash comparison', () => {
	const src = extractFn('_activeEditorIsDirty');
	const syncIdx = src.indexOf('_lazyTinyMCESyncBeforeSave()');
	const hashIdx = src.indexOf('formHash(form)');
	assert.ok(syncIdx !== -1 && hashIdx !== -1 && syncIdx < hashIdx,
		'_activeEditorIsDirty must lazily sync before comparing formHash to _savedHash');
});

test('app.js: scheduleSaveTitle also calls _lazyTinyMCESyncBeforeSave', () => {
	// scheduleSaveTitle is a one-liner (minified), so grep the raw source.
	const marker = 'scheduleSaveTitle';
	const idx = appSrc.indexOf('function ' + marker);
	assert.ok(idx !== -1);
	const region = appSrc.slice(idx, idx + 800);
	assert.ok(region.includes('_lazyTinyMCESyncBeforeSave'),
		'scheduleSaveTitle must also lazily sync — title edits still need the body current');
});

test('app.js: _setTinyMCEContent still wraps setContent in _tinymceSuppressEdits', () => {
	const start = appSrc.indexOf('function _setTinyMCEContent(');
	assert.ok(start !== -1);
	let depth = 0, i = start;
	while (i < appSrc.length) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) break; }
		i++;
	}
	const src = appSrc.slice(start, i + 1);
	const setTrue = src.indexOf('_tinymceSuppressEdits=true');
	const setContent = src.indexOf('.setContent(');
	const setFalse = src.indexOf('_tinymceSuppressEdits=false');
	assert.ok(setTrue !== -1 && setContent !== -1 && setFalse !== -1);
	assert.ok(setTrue < setContent, 'suppress=true must run BEFORE setContent()');
	assert.ok(setFalse > setContent, 'suppress=false must run AFTER setContent()');
});


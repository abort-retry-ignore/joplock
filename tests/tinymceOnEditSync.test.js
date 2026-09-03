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
	const marker = 'function onEdit(evtName){';
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
			<form id="note-editor-form" hx-put="/fragments/editor/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
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
		_tinymcePostLoad: false,
		_tinymcePostLoadUntil: 0,
		_tinymceUserTypedSinceLoad: false,
		_editorMode: editorMode,
		_tinymceContentNoteId: '',
		_dbg: !!dbg,
		_saveScheduled: 0,
		_editedMarked: 0,
		_autoTitleCalled: 0,
		_logs: [],
	});

	vm.runInContext(`
		function activeEditorForm(){return document.getElementById('note-editor-form')}
		function _formNoteId(form){var hx=(form&&form.getAttribute&&form.getAttribute('hx-put'))||'';var m=hx.match(new RegExp("/fragments/editor/([0-9a-zA-Z]{32})"));return m?m[1]:''}
		function queryActiveEditor(sel){var f=activeEditorForm();return f?f.querySelector(sel):null}
		function getTA(){return queryActiveEditor('#note-body')}
		function tinymceToMarkdown(html){return String(html||'').replace(/<[^>]+>/g,'')}
		function markEdited(){_editedMarked++}
		function scheduleSave(){_saveScheduled++}
		function snapshotHash(){}
		function _log(){_logs.push(Array.from(arguments).join(' '))}
		function _dbgline(){_logs.push('[dbg] '+Array.from(arguments).join(' '))}
		function autoTitleFromTinyMCE(){_autoTitleCalled++}
	`, ctx);

	vm.runInContext(extractFn('_lazyTinyMCESyncBeforeSave'), ctx);
	vm.runInContext(`function onEdit(evtName){${extractOnEditBody()}}`, ctx);
	vm.runInContext(`editor.on('ExecCommand',function(e){onEdit('ExecCommand')}); editor.on('SetContent',function(){onEdit('SetContent')}); editor.on('input',function(){onEdit('input')}); editor.on('change',function(){onEdit('change')});`, ctx);

	return { ctx, editor, dom };
}

function taValue(ctx) { return vm.runInContext('document.getElementById("note-body").value', ctx); }
function saveCount(ctx) { return vm.runInContext('_saveScheduled', ctx); }
function editedCount(ctx) { return vm.runInContext('_editedMarked', ctx); }
function autoTitleCount(ctx) { return vm.runInContext('_autoTitleCalled', ctx); }

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
// Regression: commit ffb7bd0 ("Fix TinyMCE autosave sync + shell-mode
// readonly + FormatBlock partial split") optimised onEdit() to skip the
// per-event tinymceToMarkdown() conversion (moved to the debounced
// scheduleSave timer instead). The OLD onEdit() used to dispatch an 'input'
// event on #note-body on every change, which is what triggered autoTitle()
// (wired via ta.addEventListener('input', autoTitle) in initEditorPanel).
// Removing that per-edit dispatch silently broke title auto-fill for
// rendered/TinyMCE mode (it kept working in markdown mode, where CM6's
// onUpdate calls autoTitle() directly). Fixed by calling a cheap, DOM-only
// autoTitleFromTinyMCE(editor) directly from onEdit's fast path, instead of
// relying on a synthetic textarea 'input' event.
// ---------------------------------------------------------------------------

test('fast path: onEdit calls autoTitleFromTinyMCE on every real edit', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(autoTitleCount(ctx), 1, 'onEdit must call autoTitleFromTinyMCE so rendered-mode titles auto-fill');
	editor.fire('change');
	assert.equal(autoTitleCount(ctx), 2, 'autoTitleFromTinyMCE must be called on every qualifying onEdit invocation');
});

test('fast path: autoTitleFromTinyMCE is NOT called during the post-load suppression window', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	vm.runInContext('_tinymcePostLoad = true; _tinymcePostLoadUntil = Date.now() + 10000;', ctx);
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(autoTitleCount(ctx), 0, 'post-load noise must not trigger title auto-fill');
});

test('fast path: phantom input during post-load window is consumed + rebaselined (no save)', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	vm.runInContext('_tinymcePostLoad = true; _tinymcePostLoadUntil = Date.now() + 10000;', ctx);
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(saveCount(ctx), 0, 'load-normalisation noise must not schedule a save');
	assert.equal(editedCount(ctx), 0, 'load-normalisation noise must not mark edited');
});

test('fast path: real user keystrokes during post-load window ARE saved (no silent loss)', () => {
	// Regression: text typed within ~800ms of opening a note used to be
	// swallowed by the quiet window; the recaptured baseline then included the
	// typed text so every later hash check short-circuited to a bogus "Saved"
	// and the text never reached the server (search-esc e2e caught it).
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	vm.runInContext('_tinymcePostLoad = true; _tinymcePostLoadUntil = Date.now() + 10000; _tinymceUserTypedSinceLoad = true;', ctx);
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(saveCount(ctx), 1, 'user keystroke during quiet window must schedule a save');
	assert.equal(editedCount(ctx), 1, 'user keystroke during quiet window must mark edited');
	assert.equal(taValue(ctx), 'hello', 'window path must not eagerly sync (lazy sync runs in scheduleSave timer)');
});

test('fast path: post-load window does not save for phantom events after real typing was reset by a new load', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: false });
	vm.runInContext('_tinymcePostLoad = true; _tinymcePostLoadUntil = Date.now() + 10000; _tinymceUserTypedSinceLoad = true; _tinymcePostLoad = false; _tinymceUserTypedSinceLoad = false;', ctx);
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(saveCount(ctx), 0, 'a fresh content load resets the user-typed flag; phantom input stays swallowed');
});

test('debug path: onEdit also calls autoTitleFromTinyMCE', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'hello', initialHtml: '<p>hello</p>', dbg: true });
	editor.getContent = () => '<p>hello world</p>';
	editor.fire('input');
	assert.equal(autoTitleCount(ctx), 1, 'autoTitleFromTinyMCE must fire in debug mode too');
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
	// Wiring uses small anonymous wrappers so we can pass an event-name label
	// to onEdit for debug logging; assert the wrapper form for each event.
	const patterns = {
		input: "editor.on('input',function(){onEdit(",
		change: "editor.on('change',function(){onEdit(",
		ExecCommand: "editor.on('ExecCommand',function(e){onEdit(",
		SetContent: "editor.on('SetContent',function(){onEdit(",
	};
	for (const [evt, needle] of Object.entries(patterns)) {
		assert.ok(
			appSrc.includes(needle),
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

test('app.js: onEdit calls autoTitleFromTinyMCE (rendered-mode title auto-fill regression guard)', () => {
	// Guards against silently re-breaking rendered-mode auto-title the way
	// commit ffb7bd0 did when it removed the per-edit textarea 'input' sync.
	const src = extractOnEditBody();
	assert.ok(src.includes('autoTitleFromTinyMCE('),
		'onEdit must call autoTitleFromTinyMCE — otherwise typing in TinyMCE (rendered mode) never auto-fills the note title');
});

test('app.js: _tinymceFirstBlockText / autoTitleFromTinyMCE exist and are DOM-only (no tinymceToMarkdown call)', () => {
	// autoTitleFromTinyMCE must stay cheap (read only the first block's text)
	// rather than reintroducing a full HTML->markdown conversion per
	// keystroke, which is exactly the cost onEdit's fast path was written to
	// avoid.
	const firstBlockSrc = extractFn('_tinymceFirstBlockText');
	assert.ok(!firstBlockSrc.includes('tinymceToMarkdown'),
		'_tinymceFirstBlockText must not call tinymceToMarkdown — it should stay a cheap DOM-only read');
	const autoTitleSrc = extractFn('autoTitleFromTinyMCE');
	assert.ok(autoTitleSrc.includes('_tinymceFirstBlockText'),
		'autoTitleFromTinyMCE must read via _tinymceFirstBlockText');
});


// ---------------------------------------------------------------------------
// Post-load reconcile: load normalisation must NOT be mistaken for a user edit
// ---------------------------------------------------------------------------

// Build a context that runs _setTinyMCEContent's reconcile with controllable timers.
function makeReconcileCtx({ userTyped, normalisedDiffers }) {
	const dom = new JSDOM('<!DOCTYPE html><body><form id="note-editor-form">'
		+ '<input name="body" value="stored" /></form></body>');
	const timers = [];
	const editor = {
		setContent() {},
		undoManager: { clear() {} },
		getBody: () => dom.window.document.body,
	};
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		Date,
		_tinymceEditor: editor,
		_tinymceSuppressEdits: false,
		_tinymceReadonly: false,
		_tinymcePostLoad: false,
		_tinymcePostLoadUntil: 0,
		_tinymceUserTypedSinceLoad: false,
		_pendingSearchHighlight: false,
		_tinymceContentNoteId: '',
		_displayedNoteId: '',
		_savedHash: 111,
		_edited: 0,
		_saved: 0,
		_snapshots: 0,
		_logs: [],
		setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
	});
	vm.runInContext(`
		function activeEditorForm(){return document.getElementById('note-editor-form')}
		function _formNoteId(form){var hx=(form&&form.getAttribute&&form.getAttribute('hx-put'))||'';var m=hx.match(new RegExp("/fragments/editor/([0-9a-zA-Z]{32})"));return m?m[1]:''}
		function _dbgline(){_logs.push(Array.from(arguments).join(' '))}
		function _log(){}
		function markEdited(){_edited++}
		function scheduleSave(){_saved++}
		function snapshotHash(){_snapshots++; _savedHash=formHash()}
		function formHash(){return ${normalisedDiffers ? 222 : 111}}
		function _lazyTinyMCESyncBeforeSave(){return true}
		function ensureTinyMCEEditableAfterPre(){}
		function initTinyMCECodeCopyButtons(){}
		function _applyTinyMCESpellcheck(){}
		function activeSearchTerm(){return ''}
		function applySearchHighlight(){}
	`, ctx);
	vm.runInContext(extractFn('_setTinyMCEContent'), ctx);
	vm.runInContext('_setTinyMCEContent("<p>x</p>")', ctx);
	if (userTyped) vm.runInContext('_tinymceUserTypedSinceLoad=true', ctx);
	// Run the 820ms reconcile callback (the last scheduled timer).
	const reconcile = timers.find(t => t.ms === 820);
	assert.ok(reconcile, 'expected a 820ms reconcile timer to be scheduled');
	reconcile.fn();
	return {
		edited: vm.runInContext('_edited', ctx),
		saved: vm.runInContext('_saved', ctx),
		snapshots: vm.runInContext('_snapshots', ctx),
		logs: vm.runInContext('_logs.join("|")', ctx),
	};
}

test('post-load reconcile: pure load normalisation re-baselines instead of flashing Edited', () => {
	// Reported bug: opening a note whose markdown is not round-trip identical
	// (indented ``` fence loses its indent, blank line after an ATX heading is
	// collapsed) flashed "Edited" and fired a useless autosave EVERY open.
	const r = makeReconcileCtx({ userTyped: false, normalisedDiffers: true });
	assert.equal(r.edited, 0, 'markEdited must not fire for load normalisation');
	assert.equal(r.saved, 0, 'no autosave may be scheduled for load normalisation');
	assert.equal(r.snapshots, 1, 'the normalised content must become the new clean baseline');
});

test('post-load reconcile: a real edit during the quiet window still saves', () => {
	// The reconcile exists so an edit absorbed by the 800ms post-load window is
	// not silently lost. That safety net must survive the fix above.
	const r = makeReconcileCtx({ userTyped: true, normalisedDiffers: true });
	assert.equal(r.edited, 1, 'a genuine edit must still mark the note edited');
	assert.equal(r.saved, 1, 'a genuine edit must still schedule a save');
});

test('post-load reconcile: identical content does nothing at all', () => {
	const r = makeReconcileCtx({ userTyped: false, normalisedDiffers: false });
	assert.equal(r.edited, 0);
	assert.equal(r.saved, 0);
	assert.equal(r.snapshots, 0);
});

test('app.js: user-typed flag is wired to keydown/paste/cut/drop, never to input/SetContent', () => {
	// editor.setContent() fires 'input' and 'SetContent', so those events cannot
	// be used to detect real user interaction — using them would reintroduce the
	// phantom "Edited" on open.
	const idx = appSrc.indexOf('_tinymceUserTypedSinceLoad=true');
	assert.ok(idx !== -1, '_tinymceUserTypedSinceLoad must be set somewhere');
	for (const evt of ['keydown', 'paste', 'cut', 'drop']) {
		assert.ok(new RegExp(`editor\\.on\\('${evt}'`).test(appSrc),
			`expected an editor.on('${evt}') handler to exist`);
	}
	const setLine = appSrc.slice(appSrc.lastIndexOf('\n', idx - 200), idx + 40);
	assert.ok(!/editor\.on\('(?:input|SetContent)'[^)]*\)\s*\{[^}]*_tinymceUserTypedSinceLoad=true/.test(setLine),
		'_tinymceUserTypedSinceLoad must not be set from input/SetContent handlers');
	assert.ok(extractFn('_setTinyMCEContent').includes('_tinymceUserTypedSinceLoad=false'),
		'_setTinyMCEContent must reset the user-typed flag on every programmatic load');
});

test('provenance: _lazyTinyMCESyncBeforeSave refuses to sync foreign TinyMCE content into the active note', () => {
	const { ctx, editor } = makeSandbox({ initialTaValue: 'own note', initialHtml: '<p>x</p>', dbg: false });
	// TinyMCE was last loaded with ANOTHER note's content (late preview response landed after a switch).
	vm.runInContext('_tinymceContentNoteId=' + JSON.stringify('b'.repeat(32)), ctx);
	editor.getContent = () => '<p>foreign content</p>';
	const changed = vm.runInContext('_lazyTinyMCESyncBeforeSave()', ctx);
	assert.equal(changed, false, 'sync must refuse when TinyMCE provenance != active note');
	assert.equal(taValue(ctx), 'own note', 'foreign content must NOT reach the textarea');
});

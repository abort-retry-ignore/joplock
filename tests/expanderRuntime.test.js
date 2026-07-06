/**
 * Tests for the text-expander + AI-autocomplete runtime after the TinyMCE/CM6 migration.
 *
 * Two live wiring points exist:
 *   - Markdown mode (CM6): maybeExpandTextFromCM() -> runTextExpanderAction('cm')
 *       - text triggers  -> replaceCMTextExpansion()
 *       - AI triggers    -> removeCMTriggerForAction() + requestManualProseCompletion()
 *   - Rendered mode (TinyMCE): maybeExpandTextFromTinyMCE() -> replaceTinyMCETextExpansion()
 *       - text triggers  -> replace trigger in the iframe DOM
 *       - AI triggers    -> intentionally SKIPPED (logged expander.tinymce.skip)
 *
 * These tests drive the real functions extracted from public/app.js against
 * JSDOM + lightweight mock editors, exercising behaviour rather than source strings.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// Extract a named function's source text from app.js (handles minified single-line functions).
function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `function ${name} not found in app.js`);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error(`Could not find closing brace for function ${name}`);
}

// ---------------------------------------------------------------------------
// Shared harness: build a context with the expander runtime + configurable
// editor mode, expanders, and mock CM / TinyMCE editors.
// ---------------------------------------------------------------------------

function makeCtx({ mode = 'markdown', expanders = [], cmDoc = '', tinymce = null, openRouterEnabled = true } = {}) {
	const dom = new JSDOM(
		'<!DOCTYPE html><body><form id="note-editor-form">' +
		'<textarea id="note-body"></textarea>' +
		// #cm-host visible => isMarkdownVisible() true in markdown mode.
		'<div id="cm-host" style="display:' + (mode === 'markdown' ? 'block' : 'none') + '"></div>' +
		'<div id="note-preview" style="display:none"></div>' +
		'</form></body>',
		{ url: 'https://joplock.test' },
	);

	// Mock CodeMirror EditorView.
	let doc = cmDoc;
	let caret = cmDoc.length;
	const dispatched = [];
	const mockCM = {
		focus() {},
		get state() {
			return {
				selection: { main: { from: caret, to: caret, head: caret, empty: true } },
				sliceDoc: (a, b) => doc.slice(a, b),
				doc: { toString: () => doc, length: doc.length },
			};
		},
		dispatch(tr) {
			dispatched.push(tr);
			if (tr.changes) {
				const { from, to, insert } = tr.changes;
				doc = doc.slice(0, from) + (insert || '') + doc.slice(to == null ? from : to);
			}
			if (tr.selection && typeof tr.selection.anchor === 'number') caret = tr.selection.anchor;
		},
		coordsAtPos() { return { top: 0, left: 0, height: 18 }; },
	};

	const clientLogs = [];
	const proseCalls = [];
	const proseReqs = [];
	const popupCalls = [];

	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		Promise,
		console: { info() {}, warn() {}, error() {} },
		_cmView: mode === 'markdown' ? mockCM : null,
		_tinymceEditor: tinymce,
		_editorMode: mode,
		_openRouterEnabled: openRouterEnabled,
		_manualProseCompletionInFlight: false,
		_pendingTextExpansion: null,
		_textExpanders: expanders,
		_tinymceSuppressEdits: false,
		_clientLog(event, data) { clientLogs.push({ event, data }); },
		markEdited() {},
		scheduleSave() {},
		tinyMCESyncToTA() { ctx._tinyMCESynced = true; return true; },
		requestManualProseCompletion(opts) { proseCalls.push(opts || {}); return true; },
		// Mock AI provider call for the TinyMCE path. Records prompts and returns
		// a configurable completion (default fixed string).
		requestProseCompletion(prompt, force, profileId) {
			proseReqs.push({ prompt, force, profileId });
			return Promise.resolve(ctx._proseReply == null ? 'AI COMPLETION' : ctx._proseReply);
		},
		// Capture popup invocations instead of building real DOM.
		showRenderAutocompletePopup(coords, items, kind, state) {
			popupCalls.push({ coords, items, kind, state });
			ctx._activeRenderPopupKind = kind;
			ctx._activeRenderPopupState = state;
			ctx._popupItems = items;
		},
		// test observability
		_clientLogs: clientLogs,
		_proseCalls: proseCalls,
		_proseReqs: proseReqs,
		_popupCalls: popupCalls,
		_proseReply: null,
		_setCaret(n) { caret = n; },
		_getDoc() { return doc; },
		_dispatched: dispatched,
	});

	vm.runInContext(
		'function activeEditorForm(){return document.getElementById("note-editor-form")}' +
		'function queryActiveEditor(sel){var f=activeEditorForm();return f&&f.querySelector?f.querySelector(sel):null}' +
		'function getTA(){return queryActiveEditor("#note-body")}',
		ctx,
	);
	vm.runInContext(extractFn('getCM'), ctx);
	vm.runInContext(extractFn('getTinyMCE'), ctx);
	vm.runInContext(extractFn('getPV'), ctx);
	vm.runInContext(extractFn('isMarkdownVisible'), ctx);
	vm.runInContext(extractFn('replaceCMTextExpansion'), ctx);
	vm.runInContext(extractFn('removeCMTriggerForAction'), ctx);
	vm.runInContext(extractFn('replaceTinyMCETextExpansion'), ctx);
	vm.runInContext(extractFn('removeTinyMCETriggerForAction'), ctx);
	vm.runInContext(extractFn('getTextBeforeCaretTinyMCE'), ctx);
	vm.runInContext(extractFn('insertProseCompletionTinyMCE'), ctx);
	vm.runInContext(extractFn('tinyMCECaretCoords'), ctx);
	vm.runInContext(extractFn('requestTinyMCEProseCompletion'), ctx);
	vm.runInContext(extractFn('maybeExpandTextFromTinyMCE'), ctx);
	vm.runInContext(extractFn('maybeExpandTextFromCM'), ctx);
	vm.runInContext(extractFn('runTextExpanderAction'), ctx);
	// replacePVTextExpansion / removePVTriggerForAction are the dead preview path;
	// stub them so runTextExpanderAction('cm') never accidentally reaches them.
	vm.runInContext('function replacePVTextExpansion(){return false}function removePVTriggerForAction(){return null}', ctx);
	vm.runInContext('function _resetRingBuffer(){}', ctx);
	return ctx;
}

// Build a mock TinyMCE editor over a JSDOM document whose body holds `html`.
// Caret is placed at `caretOffset` inside the first text node of the element
// matching `selector` (default: last text node in body). getRng() returns a
// REAL jsdom Range so the DOM insertion/deletion paths run for real.
function makeMockTinyMCE(html, { selector = null, caretOffset = null } = {}) {
	const idom = new JSDOM('<!DOCTYPE html><body>' + html + '</body>', { url: 'https://joplock.test' });
	const idoc = idom.window.document;
	let container;
	if (selector) {
		const el = idoc.querySelector(selector);
		container = el && el.firstChild ? el.firstChild : el;
	} else {
		// Walk to the last text node.
		const walker = idoc.createTreeWalker(idoc.body, idom.window.NodeFilter.SHOW_TEXT);
		let last = null, n;
		while ((n = walker.nextNode())) last = n;
		container = last;
	}
	const offset = caretOffset == null ? (container && container.textContent ? container.textContent.length : 0) : caretOffset;
	let currentRng = idoc.createRange();
	currentRng.setStart(container, offset);
	currentRng.collapse(true);
	const focused = { count: 0 };
	const ed = {
		selection: {
			getRng() { return currentRng; },
			setRng(r) { currentRng = r; ed._lastSetRng = r; },
			// Minimal bookmark: remember the current range; restore on moveToBookmark.
			getBookmark() { ed._bm = currentRng.cloneRange(); return { _bm: true }; },
			moveToBookmark() { if (ed._bm) currentRng = ed._bm; ed._movedToBookmark = true; },
		},
		// A fake iframe element so tinyMCECaretCoords can compute an offset.
		iframeElement: { getBoundingClientRect: () => ({ left: 40, top: 100, width: 800, height: 600 }) },
		getDoc() { return idoc; },
		getBody() { return idoc.body; },
		insertContent(h) {
			// Minimal insertContent: replace the range with parsed HTML.
			currentRng.deleteContents();
			const tpl = idoc.createElement('template');
			tpl.innerHTML = h;
			currentRng.insertNode(tpl.content);
		},
		focus() { focused.count++; },
		getContent() { return idoc.body.innerHTML; },
		_idoc: idoc,
		_focused: focused,
	};
	return ed;
}

// ---------------------------------------------------------------------------
// detectTextExpanderFromBuffer (ring-buffer suffix detection)
// ---------------------------------------------------------------------------

function makeBufferCtx(expanders) {
	const ctx = vm.createContext({ _textExpanders: expanders });
	vm.runInContext(extractFn('createInputRingBuffer'), ctx);
	vm.runInContext(extractFn('detectTextExpanderFromBuffer'), ctx);
	vm.runInContext('var _buf=createInputRingBuffer(15);', ctx);
	return ctx;
}

test('detectTextExpanderFromBuffer matches a trigger at the buffer tail', () => {
	const ctx = makeBufferCtx([{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }]);
	vm.runInContext('"a b ;br".split("").forEach(function(c){_buf.push(c)})', ctx);
	const hit = vm.runInContext('detectTextExpanderFromBuffer(_buf)', ctx);
	assert.ok(hit, 'trigger at tail must be detected');
	assert.equal(hit.trigger, ';br');
});

test('detectTextExpanderFromBuffer returns null when tail does not end with a trigger', () => {
	const ctx = makeBufferCtx([{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }]);
	vm.runInContext('";br x".split("").forEach(function(c){_buf.push(c)})', ctx);
	const hit = vm.runInContext('detectTextExpanderFromBuffer(_buf)', ctx);
	assert.equal(hit, null);
});

test('detectTextExpanderFromBuffer prefers the longest matching trigger', () => {
	const ctx = makeBufferCtx([
		{ id: '1', trigger: ';b', action: 'text', text: 'short', profileId: '' },
		{ id: '2', trigger: ';br', action: 'text', text: 'long', profileId: '' },
	]);
	vm.runInContext('";br".split("").forEach(function(c){_buf.push(c)})', ctx);
	const hit = vm.runInContext('detectTextExpanderFromBuffer(_buf)', ctx);
	assert.equal(hit.trigger, ';br', 'longest trigger wins so ;b does not shadow ;br');
});

// ---------------------------------------------------------------------------
// CM6 (markdown mode) text-trigger expansion
// ---------------------------------------------------------------------------

test('maybeExpandTextFromCM replaces a text trigger with its expansion', () => {
	const ctx = makeCtx({
		mode: 'markdown',
		cmDoc: 'hello ;br',
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromCM(getCM())', ctx);
	assert.equal(ok, true, 'expansion must succeed');
	assert.equal(ctx._getDoc(), 'hello best regards', 'trigger replaced by expansion text');
});

test('maybeExpandTextFromCM does nothing when the caret suffix is not a trigger', () => {
	const ctx = makeCtx({
		mode: 'markdown',
		cmDoc: 'hello world',
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromCM(getCM())', ctx);
	assert.equal(ok, false);
	assert.equal(ctx._getDoc(), 'hello world', 'document unchanged');
});

test('maybeExpandTextFromCM leaves an empty expander list untouched', () => {
	const ctx = makeCtx({ mode: 'markdown', cmDoc: 'hello ;br', expanders: [] });
	const ok = vm.runInContext('maybeExpandTextFromCM(getCM())', ctx);
	assert.equal(ok, false);
});

test('replaceCMTextExpansion only fires when the caret sits right after the trigger', () => {
	const ctx = makeCtx({
		mode: 'markdown',
		cmDoc: 'x ;br yz',
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'EXP', profileId: '' }],
	});
	// Move caret to end (after "yz") so trigger is not immediately before caret.
	vm.runInContext('_setCaret(_getDoc().length)', ctx);
	const ok = vm.runInContext('replaceCMTextExpansion(_textExpanders[0])', ctx);
	assert.equal(ok, false, 'must not replace when trigger is not adjacent to caret');
});

// ---------------------------------------------------------------------------
// CM6 (markdown mode) AI-trigger expansion
// ---------------------------------------------------------------------------

test('maybeExpandTextFromCM: AI trigger removes trigger and launches prose completion', () => {
	const ctx = makeCtx({
		mode: 'markdown',
		cmDoc: 'once upon a time ;ai',
		expanders: [{ id: '1', trigger: ';ai', action: 'ai', text: '', profileId: 'p1' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromCM(getCM())', ctx);
	assert.equal(ok, true, 'AI trigger must be handled');
	assert.equal(ctx._getDoc(), 'once upon a time ', 'AI trigger text is removed');
	assert.equal(ctx._proseCalls.length, 1, 'prose completion must be requested once');
	assert.equal(ctx._proseCalls[0].profileId, 'p1', 'profileId forwarded to prose completion');
	assert.equal(ctx._proseCalls[0].allowWithoutCtrlSpace, true);
	assert.ok(ctx._proseCalls[0].cmRange, 'a cmRange must be passed for insertion positioning');
});

test('maybeExpandTextFromCM: AI trigger is skipped when OpenRouter/AI is disabled', () => {
	const ctx = makeCtx({
		mode: 'markdown',
		cmDoc: 'plenty of context here ;ai',
		expanders: [{ id: '1', trigger: ';ai', action: 'ai', text: '', profileId: '' }],
		openRouterEnabled: false,
	});
	const ok = vm.runInContext('maybeExpandTextFromCM(getCM())', ctx);
	assert.equal(ok, false, 'AI trigger must not fire when AI disabled');
	assert.equal(ctx._proseCalls.length, 0, 'no prose completion requested');
	// The trigger must remain (removeCMTriggerForAction is never reached).
	assert.equal(ctx._getDoc(), 'plenty of context here ;ai', 'trigger left intact when AI disabled');
});

test('runTextExpanderAction routes text triggers to replaceCMTextExpansion in cm source', () => {
	const ctx = makeCtx({
		mode: 'markdown',
		cmDoc: 'foo ;br',
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'BAR', profileId: '' }],
	});
	const ok = vm.runInContext("runTextExpanderAction(_textExpanders[0],'cm')", ctx);
	assert.equal(ok, true);
	assert.equal(ctx._getDoc(), 'foo BAR');
});

// ---------------------------------------------------------------------------
// TinyMCE (rendered mode) text-trigger expansion
// ---------------------------------------------------------------------------

test('maybeExpandTextFromTinyMCE replaces a text trigger inside the iframe body', () => {
	const ed = makeMockTinyMCE('<p>hello ;br</p>');
	const ctx = makeCtx({
		mode: 'rich',
		tinymce: ed,
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromTinyMCE(_tinymceEditor)', ctx);
	assert.equal(ok, true, 'text trigger must expand in rendered mode');
	assert.equal(ed._idoc.body.textContent, 'hello best regards', 'trigger replaced in iframe DOM');
	assert.equal(ctx._tinyMCESynced, true, 'expansion must sync back to the markdown textarea');
});

test('replaceTinyMCETextExpansion turns a multi-line expansion into <br>-separated lines', () => {
	const ed = makeMockTinyMCE('<p>sig;sig</p>');
	const ctx = makeCtx({
		mode: 'rich',
		tinymce: ed,
		expanders: [{ id: '1', trigger: ';sig', action: 'text', text: 'Jane Doe\nCEO', profileId: '' }],
	});
	// Caret is at end of "sig;sig" (offset 7). Trigger ";sig" -> "Jane Doe<br>CEO".
	const ok = vm.runInContext('replaceTinyMCETextExpansion(_textExpanders[0], _tinymceEditor)', ctx);
	assert.equal(ok, true);
	const inner = ed._idoc.body.querySelector('p').innerHTML;
	assert.ok(inner.includes('<br>'), 'multi-line expansion must contain a <br>');
	assert.equal(ed._idoc.body.textContent.replace(/\s+/g, ' ').trim(), 'sigJane DoeCEO');
});

test('replaceTinyMCETextExpansion refuses to expand inside a code/pre block', () => {
	const ed = makeMockTinyMCE('<pre><code>let x = ;br</code></pre>', { selector: 'code' });
	const ctx = makeCtx({
		mode: 'rich',
		tinymce: ed,
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	const ok = vm.runInContext('replaceTinyMCETextExpansion(_textExpanders[0], _tinymceEditor)', ctx);
	assert.equal(ok, false, 'must not expand inside code');
	assert.ok(ed._idoc.body.textContent.includes(';br'), 'trigger preserved inside code block');
});

test('maybeExpandTextFromTinyMCE does nothing when caret suffix is not a trigger', () => {
	const ed = makeMockTinyMCE('<p>nothing to expand</p>');
	const ctx = makeCtx({
		mode: 'rich',
		tinymce: ed,
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromTinyMCE(_tinymceEditor)', ctx);
	assert.equal(ok, false);
	assert.equal(ed._idoc.body.textContent, 'nothing to expand', 'unchanged');
});

// ---------------------------------------------------------------------------
// TinyMCE (rendered mode) AI-trigger behaviour: now WIRED (was skipped).
// ---------------------------------------------------------------------------

test('maybeExpandTextFromTinyMCE fires an AI trigger: removes trigger + requests completion', async () => {
	const ed = makeMockTinyMCE('<p>Once upon a time there was a fox ;ai</p>');
	const ctx = makeCtx({
		mode: 'rich',
		tinymce: ed,
		expanders: [{ id: '1', trigger: ';ai', action: 'ai', text: '', profileId: 'p1' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromTinyMCE(_tinymceEditor)', ctx);
	assert.equal(ok, true, 'AI trigger must be handled in rendered mode');
	// Trigger is removed immediately (before the async provider call resolves).
	assert.ok(!ed._idoc.body.textContent.includes(';ai'), 'AI trigger text must be removed');
	assert.equal(ctx._proseReqs.length, 1, 'a prose completion must be requested');
	assert.equal(ctx._proseReqs[0].profileId, 'p1', 'profileId forwarded to the provider call');
	assert.ok(ctx._proseReqs[0].prompt.includes('Once upon a time'), 'prompt built from text before caret');
	assert.ok(!ctx._proseReqs[0].prompt.includes(';ai'), 'trigger must not leak into the prompt');
	const trigLog = ctx._clientLogs.find(l => l.event === 'expander.tinymce.ai.trigger');
	assert.ok(trigLog, 'must log expander.tinymce.ai.trigger');
	// Let the mocked provider promise resolve, then assert a popup is offered
	// (NOT inserted directly — the user gets an accept/dismiss choice).
	await new Promise(r => setImmediate(r));
	assert.equal(ctx._popupCalls.length, 1, 'an autocomplete popup must be shown');
	assert.equal(ctx._popupCalls[0].kind, 'tinymce-prose', 'popup kind must be tinymce-prose');
	assert.equal(ctx._popupCalls[0].items[0].text, 'AI COMPLETION', 'popup offers the completion text');
	assert.ok(!ed._idoc.body.textContent.includes('AI COMPLETION'), 'completion must NOT be inserted until accepted');
	const popupLog = ctx._clientLogs.find(l => l.event === 'expander.tinymce.ai.popup');
	assert.ok(popupLog, 'must log expander.tinymce.ai.popup');
});

test('maybeExpandTextFromTinyMCE AI trigger is blocked when AI is disabled', () => {
	const ed = makeMockTinyMCE('<p>Plenty of context to satisfy the minimum ;ai</p>');
	const ctx = makeCtx({
		mode: 'rich',
		tinymce: ed,
		openRouterEnabled: false,
		expanders: [{ id: '1', trigger: ';ai', action: 'ai', text: '', profileId: '' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromTinyMCE(_tinymceEditor)', ctx);
	assert.equal(ok, false, 'AI trigger must not fire when AI disabled');
	assert.equal(ctx._proseReqs.length, 0, 'no provider request');
	assert.ok(ed._idoc.body.textContent.includes(';ai'), 'trigger left intact when AI disabled');
	const skip = ctx._clientLogs.find(l => l.event === 'expander.tinymce.skip' && l.data.reason === 'ai-blocked');
	assert.ok(skip, 'must log a blocked-AI skip diagnostic');
});

test('requestTinyMCEProseCompletion skips when the prompt is too short (<20 chars)', () => {
	const ed = makeMockTinyMCE('<p>short</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	const ok = vm.runInContext('requestTinyMCEProseCompletion({editor:_tinymceEditor})', ctx);
	assert.equal(ok, false, 'must skip a too-short prompt');
	assert.equal(ctx._proseReqs.length, 0, 'no provider request for a short prompt');
});

test('Ctrl-Space path (requestTinyMCEProseCompletion) shows an accept/dismiss popup', async () => {
	const ed = makeMockTinyMCE('<p>This is a long enough prompt to pass the minimum length gate</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	const ok = vm.runInContext('requestTinyMCEProseCompletion({editor:_tinymceEditor})', ctx);
	assert.equal(ok, true, 'request accepted');
	await new Promise(r => setImmediate(r));
	assert.equal(ctx._popupCalls.length, 1, 'popup shown for Ctrl-Space completion');
	assert.equal(ctx._popupCalls[0].kind, 'tinymce-prose');
	assert.ok(ctx._popupCalls[0].state.editor, 'popup state carries the editor');
	assert.ok(!ed._idoc.body.textContent.includes('AI COMPLETION'), 'not inserted until accepted');
});

test('tinyMCECaretCoords offsets the iframe rect into viewport coordinates', () => {
	const ed = makeMockTinyMCE('<p>hello world here</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	const coords = vm.runInContext('tinyMCECaretCoords(_tinymceEditor)', ctx);
	assert.ok(coords, 'coords returned');
	// jsdom rects are zero, so coords equal the mock iframe offset (left 40, top 100).
	assert.equal(coords.left, 40, 'left offset by iframe rect');
	assert.equal(coords.top, 100, 'top offset by iframe rect');
});

test('accepting a tinymce-prose popup inserts the completion at the bookmarked caret', () => {
	const ed = makeMockTinyMCE('<p>lead in text that is plenty long</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	vm.runInContext(extractFn('applyActiveAutocompleteSelection'), ctx);
	// Simulate the popup being open with a tinymce-prose state (as requestTinyMCE… would set).
	vm.runInContext(
		'_activeRenderPopupKind="tinymce-prose";' +
		'_activeRenderPopupState={editor:_tinymceEditor,bookmark:_tinymceEditor.selection.getBookmark(2)};',
		ctx,
	);
	vm.runInContext("applyActiveAutocompleteSelection({text:'GENERATED PROSE'})", ctx);
	assert.ok(ed._idoc.body.textContent.includes('GENERATED PROSE'), 'accepted completion is inserted');
	assert.equal(ed._movedToBookmark, true, 'insertion restores the caret bookmark first');
	assert.equal(ctx._tinyMCESynced, true, 'insertion syncs to the markdown textarea');
});

test('handleRenderPopupKey: Escape dismisses without inserting; Enter accepts', () => {
	const ed = makeMockTinyMCE('<p>enough context here for the gate</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	vm.runInContext(extractFn('applyActiveAutocompleteSelection'), ctx);
	vm.runInContext(extractFn('hideRenderAutocompletePopup'), ctx);
	vm.runInContext(extractFn('updateRenderPopupSelection'), ctx);
	vm.runInContext(extractFn('handleRenderPopupKey'), ctx);
	// Fake an active popup (no real DOM node needed for Escape/Enter branches).
	vm.runInContext(
		'_activeRenderPopup={querySelectorAll:function(){return []}};' +
		'_activeRenderPopupKind="tinymce-prose";' +
		'_activeRenderPopupState={editor:_tinymceEditor,bookmark:_tinymceEditor.selection.getBookmark(2)};' +
		'_popupItems=[{text:"SHOULD NOT INSERT"}];_popupSelectedIndex=0;',
		ctx,
	);
	// Escape: dismiss, nothing inserted.
	const escHandled = vm.runInContext("handleRenderPopupKey({key:'Escape',preventDefault:function(){},stopPropagation:function(){}})", ctx);
	assert.equal(escHandled, true, 'Escape is consumed by the popup');
	assert.equal(vm.runInContext('_activeRenderPopup', ctx), null, 'popup dismissed');
	assert.ok(!ed._idoc.body.textContent.includes('SHOULD NOT INSERT'), 'Escape must not insert anything');

	// Now Enter accepts and inserts.
	vm.runInContext(
		'_activeRenderPopup={querySelectorAll:function(){return []}};' +
		'_activeRenderPopupKind="tinymce-prose";' +
		'_activeRenderPopupState={editor:_tinymceEditor,bookmark:_tinymceEditor.selection.getBookmark(2)};' +
		'_popupItems=[{text:"ACCEPTED PROSE"}];_popupSelectedIndex=0;',
		ctx,
	);
	const enterHandled = vm.runInContext("handleRenderPopupKey({key:'Enter',preventDefault:function(){},stopPropagation:function(){}})", ctx);
	assert.equal(enterHandled, true, 'Enter is consumed by the popup');
	assert.ok(ed._idoc.body.textContent.includes('ACCEPTED PROSE'), 'Enter inserts the completion');
});

test('getTextBeforeCaretTinyMCE joins block boundaries with newlines', () => {
	const ed = makeMockTinyMCE('<p>first paragraph</p><p>second para here</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	const prompt = vm.runInContext('getTextBeforeCaretTinyMCE(_tinymceEditor)', ctx);
	assert.ok(prompt.includes('first paragraph'), 'includes earlier block text');
	assert.ok(prompt.includes('second para here'), 'includes the block up to the caret');
	assert.ok(/first paragraph\n/.test(prompt), 'block boundary becomes a newline');
});

test('insertProseCompletionTinyMCE inserts multi-line text as <br>-separated lines', () => {
	const ed = makeMockTinyMCE('<p>lead in text here</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	const ok = vm.runInContext("insertProseCompletionTinyMCE('line one\\nline two', _tinymceEditor)", ctx);
	assert.equal(ok, true);
	const inner = ed._idoc.body.querySelector('p').innerHTML;
	assert.ok(inner.includes('<br>'), 'multi-line completion must contain a <br>');
	assert.ok(ed._idoc.body.textContent.includes('line one'), 'line one inserted');
	assert.ok(ed._idoc.body.textContent.includes('line two'), 'line two inserted');
});

test('insertProseCompletionTinyMCE inserts provider text as DOM text (no HTML injection)', () => {
	const ed = makeMockTinyMCE('<p>lead in text here</p>');
	const ctx = makeCtx({ mode: 'rich', tinymce: ed, expanders: [] });
	vm.runInContext("insertProseCompletionTinyMCE('<b>bold</b> & <i>x</i>', _tinymceEditor)", ctx);
	// Angle brackets must be preserved as literal text, not parsed into elements.
	assert.equal(ed._idoc.body.querySelector('b'), null, 'no <b> element created from provider text');
	assert.ok(ed._idoc.body.textContent.includes('<b>bold</b>'), 'provider markup preserved as literal text');
});

test('maybeExpandTextFromTinyMCE still expands a text trigger even when an AI trigger also exists', () => {
	const ed = makeMockTinyMCE('<p>foo ;br</p>');
	const ctx = makeCtx({
		mode: 'rich',
		tinymce: ed,
		expanders: [
			{ id: '1', trigger: ';ai', action: 'ai', text: '', profileId: '' },
			{ id: '2', trigger: ';br', action: 'text', text: 'best regards', profileId: '' },
		],
	});
	const ok = vm.runInContext('maybeExpandTextFromTinyMCE(_tinymceEditor)', ctx);
	assert.equal(ok, true, 'the matching text trigger must still fire');
	assert.equal(ed._idoc.body.textContent, 'foo best regards');
});

// ---------------------------------------------------------------------------
// Mode guards: TinyMCE expander must not act while markdown mode is active,
// and CM expander must not act while it is not the visible editor.
// ---------------------------------------------------------------------------

test('maybeExpandTextFromTinyMCE is a no-op while editor is in markdown mode', () => {
	const ed = makeMockTinyMCE('<p>foo ;br</p>');
	const ctx = makeCtx({
		mode: 'markdown', // markdown mode active -> rendered expander must bail
		tinymce: ed,
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	const ok = vm.runInContext('maybeExpandTextFromTinyMCE(_tinymceEditor)', ctx);
	assert.equal(ok, false, 'rendered-mode expander must not run in markdown mode');
	assert.equal(ed._idoc.body.textContent, 'foo ;br', 'iframe untouched');
});

test('maybeExpandTextFromCM is a no-op when #cm-host is hidden (rich mode)', () => {
	const ctx = makeCtx({
		mode: 'rich', // #cm-host hidden -> isMarkdownVisible() false
		cmDoc: 'foo ;br',
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	// getCM returns null in rich mode (no _cmView), so pass a live mock to be explicit.
	const ok = vm.runInContext('maybeExpandTextFromCM(_cmView)', ctx);
	assert.equal(ok, false, 'markdown expander must not run when CM host hidden');
});

// ---------------------------------------------------------------------------
// Wiring guards: ensure the runtime is actually connected to editor events.
// (Cheap source-level checks so a future refactor can't silently disconnect
// the expander from TinyMCE keyup or the CM6 input pipeline.)
// ---------------------------------------------------------------------------

test('TinyMCE editor wires maybeExpandTextFromTinyMCE on keyup', () => {
	const idx = appSrc.indexOf("editor.on('keyup'");
	assert.ok(idx !== -1, "a keyup handler must be registered on the TinyMCE editor");
	const region = appSrc.slice(idx, idx + 400);
	assert.ok(region.includes('maybeExpandTextFromTinyMCE(editor)'), 'keyup handler must call maybeExpandTextFromTinyMCE');
	assert.ok(region.includes('_textExpanders.length'), 'keyup handler must short-circuit when no expanders exist');
	assert.ok(/ctrlKey\|\|.*metaKey\|\|.*altKey/.test(region), 'keyup handler must ignore modifier-key combos');
});

test('TinyMCE editor wires Ctrl/Cmd-Space to requestTinyMCEProseCompletion on keydown', () => {
	const idx = appSrc.indexOf('requestTinyMCEProseCompletion({editor:editor})');
	assert.ok(idx !== -1, 'the TinyMCE keydown handler must call requestTinyMCEProseCompletion({editor:editor})');
	// Inspect the enclosing handler region (a bit before the call site).
	const region = appSrc.slice(Math.max(0, idx - 700), idx + 60);
	assert.ok(region.includes("editor.on('keydown'"), 'the call must live inside an editor keydown handler');
	assert.ok(/ctrlKey\|\|e\.metaKey/.test(region), 'keydown must gate on Ctrl/Cmd');
	assert.ok(region.includes("e.code==='Space'"), 'keydown must match the Space key');
});

test('TinyMCE keydown routes popup keys (Enter/Esc) through handleRenderPopupKey', () => {
	// The AI popup lives in the outer document; iframe key events never reach it,
	// so the editor keydown handler must forward them while the popup is open.
	const idx = appSrc.indexOf('requestTinyMCEProseCompletion({editor:editor})');
	const region = appSrc.slice(Math.max(0, idx - 700), idx + 60);
	assert.ok(region.includes('_activeRenderPopup'), 'keydown must check for an active popup');
	assert.ok(region.includes('handleRenderPopupKey(e)'), 'keydown must forward popup keys to handleRenderPopupKey');
	assert.ok(region.includes('hideRenderAutocompletePopup()'), 'typing while the popup is open must dismiss it');
});

test('maybeExpandTextFromTinyMCE AI branch routes through requestTinyMCEProseCompletion (not the CM path)', () => {
	const src = extractFn('maybeExpandTextFromTinyMCE');
	assert.ok(src.includes('removeTinyMCETriggerForAction('), 'AI branch must remove the trigger from the iframe');
	assert.ok(src.includes('requestTinyMCEProseCompletion('), 'AI branch must request a TinyMCE completion');
	assert.ok(!src.includes('requestManualProseCompletion('), 'must not reuse the CM/markdown manual path');
});

test('CM6 contentDOM feeds the ring buffer and consumes pending expansions', () => {
	const src = extractFn('initCM');
	assert.ok(src.includes("addEventListener('beforeinput'"), 'initCM must attach a beforeinput listener');
	assert.ok(src.includes("addEventListener('input'"), 'initCM must attach an input listener');
	assert.ok(src.includes('_feedRingBuffer('), 'initCM must feed the ring buffer');
	assert.ok(src.includes("consumePendingTextExpansion('cm')"), 'initCM input listener must consume pending expansions');
});

test('CM6 update listener runs maybeExpandTextFromCM via maybeTriggerManualProseFromCM', () => {
	const src = extractFn('maybeTriggerManualProseFromCM');
	assert.ok(src.includes('maybeExpandTextFromCM(cm)'), 'CM update path must call maybeExpandTextFromCM');
	const initSrc = extractFn('initCM');
	assert.ok(initSrc.includes('maybeTriggerManualProseFromCM('), 'initCM update listener must invoke maybeTriggerManualProseFromCM');
});

test('Ctrl/Mod-Space still maps to a manual prose completion request', () => {
	// The keyboard shortcut path must survive independently of Expander triggers.
	assert.ok(appSrc.includes('function requestManualProseCompletion('), 'requestManualProseCompletion must exist');
	// CM6 keymap binding.
	assert.ok(/key:'Mod-Space',run:function\(\)\{requestManualProseCompletion\(\)/.test(appSrc),
		'CM6 keymap must bind Mod-Space to requestManualProseCompletion');
	assert.ok(/key:'Ctrl-Space',run:function\(\)\{requestManualProseCompletion\(\)/.test(appSrc),
		'CM6 keymap must bind Ctrl-Space to requestManualProseCompletion');
	// Global keydown fallback (Ctrl/Meta + Space).
	assert.ok(/e\.code==='Space'\)\{e\.preventDefault\(\);requestManualProseCompletion\(\)/.test(appSrc),
		'global keydown must fire requestManualProseCompletion on Ctrl/Meta+Space');
});

// ---------------------------------------------------------------------------
// consumePendingTextExpansion (ring-buffer -> action bridge used by CM input)
// ---------------------------------------------------------------------------

test('consumePendingTextExpansion runs the pending entry then clears it', () => {
	const ctx = makeCtx({
		mode: 'markdown',
		cmDoc: 'greet ;br',
		expanders: [{ id: '1', trigger: ';br', action: 'text', text: 'best regards', profileId: '' }],
	});
	vm.runInContext(extractFn('consumePendingTextExpansion'), ctx);
	vm.runInContext('_pendingTextExpansion=_textExpanders[0]', ctx);
	const ok = vm.runInContext("consumePendingTextExpansion('cm')", ctx);
	assert.equal(ok, true, 'pending text expansion must run');
	assert.equal(ctx._getDoc(), 'greet best regards');
	assert.equal(vm.runInContext('_pendingTextExpansion', ctx), null, 'pending entry cleared after consume');
});

test('consumePendingTextExpansion is a no-op when nothing is pending', () => {
	const ctx = makeCtx({ mode: 'markdown', cmDoc: 'x', expanders: [] });
	vm.runInContext(extractFn('consumePendingTextExpansion'), ctx);
	vm.runInContext('_pendingTextExpansion=null', ctx);
	const ok = vm.runInContext("consumePendingTextExpansion('cm')", ctx);
	assert.equal(ok, false);
});

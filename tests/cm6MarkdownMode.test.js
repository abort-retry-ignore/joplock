/**
 * Tests for the CodeMirror 6 markdown-mode migration.
 *
 * These verify that:
 *   1. The markdown-mode editor helpers (getCM / cmSyncToTA / cmSetVal / mountMarkdownEditor)
 *      exist and are wired up (they were previously referenced but undefined, causing
 *      ReferenceError: getCM is not defined).
 *   2. The editor fragment renders a #cm-host mount element.
 *   3. The page loads codemirror.min.js before app.js.
 *   4. setEditorMode wires CM<->textarea sync in both directions.
 *   5. The TinyMCE init config enables inline image/file uploads (paste + picker).
 *
 * Runtime behaviour of getCM/cmSyncToTA/cmSetVal is exercised against a mock _cmView
 * (a real window.CM/EditorView bundle isn't available under jsdom).
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
// Helper definitions exist (regression: they were referenced but never defined)
// ---------------------------------------------------------------------------

test('app.js defines getCM (was undefined, causing ReferenceError)', () => {
	assert.ok(appSrc.includes('function getCM('), 'getCM must be defined');
});

test('app.js defines cmSyncToTA (CM -> textarea sync)', () => {
	assert.ok(appSrc.includes('function cmSyncToTA('), 'cmSyncToTA must be defined');
});

test('app.js defines cmSetVal (set CM document)', () => {
	assert.ok(appSrc.includes('function cmSetVal('), 'cmSetVal must be defined');
});

test('app.js defines mountMarkdownEditor (mounts CM6 into #cm-host)', () => {
	assert.ok(appSrc.includes('function mountMarkdownEditor('), 'mountMarkdownEditor must be defined');
	const src = extractFn('mountMarkdownEditor');
	assert.ok(src.includes('initCM('), 'mountMarkdownEditor must call initCM()');
	assert.ok(src.includes('#cm-host'), 'mountMarkdownEditor must target #cm-host');
});

// ---------------------------------------------------------------------------
// Runtime behaviour of getCM / cmSyncToTA / cmSetVal against a mock CM view
// ---------------------------------------------------------------------------

function makeCtx({ cmDoc = '', taValue = '' } = {}) {
	const dom = new JSDOM(
		`<!DOCTYPE html><body><form id="note-editor-form"><textarea id="note-body">${taValue}</textarea></form></body>`,
		{ url: 'https://joplock.test' },
	);
	const dispatched = [];
	const mockView = {
		state: { doc: { toString: () => cmDoc, length: cmDoc.length } },
		dispatch(tr) { dispatched.push(tr); if (tr.changes) mockView.state.doc = { toString: () => tr.changes.insert, length: tr.changes.insert.length }; },
	};
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		_cmView: mockView,
		_dispatched: dispatched,
	});
	// Minimal deps so extracted fns run.
	vm.runInContext(
		'function activeEditorForm(){return document.getElementById("note-editor-form")}' +
		'function queryActiveEditor(sel){var f=activeEditorForm();return f&&f.querySelector?f.querySelector(sel):null}' +
		'function getTA(){return queryActiveEditor("#note-body")}',
		ctx,
	);
	vm.runInContext(extractFn('getCM'), ctx);
	vm.runInContext(extractFn('cmSyncToTA'), ctx);
	vm.runInContext(extractFn('cmSetVal'), ctx);
	return ctx;
}

test('getCM returns the active _cmView', () => {
	const ctx = makeCtx({ cmDoc: 'hello' });
	const view = vm.runInContext('getCM()', ctx);
	assert.equal(view.state.doc.toString(), 'hello');
});

test('cmSyncToTA writes CM document into #note-body and reports change', () => {
	const ctx = makeCtx({ cmDoc: 'new content', taValue: 'old' });
	const changed = vm.runInContext('cmSyncToTA()', ctx);
	assert.equal(changed, true, 'cmSyncToTA must return true when the textarea changed');
	const val = vm.runInContext('getTA().value', ctx);
	assert.equal(val, 'new content');
});

test('cmSyncToTA is a no-op (returns false) when already in sync', () => {
	const ctx = makeCtx({ cmDoc: 'same', taValue: 'same' });
	const changed = vm.runInContext('cmSyncToTA()', ctx);
	assert.equal(changed, false);
});

test('cmSetVal dispatches a full-document replace when content differs', () => {
	const ctx = makeCtx({ cmDoc: 'old' });
	vm.runInContext('cmSetVal("brand new")', ctx);
	const dispatched = ctx._dispatched;
	assert.equal(dispatched.length, 1, 'cmSetVal must dispatch exactly one change');
	assert.equal(dispatched[0].changes.insert, 'brand new');
	assert.equal(dispatched[0].changes.from, 0);
});

test('cmSetVal is a no-op when content is unchanged', () => {
	const ctx = makeCtx({ cmDoc: 'same' });
	vm.runInContext('cmSetVal("same")', ctx);
	assert.equal(ctx._dispatched.length, 0, 'cmSetVal must not dispatch when unchanged');
});

// ---------------------------------------------------------------------------
// Mode-switch wiring
// ---------------------------------------------------------------------------

test('setEditorMode markdown branch mounts CM6 and syncs from TinyMCE', () => {
	const src = extractFn('setEditorMode');
	assert.ok(src.includes("mode==='markdown'"), 'setEditorMode must handle markdown mode');
	assert.ok(src.includes('mountMarkdownEditor('), 'markdown mode must mount the CM6 editor');
	assert.ok(src.includes('tinyMCESyncToTA()'), 'markdown mode must sync rich content back to textarea first');
});

test('setEditorMode rich branch syncs CM6 back to the textarea before switching', () => {
	const src = extractFn('setEditorMode');
	assert.ok(src.includes('cmSyncToTA()'), 'rich mode must call cmSyncToTA() so TinyMCE gets latest markdown');
});

test('initCM update listener syncs CM changes into the textarea', () => {
	const src = extractFn('initCM');
	assert.ok(src.includes('cmSyncToTA()'), 'initCM update listener must call cmSyncToTA()');
	assert.ok(src.includes('parent:host'), 'initCM must mount into the provided host element');
});

test('initCM normalizes code language supports before passing codeLanguages to markdown()', () => {
	const src = extractFn('initCM');
	assert.ok(src.includes('_cmLanguageDescription('), 'initCM must build language descriptions via _cmLanguageDescription');
	assert.ok(src.includes('codeLanguages:codeLanguages'), 'initCM must pass filtered codeLanguages array into markdown()');
});

test('app.js defines _cmNormalizeLanguageSupport and _cmLanguageDescription guards', () => {
	const normalizeSrc = extractFn('_cmNormalizeLanguageSupport');
	assert.ok(normalizeSrc.includes('support.language&&support.language.parser'), 'normalizer must accept LanguageSupport objects');
	assert.ok(normalizeSrc.includes('support.parser'), 'normalizer must adapt bare Language instances');
	assert.ok(normalizeSrc.includes('return null'), 'normalizer must reject unsupported values');
	const descSrc = extractFn('_cmLanguageDescription');
	assert.ok(descSrc.includes('try{support=_cmNormalizeLanguageSupport(buildSupport())}catch'), 'description builder must guard provider exceptions');
	assert.ok(descSrc.includes('if(!support)return null'), 'description builder must skip unusable supports');
});

test('applyEditorModeVisibility shows #cm-host in markdown mode when CM is available', () => {
	const src = extractFn('applyEditorModeVisibility');
	assert.ok(src.includes('#cm-host'), 'must reference #cm-host');
	assert.ok(src.includes('window.CM'), 'must gate visibility on window.CM availability');
});

test('applyEditorModeVisibility collapses #tinymce-slot flex in markdown mode (prevents CM6 truncation)', () => {
	// #tinymce-slot also has flex:1 in CSS; if it is not collapsed in markdown mode it
	// steals half the column height from #cm-host and the editor content gets cut off.
	const src = extractFn('applyEditorModeVisibility');
	assert.ok(src.includes('#tinymce-slot'), 'must reference #tinymce-slot');
	assert.ok(/slot\.style\.flex\s*=\s*'0'/.test(src), "markdown mode must set the slot flex to '0'");
	assert.ok(/slot\.style\.height\s*=\s*'0'/.test(src), "markdown mode must set the slot height to '0'");
	// Rich mode must restore the slot so it anchors/sizes the TinyMCE host.
	assert.ok(/slot\.style\.flex\s*=\s*''/.test(src), 'rich mode must restore the slot flex');
});

// ---------------------------------------------------------------------------
// Fragment + page wiring
// ---------------------------------------------------------------------------

test('editorFragment renders a #cm-host mount element', () => {
	const { editorFragment } = require('../app/templates');
	const html = editorFragment(
		{ id: 'n1', title: 'T', body: 'B', parentId: 'f1', deletedTime: 0, createdTime: 1, updatedTime: 2 },
		[{ id: 'f1', title: 'F' }],
	);
	assert.ok(html.includes('id="cm-host"'), '#cm-host must be present for CM6 to mount into');
});

test('page loads codemirror.min.js before app.js', () => {
	const { layoutPage } = require('../app/templates');
	const html = layoutPage({ user: { email: 'u@e.com', fullName: 'U' }, navContent: '' });
	const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
	const cmIdx = scripts.findIndex(s => s.includes('codemirror'));
	const appIdx = scripts.findIndex(s => s.includes('app.js'));
	assert.ok(cmIdx !== -1, 'codemirror.min.js script tag must exist');
	assert.ok(appIdx !== -1, 'app.js script tag must exist');
	assert.ok(cmIdx < appIdx, 'codemirror.min.js must load before app.js');
});

// ---------------------------------------------------------------------------
// TinyMCE inline image / file upload config
// ---------------------------------------------------------------------------

test('tinymce.init enables automatic image uploads (paste + dialog)', () => {
	assert.ok(appSrc.includes('automatic_uploads:true'), 'automatic_uploads must be enabled');
	assert.ok(appSrc.includes('paste_data_images:true'), 'paste_data_images must be enabled so pasted images upload');
});

test('tinymce.init wires file_picker_callback through /fragments/upload', () => {
	assert.ok(appSrc.includes('file_picker_callback:'), 'file_picker_callback must be configured');
	const idx = appSrc.indexOf('file_picker_callback:');
	const region = appSrc.slice(idx, idx + 600);
	assert.ok(region.includes('/fragments/upload'), 'file picker must upload through /fragments/upload');
	assert.ok(region.includes('/resources/'), 'file picker callback must return a /resources/ URL');
});

test('images_upload_handler posts to /fragments/upload and resolves a /resources/ URL', () => {
	const idx = appSrc.indexOf('images_upload_handler:');
	assert.ok(idx !== -1, 'images_upload_handler must exist');
	const region = appSrc.slice(idx, idx + 500);
	assert.ok(region.includes('/fragments/upload'), 'must upload through /fragments/upload');
	assert.ok(region.includes("'/resources/'+data.resourceId"), 'must resolve to /resources/<id>');
});

test('TinyMCE paste handler uploads non-image clipboard files', () => {
	// Non-image files (e.g. PDF) pasted from the clipboard must be uploaded, not dropped.
	assert.ok(appSrc.includes("editor.on('paste'"), 'a paste handler must be registered on the editor');
	const idx = appSrc.indexOf("editor.on('paste'");
	const region = appSrc.slice(idx, idx + 700);
	assert.ok(region.includes('_uploadFileToTinyMCE'), 'paste handler must upload files via _uploadFileToTinyMCE');
	assert.ok(region.includes("indexOf('image/')"), 'paste handler must skip images (handled by paste_data_images)');
});

test('_uploadFileToTinyMCE inserts image with data-resource-id and file link', () => {
	const src = extractFn('_uploadFileToTinyMCE');
	assert.ok(src.includes('/fragments/upload'), 'must upload through /fragments/upload');
	assert.ok(src.includes('data-resource-id='), 'inserted markup must carry data-resource-id');
	assert.ok(src.includes('<img src="/resources/'), 'images inserted as /resources/ img');
	assert.ok(src.includes('<a href="/resources/'), 'non-images inserted as /resources/ link');
});

// ---------------------------------------------------------------------------
// The CodeMirror bundle actually loads and exposes every symbol initCM needs
// ---------------------------------------------------------------------------

test('codemirror.min.js loads and exposes the window.CM API initCM depends on', () => {
	const bundle = fs.readFileSync(path.join(__dirname, '../public/codemirror.min.js'), 'utf8');
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', url: 'https://joplock.test' });
	dom.window.eval(bundle);
	const CM = dom.window.CM;
	assert.equal(typeof CM, 'object', 'window.CM must be defined after the bundle loads');
	// Symbols referenced by initCM() and _initCodeModalCM() in app.js.
	const required = [
		'markdown', 'markdownLanguage', 'LanguageDescription', 'EditorView', 'EditorState',
		'keymap', 'defaultKeymap', 'historyKeymap', 'searchKeymap', 'indentWithTab', 'history',
		'bracketMatching', 'highlightActiveLine', 'highlightSelectionMatches', 'drawSelection',
		'autocompletion', 'HighlightStyle', 'defaultHighlightStyle', 'syntaxHighlighting', 'tags',
		'placeholder', 'SearchQuery', 'setSearchQuery', 'openSearchPanel',
		'javascript', 'html', 'css', 'json', 'sql', 'python', 'xml', 'go', 'cpp', 'yaml',
		'StreamLanguage', 'shell',
	];
	const missing = required.filter(k => typeof CM[k] === 'undefined');
	assert.deepEqual(missing, [], `window.CM is missing symbols: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// End-to-end: mount the REAL CM6 bundle into the REAL editor fragment's #cm-host
// and verify bidirectional sync with #note-body.
// ---------------------------------------------------------------------------

test('CM6 mounts into #cm-host and syncs both ways with #note-body', () => {
	const { editorFragment } = require('../app/templates');
	const cmBundle = fs.readFileSync(path.join(__dirname, '../public/codemirror.min.js'), 'utf8');
	const frag = editorFragment(
		{ id: 'n1', title: 'T', body: 'line1\nline2\n\npara2', parentId: 'f1', deletedTime: 0, createdTime: 1, updatedTime: 2 },
		[{ id: 'f1', title: 'F' }],
	);
	const dom = new JSDOM('<!DOCTYPE html><body><div id="editor-panel">' + frag + '</div></body>', {
		runScripts: 'outside-only', url: 'https://joplock.test', pretendToBeVisual: true,
	});
	const w = dom.window;
	w.eval(cmBundle);
	// Minimal globals that initCM references (autocomplete/prose/ring-buffer are stubbed).
	w.eval('var _cmView=null,_highlightActiveLine=false,_ringBufFedFromBeforeinput=false;');
	w.eval('function _ringBufAccepts(){return false}function _feedRingBuffer(){}function _resetRingBuffer(){}');
	w.eval('function maybeTriggerManualProseFromCM(){}function requestManualProseCompletion(){return true}');
	w.eval('function manualProseCompletionSource(){return null}function noteCompletionSource(){return null}');
	w.eval('function activeEditorForm(){return document.getElementById("note-editor-form")}');
	w.eval('function queryActiveEditor(sel){var f=activeEditorForm();return f&&f.querySelector?f.querySelector(sel):null}');
	w.eval('function getTA(){return queryActiveEditor("#note-body")}');
	w.eval(extractFn('_cmNormalizeLanguageSupport'));
	w.eval(extractFn('_cmLanguageDescription'));
	w.eval(extractFn('getCM'));
	w.eval(extractFn('cmSyncToTA'));
	w.eval(extractFn('cmSetVal'));
	w.eval(extractFn('initCM'));
	w.eval(extractFn('mountMarkdownEditor'));

	const ta = w.document.getElementById('note-body');
	assert.equal(ta.value, 'line1\nline2\n\npara2', 'textarea seeded from note body');

	w.eval('mountMarkdownEditor(getTA().value)');
	assert.ok(w.eval('getCM()'), 'CM6 EditorView must be created');
	assert.ok(w.document.querySelector('#cm-host .cm-editor'), 'CM6 must render a .cm-editor inside #cm-host');
	assert.equal(w.eval('getCM().state.doc.toString()'), 'line1\nline2\n\npara2', 'CM6 doc seeded from textarea');

	// Edit in CM6 -> textarea updates via the update listener (cmSyncToTA).
	w.eval('var v=getCM();v.dispatch({changes:{from:v.state.doc.length,insert:" EDITED"}})');
	assert.equal(ta.value, 'line1\nline2\n\npara2 EDITED', 'CM6 edit must sync into #note-body');

	// cmSetVal replaces the document; cmSyncToTA mirrors it to the textarea.
	w.eval('cmSetVal("replaced content")');
	w.eval('cmSyncToTA()');
	assert.equal(ta.value, 'replaced content', 'cmSetVal + cmSyncToTA must update #note-body');

	// Prevent CM's async .measure() (needs real layout) from throwing after the test.
	try { w.eval('getCM().destroy()'); } catch (_e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Drag-and-drop attachment insertion: a BLANK LINE before and after
// ---------------------------------------------------------------------------
// Requirement: when an image OR a document is dropped/pasted into a note, it is
// placed on its own line with a blank (empty, deletable) line before and after.
// The blank line lets the user remove a single attachment even when several sit
// one after another in rendered mode, and it must survive markdown<->render
// round-trips. This holds in both markdown mode (CM6) and rendered mode
// (TinyMCE). "Smart": existing blank lines are topped up, not stacked.

const RID = 'a'.repeat(32);

// Build a vm context that can run the async upload helpers with a mocked
// fetch() and a mock CodeMirror view that records dispatched changes.
function makeUploadCtx() {
	const dom = new JSDOM(
		'<!DOCTYPE html><body><form id="note-editor-form"><textarea id="note-body"></textarea></form></body>',
		{ url: 'https://joplock.test' },
	);
	// Mock CM view: applies inserts to an in-memory doc string.
	let doc = '';
	const mockView = {
		get state() {
			return {
				doc: { toString: () => doc, length: doc.length },
				selection: { main: { head: doc.length } },
			};
		},
		dispatch(tr) {
			if (tr.changes) {
				const { from, to, insert } = tr.changes;
				const end = typeof to === 'number' ? to : from;
				doc = doc.slice(0, from) + insert + doc.slice(end);
			}
		},
	};
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		_cmView: mockView,
		alert: () => {},
		Promise,
		FormData: function FormData() { this.append = () => {}; },
		fetch: () => Promise.resolve({ json: () => Promise.resolve({ resourceId: RID }) }),
		File: dom.window.File,
		_getDoc: () => doc,
	});
	vm.runInContext(
		'function activeEditorForm(){return document.getElementById("note-editor-form")}' +
		'function queryActiveEditor(sel){var f=activeEditorForm();return f&&f.querySelector?f.querySelector(sel):null}' +
		'function getTA(){return queryActiveEditor("#note-body")}',
		ctx,
	);
	vm.runInContext(extractFn('cmSyncToTA'), ctx);
	vm.runInContext(extractFn('_maxUploadBytes'), ctx);
	vm.runInContext(extractFn('_fileTooLarge'), ctx);
	vm.runInContext(extractFn('_tooLargeMsg'), ctx);
	vm.runInContext(extractFn('_escapeHtmlAttr'), ctx);
	vm.runInContext(extractFn('_normalizeUploadInsert'), ctx);
	vm.runInContext(extractFn('_uploadFileToCM'), ctx);
	return ctx;
}

test('markdown mode: dropping an image into an empty doc adds a trailing blank line', async () => {
	const ctx = makeUploadCtx();
	ctx.file = { name: 'cat.png', type: 'image/png', size: 10 };
	await vm.runInContext('_uploadFileToCM(file)', ctx);
	const doc = ctx._getDoc();
	assert.equal(doc, '![cat.png](:/' + RID + ')\n\n',
		`image insert must end with a blank line, got: ${JSON.stringify(doc)}`);
});

test('markdown mode: dropping an image after text pads it with a blank line before and after', async () => {
	const ctx = makeUploadCtx();
	vm.runInContext('_cmView.dispatch({changes:{from:0,insert:"existing text"}})', ctx);
	ctx.file = { name: 'pic.jpg', type: 'image/jpeg', size: 10 };
	await vm.runInContext('_uploadFileToCM(file)', ctx);
	const doc = ctx._getDoc();
	assert.equal(doc, 'existing text\n\n![pic.jpg](:/' + RID + ')\n\n',
		`image must be padded above and below, got: ${JSON.stringify(doc)}`);
});

test('markdown mode: dropping a NON-image file also gets padded above and below', async () => {
	const ctx = makeUploadCtx();
	vm.runInContext('_cmView.dispatch({changes:{from:0,insert:"existing text"}})', ctx);
	ctx.file = { name: 'doc.pdf', type: 'application/pdf', size: 10 };
	await vm.runInContext('_uploadFileToCM(file)', ctx);
	const doc = ctx._getDoc();
	assert.equal(doc, 'existing text\n\n[doc.pdf](:/' + RID + ')\n\n',
		`non-image link must also be padded above and below, got: ${JSON.stringify(doc)}`);
});

// Build a TinyMCE upload context with a mock editor. `selNode` is what
// editor.selection.getNode() returns (null => selection API unavailable, both
// blank-line paragraphs are added).
function makeTinyMCECtx(selNode) {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		alert: () => {},
		Promise,
		FormData: function FormData() { this.append = () => {}; },
		fetch: () => Promise.resolve({ json: () => Promise.resolve({ resourceId: RID }) }),
	});
	vm.runInContext(extractFn('_maxUploadBytes'), ctx);
	vm.runInContext(extractFn('_fileTooLarge'), ctx);
	vm.runInContext(extractFn('_tooLargeMsg'), ctx);
	vm.runInContext(extractFn('_escapeHtmlAttr'), ctx);
	// _MD_BLANK_LINE_P is a top-level `var`; inject it directly.
	vm.runInContext('var _MD_BLANK_LINE_P=\'<p class="md-blank-line"><br></p>\';', ctx);
	vm.runInContext(extractFn('_isBlankLineBlock'), ctx);
	vm.runInContext(extractFn('_tinyMCEBlockAttachmentHtml'), ctx);
	vm.runInContext(extractFn('_uploadFileToTinyMCE'), ctx);
	vm.runInContext('function getTA(){return null}function tinymceToMarkdown(h){return h}', ctx);
	const inserted = [];
	ctx.ed = {
		insertContent(html) { inserted.push(html); },
		getContent() { return inserted.join(''); },
		selection: selNode ? { getNode: () => selNode } : undefined,
	};
	ctx._inserted = inserted;
	ctx.dom = dom;
	return ctx;
}

test('rendered mode: dropping an image wraps it in its own <p> with a blank line before and after', async () => {
	const ctx = makeTinyMCECtx(null);
	ctx.file = { name: 'cat.png', type: 'image/png', size: 10 };
	await vm.runInContext('_uploadFileToTinyMCE(file, ed)', ctx);
	assert.equal(ctx._inserted.length, 1, 'exactly one insertContent call');
	const html = ctx._inserted[0];
	assert.ok(/<p><img [^>]*src="\/resources\/a{32}"[^>]*><\/p>/.test(html),
		`image must be wrapped in its own <p>, got: ${html}`);
	assert.ok(/^<p class="md-blank-line"><br><\/p><p><img/.test(html),
		`image must be preceded by a blank-line paragraph, got: ${html}`);
	assert.ok(/<\/p><p class="md-blank-line"><br><\/p>$/.test(html),
		`image must be followed by a blank-line paragraph, got: ${html}`);
});

test('rendered mode: dropping a NON-image file also gets a blank line before and after', async () => {
	const ctx = makeTinyMCECtx(null);
	ctx.file = { name: 'doc.pdf', type: 'application/pdf', size: 10 };
	await vm.runInContext('_uploadFileToTinyMCE(file, ed)', ctx);
	const html = ctx._inserted[0];
	assert.ok(/<p><a href="\/resources\/a{32}"[^>]*>doc\.pdf<\/a><\/p>/.test(html),
		`non-image must be wrapped in its own <p>, got: ${html}`);
	assert.ok(html.startsWith('<p class="md-blank-line"><br></p><p><a '),
		`non-image must be preceded by a blank-line paragraph, got: ${html}`);
	assert.ok(html.endsWith('</p><p class="md-blank-line"><br></p>'),
		`non-image must be followed by a blank-line paragraph, got: ${html}`);
});

test('rendered mode: does not add a leading blank line when the caret block is empty', async () => {
	const ctx = makeTinyMCECtx(null);
	// An empty paragraph as the caret block acts as its own leading gap.
	const emptyP = ctx.dom.window.document.createElement('p');
	ctx.ed.selection = { getNode: () => emptyP };
	ctx.file = { name: 'cat.png', type: 'image/png', size: 10 };
	await vm.runInContext('_uploadFileToTinyMCE(file, ed)', ctx);
	const html = ctx._inserted[0];
	assert.ok(!/^<p class="md-blank-line">/.test(html),
		`empty caret block should not get an extra leading blank line, got: ${html}`);
	assert.ok(/<\/p><p class="md-blank-line"><br><\/p>$/.test(html),
		`trailing blank-line paragraph still required, got: ${html}`);
});

test('rendered mode: does not stack a blank line next to an existing blank-line paragraph', async () => {
	const ctx = makeTinyMCECtx(null);
	const doc = ctx.dom.window.document;
	// Caret block has text, but the previous sibling is already a blank-line <p>.
	const container = doc.createElement('div');
	const prev = doc.createElement('p'); prev.className = 'md-blank-line'; prev.innerHTML = '<br>';
	const block = doc.createElement('p'); block.textContent = 'hello';
	container.appendChild(prev); container.appendChild(block);
	ctx.ed.selection = { getNode: () => block };
	ctx.file = { name: 'cat.png', type: 'image/png', size: 10 };
	await vm.runInContext('_uploadFileToTinyMCE(file, ed)', ctx);
	const html = ctx._inserted[0];
	assert.ok(!/^<p class="md-blank-line">/.test(html),
		`should not add a leading blank line next to an existing one, got: ${html}`);
});


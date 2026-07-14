/**
 * Regression tests for the mobile/desktop shell-mode helper and the
 * read-only editor lockdown + navigation-click interceptor.
 *
 * These pin down bugs that already bit us once:
 *  - Callers used to inline the shell-mode calculation (viewportWidth <=
 *    breakpoint), so different code paths could disagree during a resize.
 *    Now everyone goes through isMobileShellMode(); a cache with an explicit
 *    recompute arg keeps the value stable within a frame.
 *  - Read-only mode used to leave the title contenteditable and the folder
 *    <select> enabled. Users could still type in the title / change the
 *    folder, which fired markEdited() but never changed the body -> the
 *    form hash matched _savedHash, scheduleSave skipped, and the note was
 *    silently never saved.
 *  - flushSave's hash-unchanged branch used to return without clearing
 *    the ".autosave-edited" status span. When a phantom markEdited had
 *    fired, the navigation-click interceptor would loop: it sees dirty=1,
 *    calls flushSave (which does nothing), re-clicks the nav target, the
 *    interceptor fires again, ... nav-folder-add "+" button appeared dead.
 *  - jop_edit toolbar button is a mobile affordance only; the desktop
 *    toolbar should not include it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// ---------------------------------------------------------------------------
// Helpers (mirrors tests/appRuntime.test.js extraction style)
// ---------------------------------------------------------------------------

function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `function ${name} not found in app.js`);
	let depth = 0;
	let i = start;
	while (i < appSrc.length) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
		i++;
	}
	throw new Error(`Could not find closing brace for function ${name}`);
}

// Build a minimal vm sandbox with JSDOM, uiMode + breakpoint globals, and
// the extracted helper source loaded. Everything the tests need to
// override lives on the sandbox, so callers can flip _uiMode / innerWidth
// between assertions.
function makeShellCtx(opts = {}) {
	const width = opts.width != null ? opts.width : 1200;
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	// JSDOM's innerWidth is read-only, so shadow it via defineProperty.
	Object.defineProperty(dom.window, 'innerWidth', { value: width, configurable: true, writable: true });
	const ctx = vm.createContext({
		window: dom.window,
		document: dom.window.document,
		_uiMode: opts.uiMode || 'auto',
		_mobileShellMaxWidth: 768,
		_mobileShellCached: null,
	});
	// Inject the same helpers app.js defines.
	vm.runInContext(extractFn('viewportWidth'), ctx);
	vm.runInContext(extractFn('_computeMobileShell'), ctx);
	vm.runInContext(extractFn('isMobileShellMode'), ctx);
	vm.runInContext(extractFn('isDesktopMode'), ctx);
	return ctx;
}

// ---------------------------------------------------------------------------
// isMobileShellMode caching + recompute
// ---------------------------------------------------------------------------

test('isMobileShellMode: caches first result so repeated calls are stable', () => {
	const ctx = makeShellCtx({ width: 1200 });
	assert.equal(vm.runInContext('isMobileShellMode()', ctx), false);
	// Change the viewport width behind its back — cached value must not change.
	vm.runInContext('window.innerWidth = 400;', ctx);
	assert.equal(vm.runInContext('isMobileShellMode()', ctx), false, 'cached desktop value must survive silent viewport change');
});

test('isMobileShellMode: passing true forces a recompute against current viewport', () => {
	const ctx = makeShellCtx({ width: 1200 });
	assert.equal(vm.runInContext('isMobileShellMode()', ctx), false);
	vm.runInContext('window.innerWidth = 400;', ctx);
	assert.equal(vm.runInContext('isMobileShellMode(true)', ctx), true, 'recompute=true must see the new viewport');
	// New value must now be cached.
	vm.runInContext('window.innerWidth = 1200;', ctx);
	assert.equal(vm.runInContext('isMobileShellMode()', ctx), true, 'recomputed value must be sticky until next recompute');
});

test('isMobileShellMode: uiMode=mobile forces mobile regardless of width', () => {
	const ctx = makeShellCtx({ width: 4000, uiMode: 'mobile' });
	assert.equal(vm.runInContext('isMobileShellMode()', ctx), true);
});

test('isMobileShellMode: uiMode=desktop forces desktop regardless of width', () => {
	const ctx = makeShellCtx({ width: 320, uiMode: 'desktop' });
	assert.equal(vm.runInContext('isMobileShellMode()', ctx), false);
});

test('isMobileShellMode: auto + narrow viewport (<=768) is mobile shell', () => {
	const narrow = makeShellCtx({ width: 500, uiMode: 'auto' });
	assert.equal(vm.runInContext('isMobileShellMode()', narrow), true);
	const wide = makeShellCtx({ width: 900, uiMode: 'auto' });
	assert.equal(vm.runInContext('isMobileShellMode()', wide), false);
});

test('isDesktopMode: inverse of isMobileShellMode and shares the cache', () => {
	const ctx = makeShellCtx({ width: 400 });
	assert.equal(vm.runInContext('isMobileShellMode()', ctx), true);
	assert.equal(vm.runInContext('isDesktopMode()', ctx), false);
});

// ---------------------------------------------------------------------------
// isMobileShellMode is used everywhere shell decisions matter (grep guard)
// ---------------------------------------------------------------------------

test('app.js: no inline viewportWidth<=breakpoint checks bypass isMobileShellMode', () => {
	// Anyone comparing viewportWidth() against the breakpoint constant is
	// bypassing the cached global — that's exactly what caused the resize
	// desynchronisation. Exception: the definition inside _computeMobileShell.
	const re = /viewportWidth\(\)\s*<=?\s*_mobileShellMaxWidth/g;
	const hits = [];
	let m;
	while ((m = re.exec(appSrc)) !== null) hits.push(m.index);
	// _computeMobileShell contains the one legitimate use.
	const computeSrc = extractFn('_computeMobileShell');
	const computeIdx = appSrc.indexOf(computeSrc);
	const computeEnd = computeIdx + computeSrc.length;
	const strayHits = hits.filter(i => i < computeIdx || i >= computeEnd);
	assert.equal(strayHits.length, 0, 'all viewport<=breakpoint comparisons must live inside _computeMobileShell; found stray at offsets: ' + strayHits.join(', '));
});

test('app.js: exposes isMobileShellMode on window for external callers', () => {
	assert.ok(appSrc.includes('window.isMobileShellMode=isMobileShellMode'), 'window.isMobileShellMode must be exposed');
});

// ---------------------------------------------------------------------------
// Toolbar spec: jop_edit is mobile-only
// ---------------------------------------------------------------------------

test('_tinyMCEToolbarSpec: includes jop_edit in mobile shell', () => {
	const ctx = makeShellCtx({ width: 400, uiMode: 'mobile' });
	vm.runInContext(extractFn('_tinyMCEToolbarSpec'), ctx);
	const spec = vm.runInContext('_tinyMCEToolbarSpec()', ctx);
	assert.ok(spec.startsWith('jop_edit | '), 'mobile toolbar must lead with jop_edit; got: ' + spec.slice(0, 80));
});

test('_tinyMCEToolbarSpec: omits jop_edit on desktop', () => {
	const ctx = makeShellCtx({ width: 1600, uiMode: 'desktop' });
	vm.runInContext(extractFn('_tinyMCEToolbarSpec'), ctx);
	const spec = vm.runInContext('_tinyMCEToolbarSpec()', ctx);
	assert.ok(!spec.includes('jop_edit'), 'desktop toolbar must not include jop_edit; got: ' + spec.slice(0, 120));
});

test('_tinymceReadonlyDefault: mirrors isMobileShellMode', () => {
	const mobileCtx = makeShellCtx({ width: 400 });
	vm.runInContext(extractFn('_tinymceReadonlyDefault'), mobileCtx);
	assert.equal(vm.runInContext('_tinymceReadonlyDefault()', mobileCtx), true);
	const desktopCtx = makeShellCtx({ width: 1200 });
	vm.runInContext(extractFn('_tinymceReadonlyDefault'), desktopCtx);
	assert.equal(vm.runInContext('_tinymceReadonlyDefault()', desktopCtx), false);
});

// ---------------------------------------------------------------------------
// _applyFormReadonly locks the whole form, not just the body
// ---------------------------------------------------------------------------

function makeFormReadonlyCtx() {
	const html = `<!DOCTYPE html><body>
		<form id="note-editor-form" class="editor-form">
			<select class="editor-folder-select"><option>a</option></select>
			<div class="editor-title" contenteditable="true">Title</div>
			<div class="editor-toolbar" id="editor-toolbar">
				<button type="button" class="tb">B</button>
				<button type="button" class="tb">I</button>
				<input type="file" id="file-upload" />
			</div>
			<textarea name="body" id="note-body"></textarea>
			<div id="cm-host"><div class="cm-content" contenteditable="true"></div></div>
		</form>
	</body>`;
	const dom = new JSDOM(html, { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		window: dom.window,
		document: dom.window.document,
		_uiMode: 'desktop',
		_cmView: null,
	});
	// activeEditorForm() checks isMobileShellMode -> stub as desktop (returns
	// #note-editor-form directly).
	vm.runInContext('function isMobileShellMode(){return false}', ctx);
	vm.runInContext(extractFn('activeEditorForm'), ctx);
	vm.runInContext(extractFn('_applyFormReadonly'), ctx);
	return ctx;
}

test('_applyFormReadonly(true): locks title contenteditable', () => {
	const ctx = makeFormReadonlyCtx();
	vm.runInContext('_applyFormReadonly(true)', ctx);
	const title = vm.runInContext('document.querySelector(".editor-title")', ctx);
	assert.equal(title.getAttribute('contenteditable'), 'false');
	assert.equal(title.getAttribute('tabindex'), '-1');
});

test('_applyFormReadonly(true): disables the folder select', () => {
	const ctx = makeFormReadonlyCtx();
	vm.runInContext('_applyFormReadonly(true)', ctx);
	const sel = vm.runInContext('document.querySelector(".editor-folder-select")', ctx);
	assert.equal(sel.disabled, true);
});

test('_applyFormReadonly(true): disables every toolbar button + input', () => {
	const ctx = makeFormReadonlyCtx();
	vm.runInContext('_applyFormReadonly(true)', ctx);
	const btns = vm.runInContext('Array.from(document.querySelectorAll("#editor-toolbar button, #editor-toolbar input"))', ctx);
	assert.ok(btns.length >= 3, 'expected several toolbar controls in fixture');
	for (const b of btns) assert.equal(b.disabled, true, 'toolbar control must be disabled');
});

test('_applyFormReadonly(true): tags the form with .editor-readonly for CSS', () => {
	const ctx = makeFormReadonlyCtx();
	vm.runInContext('_applyFormReadonly(true)', ctx);
	const form = vm.runInContext('document.getElementById("note-editor-form")', ctx);
	assert.ok(form.classList.contains('editor-readonly'));
});

test('_applyFormReadonly(false): restores title contenteditable and clears disabled flags', () => {
	const ctx = makeFormReadonlyCtx();
	vm.runInContext('_applyFormReadonly(true)', ctx);
	vm.runInContext('_applyFormReadonly(false)', ctx);
	const title = vm.runInContext('document.querySelector(".editor-title")', ctx);
	assert.equal(title.getAttribute('contenteditable'), 'true');
	assert.equal(title.getAttribute('tabindex'), null);
	const sel = vm.runInContext('document.querySelector(".editor-folder-select")', ctx);
	assert.equal(sel.disabled, false);
	const btns = vm.runInContext('Array.from(document.querySelectorAll("#editor-toolbar button, #editor-toolbar input"))', ctx);
	for (const b of btns) assert.equal(b.disabled, false);
	const form = vm.runInContext('document.getElementById("note-editor-form")', ctx);
	assert.equal(form.classList.contains('editor-readonly'), false);
});

// ---------------------------------------------------------------------------
// flushSave: hash-unchanged branch must clear stale "Edited" status
// (this is what unbroke the nav-folder-add "+" button)
// ---------------------------------------------------------------------------

test('app.js: flushSave hash-unchanged branch clears .autosave-edited via setSaveState', () => {
	// Static assertion — the fix is a specific setSaveState call inside the
	// hash-unchanged branch. Without it, the nav-click interceptor loops.
	const start = appSrc.indexOf("_log('flushSave skip (hash unchanged)'");
	assert.ok(start !== -1, "flushSave hash-unchanged log must exist");
	// Look ahead until the `return` inside the branch — find the closing
	// brace of the `if(h===_savedHash){...}` block by depth-balancing.
	const openBrace = appSrc.indexOf('{', appSrc.indexOf('if(h===_savedHash)', start - 400));
	assert.ok(openBrace !== -1 && openBrace < start, 'must find opening brace of hash-unchanged branch');
	let depth = 1, i = openBrace + 1;
	while (i < appSrc.length && depth > 0) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') depth--;
		i++;
	}
	assert.ok(depth === 0, 'must find closing brace of hash-unchanged branch');
	const region = appSrc.slice(openBrace, i);
	assert.ok(
		/setSaveState\([^)]*['"]Saved['"]/.test(region),
		'flushSave hash-unchanged branch must call setSaveState(...,"Saved") to clear the stale Edited indicator; otherwise the nav-click interceptor loops on every navigation'
	);
});

// ---------------------------------------------------------------------------
// Resize handler recomputes shell cache + reloads on flip
// ---------------------------------------------------------------------------

test('app.js: handleViewportResize recomputes shell mode after settle', () => {
	const src = extractFn('handleViewportResize');
	assert.ok(src.includes('isMobileShellMode(true)'), 'handleViewportResize must call isMobileShellMode(true) so the cache tracks the new viewport');
});

test('app.js: handleViewportResize reloads page on desktop<->mobile flip', () => {
	const src = extractFn('handleViewportResize');
	assert.ok(src.includes('window.location.reload'), 'shell flip must trigger a page reload — persistent TinyMCE toolbar cannot be swapped safely at runtime');
	assert.ok(src.includes('flushSave'), 'shell flip must flush dirty edits before reloading');
});

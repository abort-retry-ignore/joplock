/**
 * Runtime tests for the in-note find/highlight logic in public/app.js.
 *
 * Regression target: after the TinyMCE migration, searching from the note list
 * and opening a note stopped highlighting / scrolling to the term in rendered
 * (TinyMCE) mode because applySearchHighlight() only handled the dead
 * #note-preview contenteditable and CodeMirror. These tests exercise the
 * DOM-walking highlighter that both preview- and TinyMCE-mode paths use, plus
 * the cross-document (iframe body) path that rendered mode relies on.
 *
 * Strategy mirrors appRuntime.test.js: extract the exact minified function
 * source from app.js and run it in a JSDOM-backed vm context.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

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

// Build a JSDOM context with the globals the highlight helpers touch.
// scrollIntoView is not implemented by JSDOM, so stub it (we assert it fires).
function makeCtx() {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const scrolled = [];
	dom.window.Element.prototype.scrollIntoView = function () { scrolled.push(this); };
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		NodeFilter: dom.window.NodeFilter,
		_searchMarks: [],
		_searchMarkIdx: 0,
		_scrolled: scrolled,
		// searchNavShow reads these DOM ids; provide the desktop nav bar bits.
		console,
	});
	return { ctx, dom, scrolled };
}

function loadFns(ctx, ...fns) {
	for (const fn of fns) vm.runInContext(extractFn(fn), ctx);
}

// The highlighter calls searchNavShow()/searchNavSetActive(); load real ones so
// counter/scroll wiring is covered end to end.
const HIGHLIGHT_DEPS = ['escapeRegex', 'searchNavShow', 'searchNavSetActive', 'highlightInPreview'];

test('highlightInPreview wraps every case-insensitive match in a mark.search-highlight', () => {
	const { ctx, dom } = makeCtx();
	loadFns(ctx, ...HIGHLIGHT_DEPS);
	const root = dom.window.document.createElement('div');
	root.innerHTML = '<p>Alpha beta ALPHA gamma alpha</p>';
	dom.window.document.body.appendChild(root);
	vm.runInContext('highlightInPreview(root, term);', Object.assign(ctx, {
		root, term: 'alpha',
	}));
	const marks = root.querySelectorAll('mark.search-highlight');
	assert.equal(marks.length, 3, 'all three case variants of "alpha" highlighted');
	assert.equal(ctx._searchMarks.length, 3, '_searchMarks tracks each hit');
	// Original text preserved (case kept per match).
	assert.equal(root.textContent, 'Alpha beta ALPHA gamma alpha');
});

test('highlightInPreview marks the first hit active and scrolls to it', () => {
	const { ctx, dom, scrolled } = makeCtx();
	loadFns(ctx, ...HIGHLIGHT_DEPS);
	const root = dom.window.document.createElement('div');
	root.innerHTML = '<p>needle here</p><p>and needle there</p>';
	dom.window.document.body.appendChild(root);
	vm.runInContext('highlightInPreview(root, term);', Object.assign(ctx, { root, term: 'needle' }));
	const marks = root.querySelectorAll('mark.search-highlight');
	assert.equal(marks.length, 2);
	assert.ok(marks[0].classList.contains('search-highlight-active'), 'first hit active');
	assert.ok(!marks[1].classList.contains('search-highlight-active'), 'second hit not active');
	assert.equal(scrolled.length, 1, 'scrollIntoView fired once');
	assert.equal(scrolled[0], marks[0], 'scrolled to the active mark');
});

test('highlightInPreview does not descend into script/style/existing mark nodes', () => {
	const { ctx, dom } = makeCtx();
	loadFns(ctx, ...HIGHLIGHT_DEPS);
	const root = dom.window.document.createElement('div');
	root.innerHTML = '<style>term{}</style><p>term</p><mark>term</mark>';
	dom.window.document.body.appendChild(root);
	vm.runInContext('highlightInPreview(root, term);', Object.assign(ctx, { root, term: 'term' }));
	// Only the plain <p> text should be wrapped: the <style> and pre-existing
	// <mark> contents are skipped by the tree-walker filter.
	assert.equal(root.querySelectorAll('mark.search-highlight').length, 1);
});

test('highlightInPreview works on a cross-document (iframe body) root — rendered/TinyMCE path', () => {
	// Rendered mode inserts marks into the TinyMCE iframe body. That body lives
	// in a different document, so the highlighter must use node.ownerDocument
	// (not the outer document) to create nodes, or replaceChild throws /
	// silently mis-parents. This asserts the ownerDocument-safe behavior.
	const { ctx } = makeCtx();
	loadFns(ctx, ...HIGHLIGHT_DEPS);
	const iframeDom = new JSDOM('<!DOCTYPE html><body><p>find the WORD word here</p></body>', { url: 'https://joplock.test' });
	iframeDom.window.Element.prototype.scrollIntoView = function () {};
	const body = iframeDom.window.document.body;
	vm.runInContext('highlightInPreview(body, term);', Object.assign(ctx, { body, term: 'word' }));
	const marks = body.querySelectorAll('mark.search-highlight');
	assert.equal(marks.length, 2, 'both "word" occurrences highlighted inside the iframe body');
	marks.forEach((m) => {
		assert.equal(m.ownerDocument, iframeDom.window.document, 'mark created in the iframe document');
	});
	assert.equal(body.textContent, 'find the WORD word here', 'iframe text content intact');
});

test('escapeRegex neutralizes regex metacharacters so literal terms match', () => {
	const { ctx, dom } = makeCtx();
	loadFns(ctx, ...HIGHLIGHT_DEPS);
	const root = dom.window.document.createElement('div');
	root.innerHTML = '<p>cost is $5 (approx.) a+b</p>';
	dom.window.document.body.appendChild(root);
	vm.runInContext('highlightInPreview(root, term);', Object.assign(ctx, { root, term: 'a+b' }));
	const marks = root.querySelectorAll('mark.search-highlight');
	assert.equal(marks.length, 1, 'literal "a+b" matched, not treated as regex');
	assert.equal(marks[0].textContent, 'a+b');
});

test('applySearchHighlight source routes rendered mode through the TinyMCE highlighter', () => {
	// Guard the wiring: the rich/rendered branch must call highlightInTinyMCE
	// and the markdown branch must not be the only non-preview path. This is a
	// source-level assertion so a future refactor can't silently drop the
	// rendered-mode branch again (the original regression).
	const fnSrc = extractFn('applySearchHighlight');
	assert.match(fnSrc, /highlightInTinyMCE\(/, 'applySearchHighlight calls highlightInTinyMCE for rendered mode');
	assert.match(fnSrc, /clearTinyMCESearchMarks\(\)/, 'applySearchHighlight clears stale TinyMCE marks first');
	// highlightInTinyMCE must suppress edits so autosave/markdown-sync never
	// fires mid-highlight (otherwise <mark> nodes could leak into a save).
	const hl = extractFn('highlightInTinyMCE');
	assert.match(hl, /_tinymceSuppressEdits=true/, 'highlightInTinyMCE suppresses edits while inserting marks');
	// Dismiss must strip TinyMCE marks.
	const dismiss = extractFn('searchNavDismiss');
	assert.match(dismiss, /clearTinyMCESearchMarks\(\)/, 'searchNavDismiss clears TinyMCE marks');
});

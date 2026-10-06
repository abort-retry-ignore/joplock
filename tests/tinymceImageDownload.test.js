/**
 * Tests for the TinyMCE image download buttons (restored #note-preview parity).
 *
 * The old download button lived on the dead #note-preview host
 * (initResourceImageDownloadButtons via activatePV); all rendered content now
 * lives in the TinyMCE iframe, so initTinyMCEImageDownloadButtons wires the
 * buttons there instead. This file pins:
 *
 *   * Wiring: every img.preview-img[data-resource-id] in the editor body gets a
 *     .preview-img-download-wrap positioning span + a .preview-img-download-btn
 *     button that is empty, non-editable, data-mce-bogus="all" (so TinyMCE's
 *     serializer drops it from getContent) and click-wired to downloadResource.
 *   * Idempotence: re-running the init never duplicates buttons.
 *   * Serialization cleanliness: _stripTinymceDownloadChrome unwraps the wrap
 *     span; tinyMCEContent() and tinymceToMarkdown() strip the chrome so
 *     exports and the markdown sync see exactly the pre-injection DOM.
 *   * Round-trip: tinymceToMarkdown on wrapped/chromed HTML produces byte-equal
 *     markdown to the clean conversion (no phantom edits, no button text).
 *   * _anchorRectInHostDoc translates iframe-viewport rects into host-document
 *     coordinates so the resource-action sheet positions correctly when the
 *     anchor lives inside the TinyMCE iframe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const turndownSrc = fs.readFileSync(path.join(__dirname, '../public/turndown.min.js'), 'utf8');

const RID = '0123456789abcdef0123456789abcdef';

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

function runIn(ctx, ...fns) {
	for (const fn of fns) vm.runInContext(extractFn(fn), ctx);
}

// Minimal stand-in for the persistent TinyMCE editor over a JSDOM document.
function makeFakeEditor(doc) {
	const body = doc.createElement('div');
	doc.body.appendChild(body);
	return {
		editor: { getBody: () => body, getDoc: () => doc },
		body,
	};
}

// ---------------------------------------------------------------------------
// initTinyMCEImageDownloadButtons — wiring
// ---------------------------------------------------------------------------

function makeWiringCtx() {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const downloadResourceCalls = [];
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		// Arrow fn closing over a host array: `this` is not reliably bound when
		// the vm-realm listener calls back into a context property.
		downloadResource: (id, el) => { downloadResourceCalls.push([id, el]); },
	});
	return { dom, ctx, downloadResourceCalls };
}

test('resource images get a download button (wrap + bogus-marked button)', () => {
	const { dom, ctx } = makeWiringCtx();
	runIn(ctx, 'initTinyMCEImageDownloadButtons');
	const { editor, body } = makeFakeEditor(dom.window.document);
	body.innerHTML = `<p><img src="/resources/${RID}" alt="pic.png" class="preview-img" data-resource-id="${RID}" /></p>`;

	ctx.editor = editor;
	vm.runInContext('initTinyMCEImageDownloadButtons(editor)', ctx);

	const wrap = body.querySelector('span.preview-img-download-wrap');
	assert.ok(wrap, 'wrap span injected');
	assert.equal(wrap.parentElement.tagName, 'P', 'wrap stays inline inside the block');
	assert.equal(wrap.querySelector(`img[data-resource-id="${RID}"]`), body.querySelector('img'), 'img moved inside the wrap');

	const btn = wrap.querySelector('button.preview-img-download-btn');
	assert.ok(btn, 'button injected');
	assert.equal(btn.getAttribute('data-mce-bogus'), 'all', 'button is bogus-stripped from getContent');
	assert.equal(btn.getAttribute('contenteditable'), 'false', 'button is non-editable');
	assert.equal(btn.textContent, '', 'button has no text content (label comes from CSS ::after)');
	assert.equal(btn.getAttribute('aria-label'), 'Download image');
	assert.equal(btn.getAttribute('title'), 'Download image');
});

test('clicking the button calls downloadResource with the resource id', () => {
	const { dom, ctx, downloadResourceCalls } = makeWiringCtx();
	runIn(ctx, 'initTinyMCEImageDownloadButtons');
	const { editor, body } = makeFakeEditor(dom.window.document);
	body.innerHTML = `<p><img src="/resources/${RID}" alt="pic.png" class="preview-img" data-resource-id="${RID}" /></p>`;

	ctx.editor = editor;
	vm.runInContext('initTinyMCEImageDownloadButtons(editor)', ctx);
	const btn = body.querySelector('.preview-img-download-btn');
	assert.ok(btn);
	btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
	assert.deepEqual(downloadResourceCalls, [[RID, btn]]);
});

test('idempotent: re-running the init never duplicates buttons', () => {
	const { dom, ctx } = makeWiringCtx();
	runIn(ctx, 'initTinyMCEImageDownloadButtons');
	const { editor, body } = makeFakeEditor(dom.window.document);
	body.innerHTML = `<p><img src="/resources/${RID}" alt="pic.png" class="preview-img" data-resource-id="${RID}" /></p>`;

	ctx.editor = editor;
	vm.runInContext('initTinyMCEImageDownloadButtons(editor)', ctx);
	ctx.editor = editor;
	vm.runInContext('initTinyMCEImageDownloadButtons(editor)', ctx);
	assert.equal(body.querySelectorAll('.preview-img-download-btn').length, 1);
	assert.equal(body.querySelectorAll('.preview-img-download-wrap').length, 1);
});

test('plain imgs (no resource id) and foreign imgs are left untouched', () => {
	const { dom, ctx } = makeWiringCtx();
	runIn(ctx, 'initTinyMCEImageDownloadButtons');
	const { editor, body } = makeFakeEditor(dom.window.document);
	body.innerHTML = '<p><img src="https://example.com/x.png" alt="ext" /><img src="/resources/nope" alt="noattr" /></p>';

	ctx.editor = editor;
	vm.runInContext('initTinyMCEImageDownloadButtons(editor)', ctx);
	assert.equal(body.querySelectorAll('.preview-img-download-btn').length, 0);
});

// ---------------------------------------------------------------------------
// Serialization cleanliness
// ---------------------------------------------------------------------------

test('_stripTinymceDownloadChrome unwraps the span and drops the button', () => {
	const { ctx } = makeWiringCtx();
	runIn(ctx, '_stripTinymceDownloadChrome');
	const html = `<p>before<span class="preview-img-download-wrap"><img src="/resources/${RID}" alt="a" class="preview-img" data-resource-id="${RID}" /></span>after</p>`;
	const out = vm.runInContext(`_stripTinymceDownloadChrome(${JSON.stringify(html)})`, ctx);
	assert.equal(out, `<p>before<img src="/resources/${RID}" alt="a" class="preview-img" data-resource-id="${RID}" />after</p>`);
	assert.equal(vm.runInContext(`_stripTinymceDownloadChrome('')`, ctx), '');
	assert.equal(vm.runInContext(`_stripTinymceDownloadChrome(null)`, ctx), '');
});

test('tinyMCEContent() exports HTML without download chrome', () => {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		_tinymceEditor: {
			getContent: () => `<p><span class="preview-img-download-wrap"><img src="/resources/${RID}" alt="a" /></span></p>`,
		},
	});
	runIn(ctx, '_stripTinymceDownloadChrome', 'tinyMCEContent');
	const out = vm.runInContext('tinyMCEContent()', ctx);
	assert.ok(!out.includes('preview-img-download-wrap'), 'no wrap span in exported HTML');
	assert.ok(!out.includes('preview-img-download-btn'), 'no button in exported HTML');
	assert.ok(out.includes('<img'), 'img preserved');
});

// ---------------------------------------------------------------------------
// Round-trip: chrome must be invisible to the markdown sync
// ---------------------------------------------------------------------------

function makeTurndownCtx() {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		TurndownService: undefined,
		_tdService: null,
	});
	vm.runInContext(turndownSrc, ctx);
	return ctx;
}

function runTurndownDeps(ctx) {
	vm.runInContext("var _INLINE_TAGS_RE_SRC='a|abbr|b|bdi|bdo|cite|code|del|em|i|ins|kbd|label|mark|q|s|small|span|strong|sub|sup|time|u|var';", ctx);
	runIn(ctx, 'getTurndown', '_applyHeadingSpacing', '_encodeProtectedSpace', '_protectInlineLeadingSpace', '_restoreProtectedSpace', '_stripTinymceDownloadChrome', 'tinymceToMarkdown');
}

test('tinymceToMarkdown: wrapped + chromed image converts to the same markdown as clean HTML', () => {
	const ctx = makeTurndownCtx();
	runTurndownDeps(ctx);

	const clean = `<p><img src="/resources/${RID}" alt="pic.png" class="preview-img" data-resource-id="${RID}" /></p>`;
	const chromed = `<p><span class="preview-img-download-wrap"><img src="/resources/${RID}" alt="pic.png" class="preview-img" data-resource-id="${RID}" /><button type="button" class="preview-img-download-btn" contenteditable="false" data-mce-bogus="all"></button></span></p>`;

	const mdClean = vm.runInContext(`tinymceToMarkdown(${JSON.stringify(clean)}, '')`, ctx);
	const mdChromed = vm.runInContext(`tinymceToMarkdown(${JSON.stringify(chromed)}, '')`, ctx);
	assert.equal(mdChromed, mdClean, 'download chrome is invisible to the markdown sync');
	assert.equal(mdChromed.trim(), `![pic.png](:/${RID})`);
	assert.ok(!mdChromed.includes('\u2B07'), 'no button glyph leaks into markdown');
});

test('tinymceToMarkdown: linked image with wrap span keeps the link intact', () => {
	const ctx = makeTurndownCtx();
	runTurndownDeps(ctx);
	const html = `<p><a href="/resources/${RID}?download=1" data-resource-id="${RID}"><span class="preview-img-download-wrap"><img src="/resources/${RID}" alt="pic.png" class="preview-img" data-resource-id="${RID}" /></span></a></p>`;
	const md = vm.runInContext(`tinymceToMarkdown(${JSON.stringify(html)}, '')`, ctx);
	assert.equal(md.trim(), `[![pic.png](:/${RID})](:/${RID})`);
});

// ---------------------------------------------------------------------------
// Sheet positioning: iframe-anchored buttons must map into host-doc coordinates
// ---------------------------------------------------------------------------

test('_anchorRectInHostDoc offsets rects coming from inside an iframe', () => {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({ document: dom.window.document, window: dom.window });
	runIn(ctx, '_anchorRectInHostDoc');

	const iframe = dom.window.document.createElement('iframe');
	dom.window.document.body.appendChild(iframe);
	// JSDOM loads about:blank synchronously enough for contentDocument access
	// after append; guard in case of async behavior.
	const innerDoc = iframe.contentDocument;
	if (!innerDoc) return; // environment without frame support: skip silently

	const inner = innerDoc.createElement('button');
	innerDoc.body.appendChild(inner);

	// Fake rects: iframe sits at (100, 200) in the host doc; button at (10, 20)
	// relative to the iframe viewport.
	iframe.getBoundingClientRect = () => ({ left: 100, right: 700, top: 200, bottom: 900, width: 600, height: 700 });
	inner.getBoundingClientRect = () => ({ left: 10, right: 42, top: 30, bottom: 62, width: 32, height: 32 });

	ctx.innerBtn = inner;
	const translated = vm.runInContext('_anchorRectInHostDoc(innerBtn)', ctx);
	// Spread: objects created inside the vm context live in another realm, so
	// deepStrictEqual would compare prototypes and fail despite equal values.
	assert.deepEqual({ ...translated }, { left: 110, right: 142, top: 230, bottom: 262 });

	// Same-document anchors pass through untouched.
	const hostEl = dom.window.document.createElement('button');
	dom.window.document.body.appendChild(hostEl);
	hostEl.getBoundingClientRect = () => ({ left: 5, right: 15, top: 6, bottom: 16, width: 10, height: 10 });
	ctx.hostBtn = hostEl;
	const passthrough = vm.runInContext('_anchorRectInHostDoc(hostBtn)', ctx);
	assert.deepEqual({ ...passthrough }, { left: 5, right: 15, top: 6, bottom: 16 });
});
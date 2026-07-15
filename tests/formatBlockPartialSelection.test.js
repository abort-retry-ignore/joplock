/**
 * FormatBlock partial-selection regression test.
 *
 * Bug: highlighting a substring inside a single <p> and pressing H3 in
 * rendered mode converts the ENTIRE paragraph (often the entire note, when
 * the whole body lives in one <p>) to a heading. TinyMCE's FormatBlock
 * command is block-level, so it applies to the parent block regardless of
 * the selection extent.
 *
 * Fix: the BeforeExecCommand('FormatBlock') handler in public/app.js now
 * splits the containing <p> into up to three <p>s (before, selected, after)
 * when the selection is a partial range with no <br> siblings, then leaves
 * the middle <p> selected so FormatBlock reformats only that new block.
 *
 * This test rebuilds a minimal editor stub (getBody, getDoc, selection with
 * getRng/setRng/getContent/getNode) against JSDOM, runs the actual handler
 * body extracted from app.js, then asserts the DOM shape and selection.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// ---------------------------------------------------------------------------
// Extract the BeforeExecCommand handler body from app.js as source text.
// Strategy: find `editor.on('BeforeExecCommand',function(e){` and balance
// braces to grab the whole callback body, then wrap it as a callable fn.
// ---------------------------------------------------------------------------

function extractBeforeExecHandler() {
	const marker = "editor.on('BeforeExecCommand',function(e){";
	const idx = appSrc.indexOf(marker);
	assert.ok(idx !== -1, "BeforeExecCommand handler wiring not found in app.js");
	const bodyStart = idx + marker.length;
	let depth = 1, i = bodyStart;
	while (i < appSrc.length && depth > 0) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') depth--;
		i++;
	}
	// i now points just past the closing brace of the callback body.
	return appSrc.slice(bodyStart, i - 1);
}

// Also extract _splitBrBlock since the handler calls it.
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
// Build a minimal TinyMCE-like editor stub around a JSDOM body.
// ---------------------------------------------------------------------------

function makeEditorEnv(bodyHtml) {
	const dom = new JSDOM(`<!DOCTYPE html><body><div id="tinymce-body">${bodyHtml}</div></body>`, { url: 'https://joplock.test' });
	const doc = dom.window.document;
	const body = doc.getElementById('tinymce-body');
	let currentRange = null;
	const selection = {
		getNode() {
			if (!currentRange) return body;
			// TinyMCE's selection.getNode() returns the "most representative"
			// node for the selection, typically the element containing the
			// end of the range (the caret's visual position after a click).
			var end = currentRange.endContainer;
			return end.nodeType === 1 ? end : end.parentNode;
		},
		getRng() { return currentRange ? currentRange.cloneRange() : null; },
		setRng(r) { currentRange = r; },
		getContent(opts) {
			if (!currentRange) return '';
			if (opts && opts.format === 'text') return currentRange.toString();
			return currentRange.toString();
		},
	};
	const editor = {
		getBody() { return body; },
		getDoc() { return doc; },
		selection,
	};
	return { dom, doc, body, editor, setRange: (r) => { currentRange = r; } };
}

// Build the handler as a callable fn(editor, event) in a shared closure that
// provides _tinymceSuppressEdits + _splitBrBlock.
function makeHandler() {
	const body = extractBeforeExecHandler();
	const splitFnSrc = extractFn('_splitBrBlock');
	// eslint-disable-next-line no-new-func
	return new Function('editor', 'e', `
		var _tinymceSuppressEdits = false;
		${splitFnSrc}
		${body}
	`);
}

// ---------------------------------------------------------------------------
// Helpers to build ranges over text nodes
// ---------------------------------------------------------------------------

function rangeInText(doc, textNode, start, end) {
	const r = doc.createRange();
	r.setStart(textNode, start);
	r.setEnd(textNode, end);
	return r;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('partial selection inside a single <p> splits into before + selected + after', () => {
	const { doc, body, editor, setRange } = makeEditorEnv('<p>hello beautiful world</p>');
	const p = body.querySelector('p');
	const text = p.firstChild;
	// Select "beautiful"
	setRange(rangeInText(doc, text, 6, 15));
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	const ps = Array.from(body.querySelectorAll('p'));
	assert.equal(ps.length, 3, 'must split into 3 <p>s; got ' + ps.length + ' -> ' + body.innerHTML);
	assert.equal(ps[0].textContent, 'hello ', 'first <p> keeps text before selection');
	assert.equal(ps[1].textContent, 'beautiful', 'middle <p> holds only the selection');
	assert.equal(ps[2].textContent, ' world', 'third <p> keeps text after selection');
});

test('after partial-selection split, the selection now spans the middle <p> (so FormatBlock applies to it)', () => {
	const { doc, body, editor, setRange } = makeEditorEnv('<p>alpha beta gamma</p>');
	const text = body.querySelector('p').firstChild;
	setRange(rangeInText(doc, text, 6, 10)); // "beta"
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	const ps = Array.from(body.querySelectorAll('p'));
	assert.equal(ps.length, 3);
	assert.equal(ps[1].textContent, 'beta');
	// The handler must leave selection on the middle <p> so TinyMCE's
	// FormatBlock (running immediately after) reformats only that block.
	const rng = editor.selection.getRng();
	assert.ok(rng, 'selection must exist after split');
	// Range must be contained entirely within the middle <p>
	assert.ok(ps[1].contains(rng.startContainer) || rng.startContainer === ps[1],
		'range start must be within middle <p>; got ' + (rng.startContainer && rng.startContainer.nodeName));
	assert.ok(ps[1].contains(rng.endContainer) || rng.endContainer === ps[1],
		'range end must be within middle <p>');
});

test('selection at the very start of a <p> yields no leading empty <p>', () => {
	const { doc, body, editor, setRange } = makeEditorEnv('<p>hello world</p>');
	const text = body.querySelector('p').firstChild;
	setRange(rangeInText(doc, text, 0, 5)); // "hello"
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	const ps = Array.from(body.querySelectorAll('p'));
	// Should be: "hello" | " world" — 2 blocks, no empty leader.
	assert.equal(ps.length, 2, 'no leading empty <p>; got ' + body.innerHTML);
	assert.equal(ps[0].textContent, 'hello');
	assert.equal(ps[1].textContent, ' world');
});

test('selection at the very end of a <p> yields no trailing empty <p>', () => {
	const { doc, body, editor, setRange } = makeEditorEnv('<p>hello world</p>');
	const text = body.querySelector('p').firstChild;
	setRange(rangeInText(doc, text, 6, 11)); // "world"
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	const ps = Array.from(body.querySelectorAll('p'));
	assert.equal(ps.length, 2, 'no trailing empty <p>; got ' + body.innerHTML);
	assert.equal(ps[0].textContent, 'hello ');
	assert.equal(ps[1].textContent, 'world');
});

test('full-block selection is a no-op (handler leaves single <p>, FormatBlock will convert it)', () => {
	// If the entire block is selected, splitting into [empty][full][empty]
	// would create phantom blank paragraphs. isPartial=false so we bail —
	// FormatBlock then behaves as expected (whole block becomes heading).
	const { doc, body, editor, setRange } = makeEditorEnv('<p>just this line</p>');
	const text = body.querySelector('p').firstChild;
	setRange(rangeInText(doc, text, 0, text.textContent.length));
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	const ps = Array.from(body.querySelectorAll('p'));
	assert.equal(ps.length, 1, 'must not split when whole block is selected; got ' + body.innerHTML);
	assert.equal(ps[0].textContent, 'just this line');
});

test('collapsed caret (no selection) does not partial-split; original BR-split behavior preserved for empty range', () => {
	// Collapsed range inside a plain <p> (no BR) should not create three blocks.
	const { doc, body, editor, setRange } = makeEditorEnv('<p>hello world</p>');
	const text = body.querySelector('p').firstChild;
	const rng = doc.createRange();
	rng.setStart(text, 3);
	rng.collapse(true);
	setRange(rng);
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	const ps = Array.from(body.querySelectorAll('p'));
	assert.equal(ps.length, 1, 'collapsed caret in single-line <p> must not split; got ' + body.innerHTML);
});

test('non-FormatBlock commands are ignored', () => {
	const { doc, body, editor, setRange } = makeEditorEnv('<p>hello world</p>');
	const text = body.querySelector('p').firstChild;
	setRange(rangeInText(doc, text, 2, 5));
	const handler = makeHandler();
	handler(editor, { command: 'Bold' });
	assert.equal(body.querySelectorAll('p').length, 1, 'non-FormatBlock must not touch the DOM');
	assert.equal(body.querySelector('p').textContent, 'hello world');
});

test('BR-separated multi-line paragraph still uses BR-split path (partial-split does not kick in)', () => {
	// Regression guard: the BR case has its own well-tested split path.
	// We assert it fires by checking the block gets split into per-line <p>s
	// when the caret sits on one of the lines.
	const { doc, body, editor, setRange } = makeEditorEnv('<p>line1<br>line2<br>line3</p>');
	const p = body.querySelector('p');
	// Caret in "line2" (second text node)
	const line2 = p.childNodes[2]; // after first <br>
	assert.equal(line2.textContent, 'line2');
	const rng = doc.createRange();
	rng.setStart(line2, 2);
	rng.collapse(true);
	setRange(rng);
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	const ps = Array.from(body.querySelectorAll('p'));
	assert.equal(ps.length, 3, 'BR-separated <p> must be split into 3 <p>s');
	assert.equal(ps[0].textContent, 'line1');
	assert.equal(ps[1].textContent, 'line2');
	assert.equal(ps[2].textContent, 'line3');
});

// ---------------------------------------------------------------------------
// Heading clamp: demoting <h*> to paragraph via the blocks dropdown must
// not touch sibling blocks. This is the "select bbb H2, then set Paragraph
// -> both aaa H3 and bbb H2 become paragraphs" bug.
// ---------------------------------------------------------------------------

test('caret inside a heading with a well-formed range: handler leaves DOM alone (TinyMCE toggles single block)', () => {
	// When the range is entirely inside the heading, no clamp needed. The
	// handler must NOT mutate the DOM — TinyMCE's FormatBlock then demotes
	// just this one <h3> to <p>. Siblings must survive.
	const { doc, body, editor, setRange } = makeEditorEnv('<h3>aaa</h3><h2>bbb</h2>');
	const h2 = body.querySelectorAll('h2')[0];
	const text = h2.firstChild;
	const rng = doc.createRange();
	rng.setStart(text, 1);
	rng.collapse(true);
	setRange(rng);
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	// DOM must still have both siblings intact — TinyMCE's FormatBlock will
	// convert only the current block after this returns.
	assert.equal(body.querySelectorAll('h3').length, 1, 'aaa heading must survive; got ' + body.innerHTML);
	assert.equal(body.querySelector('h3').textContent, 'aaa');
	assert.equal(body.querySelector('h2').textContent, 'bbb');
});

test('caret inside a heading with a bogus range that spans previous sibling: handler clamps to this block', () => {
	// Simulates the reported bug: range endpoints stray outside the current
	// heading (into an earlier <h3>), so TinyMCE would demote both. The
	// handler must clamp the range to strictly inside the current <h2>.
	const { doc, body, editor, setRange } = makeEditorEnv('<h3>aaa</h3><h2>bbb</h2>');
	const h3 = body.querySelector('h3');
	const h2 = body.querySelector('h2');
	// Build a pathological range: start in the previous sibling, end inside h2.
	const rng = doc.createRange();
	rng.setStart(h3.firstChild, 0);
	rng.setEnd(h2.firstChild, 3);
	setRange(rng);
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	// After the handler, the selection must be clamped to strictly inside h2.
	const after = editor.selection.getRng();
	assert.ok(after, 'range must still exist');
	assert.ok(h2.contains(after.startContainer) || after.startContainer === h2,
		'clamped range start must be inside h2; got ' + (after.startContainer && after.startContainer.nodeName));
	assert.ok(h2.contains(after.endContainer) || after.endContainer === h2,
		'clamped range end must be inside h2');
	assert.ok(!h3.contains(after.startContainer) && after.startContainer !== h3,
		'clamped range must not touch h3 anymore');
	// DOM unchanged — clamp only affects selection.
	assert.equal(body.querySelector('h3').textContent, 'aaa');
	assert.equal(body.querySelector('h2').textContent, 'bbb');
});

test('collapsed caret in a heading: no DOM mutation (TinyMCE toggles this block only)', () => {
	const { doc, body, editor, setRange } = makeEditorEnv('<h3>heading text</h3>');
	const text = body.querySelector('h3').firstChild;
	const rng = doc.createRange();
	rng.setStart(text, 4);
	rng.collapse(true);
	setRange(rng);
	const handler = makeHandler();
	const beforeHtml = body.innerHTML;
	handler(editor, { command: 'FormatBlock' });
	assert.equal(body.innerHTML, beforeHtml, 'handler must not mutate DOM for collapsed caret in heading');
});

test('heading path is not affected by partial-selection split logic', () => {
	// Partial highlight inside a heading should NOT split it into 3 blocks;
	// heading path returns early after (optional) clamp.
	const { doc, body, editor, setRange } = makeEditorEnv('<h2>abc def ghi</h2>');
	const text = body.querySelector('h2').firstChild;
	const rng = doc.createRange();
	rng.setStart(text, 4);
	rng.setEnd(text, 7); // "def"
	setRange(rng);
	const handler = makeHandler();
	handler(editor, { command: 'FormatBlock' });
	assert.equal(body.querySelectorAll('h2').length, 1, 'heading must not be split into multiple blocks');
	assert.equal(body.querySelectorAll('p').length, 0, 'no phantom <p>s introduced');
	assert.equal(body.querySelector('h2').textContent, 'abc def ghi');
});

// ---------------------------------------------------------------------------
// Sync guard: TinyMCE built-in commands (blocks dropdown -> FormatBlock,
// lists, removeformat, etc.) mutate the iframe DOM without firing 'input'
// or 'change'. If onEdit is not also wired to ExecCommand + SetContent,
// the sync from editor.getContent() -> #note-body never runs, formHash
// stays equal to _savedHash, and scheduleSave silently skips the save.
// This test pins that the two extra listeners are wired in app.js source.
// ---------------------------------------------------------------------------

test('app.js: onEdit is wired to ExecCommand so builtin commands trigger #note-body sync', () => {
	assert.ok(
		appSrc.includes("editor.on('ExecCommand',function(e){onEdit("),
		"onEdit must be wired to editor.on('ExecCommand',...)"
	);
});

test('app.js: onEdit is wired to SetContent so programmatic content updates sync (guarded by _tinymceSuppressEdits during load)', () => {
	assert.ok(
		appSrc.includes("editor.on('SetContent',function(){onEdit("),
		"onEdit must be wired to editor.on('SetContent',...)"
	);
});

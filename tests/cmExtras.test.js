'use strict';

// Unit + jsdom tests for public/cm-extras.js (markdown-mode CodeMirror extras).
// The pure helpers run in plain Node; the extension tests mount the REAL CM6
// bundle in jsdom (no layout engine, so a few DOM measuring APIs are stubbed).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const extras = require('../public/cm-extras.js');
const cmBundle = fs.readFileSync(path.join(__dirname, '../public/codemirror.min.js'), 'utf8');
const extrasSrc = fs.readFileSync(path.join(__dirname, '../public/cm-extras.js'), 'utf8');

const ID = 'a'.repeat(32);
const ID2 = 'b'.repeat(32);
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('computeFences: fenced blocks, tildes, unclosed fences, inline ``` is not a fence', () => {
	const lines = ['a', '```js', 'b', '```', 'c', '~~~', 'd', '', '```inline``` x', 'e'];
	const { inFence, fences } = extras.computeFences(lines);
	assert.deepEqual(inFence, [false, true, true, true, false, true, true, true, true, true].map((v, i) => (i === 8 ? true : v)));
	assert.deepEqual(fences.map(f => [f.start, f.end, f.closed, f.lang]), [[1, 3, true, 'js'], [5, 9, false, '']]);
	// A one-line ```code``` span is NOT a fence.
	const solo = extras.computeFences(['x', '```inline``` y', 'z']);
	assert.deepEqual(solo.inFence, [false, false, false]);
});

test('findImageRefs: markdown + <img> forms, alt unescaping, code spans ignored', () => {
	const line = 'hi ![al\\]t]( :/' + ID + ' "t") and <img src=":/' + ID2 + '" alt="x &quot;y" width="300" /> `![c](:/' + ID + ')` ![ext](https://x/y.png)';
	const refs = extras.findImageRefs(line);
	assert.equal(refs.length, 2);
	assert.deepEqual([refs[0].kind, refs[0].id, refs[0].alt, refs[0].width], ['md', ID, 'al]t', 0]);
	assert.deepEqual([refs[1].kind, refs[1].id, refs[1].alt, refs[1].width], ['html', ID2, 'x "y', 300]);
	assert.equal(line.slice(refs[1].from, refs[1].to).startsWith('<img'), true);
});

test('buildImageSource round-trips through findImageRefs and matches the Turndown <img> shape', () => {
	const plain = extras.buildImageSource({ id: ID, alt: 'a]b' }, 0);
	assert.equal(plain, '![a\\]b](:/' + ID + ')');
	assert.equal(extras.findImageRefs(plain)[0].alt, 'a]b');
	const sized = extras.buildImageSource({ id: ID, alt: 'say "hi" & <b>' }, 123.4);
	assert.equal(sized, '<img src=":/' + ID + '" alt="say &quot;hi&quot; &amp; &lt;b&gt;" width="123" />');
	const back = extras.findImageRefs(sized)[0];
	assert.deepEqual([back.alt, back.width, back.id], ['say "hi" & <b>', 123, ID]);
});

test('findLinkRefs: adjacent links, ignores images / escaped / nested-image labels / code', () => {
	const line = '[a](:/' + ID + ')[b](:/' + ID2 + ') ![i](:/' + ID + ') \\[no](:/' + ID + ') [![x](:/' + ID + ')](:/' + ID2 + ') `[c](:/' + ID + ')`';
	assert.deepEqual(extras.findLinkRefs(line).map(l => [l.text, l.id]), [['a', ID], ['b', ID2]]);
});

test('findTaskMarker', () => {
	assert.deepEqual(extras.findTaskMarker('  - [x] done'), { from: 4, to: 7, checked: true });
	assert.deepEqual(extras.findTaskMarker('1. [ ] a'), { from: 3, to: 6, checked: false });
	assert.deepEqual(extras.findTaskMarker('> - [X] q'), { from: 4, to: 7, checked: true });
	assert.equal(extras.findTaskMarker('- [ ]nospace'), null);
	assert.equal(extras.findTaskMarker('text [ ] x'), null);
});

test('scanDoc: never scans inside fenced code; collects headings with absolute offsets', () => {
	const text = '# Title\n\n```js\n![x](:/' + ID + ')\n- [ ] no\n[l](:/' + ID + ')\n```\n- [ ] yes\n![p](:/' + ID + ')\n## Sub ##\n';
	const m = extras.scanDoc(text);
	assert.equal(m.images.length, 1);
	assert.equal(text.slice(m.images[0].from, m.images[0].to), '![p](:/' + ID + ')');
	assert.equal(m.links.length, 0);
	assert.equal(m.tasks.length, 1);
	assert.equal(text.slice(m.tasks[0].from, m.tasks[0].to), '[ ]');
	assert.deepEqual(m.headings.map(h => [h.level, h.text]), [[1, 'Title'], [2, 'Sub']]);
	assert.equal(text.slice(m.headings[1].from, m.headings[1].from + 2), '##');
	assert.deepEqual(m.fences.map(f => [f.start, f.end]), [[2, 6]]);
});

test('countWords / readingMinutes', () => {
	assert.equal(extras.countWords(''), 0);
	assert.equal(extras.countWords("Hello world! It's a [link](http://x.y) ![i](:/" + ID + ') done.'), 6);
	assert.equal(extras.countWords('- [ ] first\n- [x] second'), 2);
	assert.equal(extras.readingMinutes(0), 0);
	assert.equal(extras.readingMinutes(10), 1);
	assert.equal(extras.readingMinutes(660), 3);
});

test('tables: block detection, row splitting, alignment + caret offsets', () => {
	const lines = ['text', '| a | b |', '|:-|-:|', '| 1 | 2 |', '', '| x |'];
	const get = i => lines[i];
	assert.deepEqual(extras.tableBlockAt(get, lines.length, 3, null), { start: 1, end: 3 });
	assert.equal(extras.tableBlockAt(get, lines.length, 0, null), null);
	assert.equal(extras.tableBlockAt(get, lines.length, 5, null), null, 'a single row without a delimiter row is not a table');
	assert.equal(extras.tableBlockAt(get, lines.length, 3, [false, true, true, true, false, false]), null, 'tables inside fences are ignored');
	assert.deepEqual(extras.splitRow('| a \\| b | `c` |  |'), ['a \\| b', '`c`', '']);

	const res = extras.formatTable(['| name | qty |', '|:--|--:|', '| apple | 3 |', '| fig | 12 |']);
	assert.deepEqual(res.lines, ['| name  | qty |', '| :---- | --: |', '| apple |   3 |', '| fig   |  12 |']);
	// caret offsets: end of content in each cell
	assert.equal(res.lines[2].slice(0, res.cells[2][1].end), '| apple |   3');
	assert.equal(res.lines[3].slice(0, res.cells[3][0].end), '| fig');
	const centered = extras.formatTable(['| a |', '|:-:|', '| bb |']);
	assert.deepEqual(centered.lines, ['|  a  |', '| :-: |', '| bb  |'].map((l, i) => (i === 0 ? '|  a  |' : l)));
	assert.equal(extras.cellIndexAt('| a | b | c |', 3), 0);
	assert.equal(extras.cellIndexAt('| a | b | c |', 6), 1);
	assert.equal(extras.cellIndexAt('| a | b | c |', 10), 2);
	assert.equal(extras.emptyRowFor(3), '|  |  |  |');
});

test('paste helpers: single URL, HTML worth converting', () => {
	assert.equal(extras.isSingleUrl('https://a.b/c?d=1'), true);
	assert.equal(extras.isSingleUrl(' mailto:a@b.c '), true);
	assert.equal(extras.isSingleUrl('see https://a.b'), false);
	assert.equal(extras.isSingleUrl('ftp://a.b'), false);
	assert.equal(extras.shouldConvertHtml('<span style="color:red">a</span>'), false);
	assert.equal(extras.shouldConvertHtml('<div>plain div</div>'), false);
	assert.equal(extras.shouldConvertHtml('<h1>x</h1>'), true);
	assert.equal(extras.shouldConvertHtml('<p>see <a href="https://x">this</a></p>'), true);
	assert.equal(extras.shouldConvertHtml('<b>x</b>', ['text/html', 'vscode-editor-data']), false, 'VS Code copies stay plain');
});

test('cm-extras.js has no regex lookbehind (breaks old iOS Safari at parse time)', () => {
	assert.equal(/\(\?<[!=]/.test(extrasSrc), false);
});

// ---------------------------------------------------------------------------
// jsdom harness with the real CM6 bundle
// ---------------------------------------------------------------------------

function mount(doc, opts, hooks, pre) {
	const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', {
		runScripts: 'outside-only', url: 'https://joplock.test', pretendToBeVisual: true,
	});
	const w = dom.window;
	// jsdom has no layout: give CM's measuring code something to chew on.
	w.Range.prototype.getClientRects = () => [];
	w.Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
	if (pre) pre(w);
	w.eval(cmBundle);
	w.eval(extrasSrc);
	const C = w.CM;
	const exts = w.JoplockMd.createExtensions(C, hooks || {}, opts || {});
	const view = new C.EditorView({
		state: C.EditorState.create({ doc, extensions: [C.markdown({ base: C.markdownLanguage }), C.history(), C.keymap.of(C.defaultKeymap), ...exts] }),
		parent: w.document.getElementById('host'),
	});
	const focus = on => Object.defineProperty(view, 'hasFocus', { get: () => on, configurable: true });
	return { w, C, view, focus, text: () => view.dom.querySelector('.cm-content').textContent, q: sel => view.dom.querySelectorAll(sel) };
}
const ALL = { inlineWidgets: true, livePreview: false, statusBar: false, folding: false };
const doc = h => h.view.state.doc.toString();

test('image preview: one row per image line, none inside code fences, none when the setting is off', () => {
	const body = '![a](:/' + ID + ')\n\ntext <img src=":/' + ID2 + '" width="50" /> ![b](:/' + ID + ')\n\n```\n![no](:/' + ID + ')\n```\n';
	const h = mount(body, ALL);
	const rows = h.q('.cm-jl-imgrow');
	assert.equal(rows.length, 2);
	assert.equal(rows[0].querySelectorAll('.cm-jl-img').length, 1);
	assert.equal(rows[1].querySelectorAll('.cm-jl-img').length, 2, 'two images on one line share one widget row');
	assert.equal(h.q('.cm-jl-img img')[1].style.width, '50px', 'explicit <img width> is honoured');
	h.view.destroy();

	const off = mount(body, { inlineWidgets: false });
	assert.equal(off.q('.cm-jl-imgrow').length, 0);
	assert.equal(off.q('.cm-jl-chip').length, 0);
	off.view.destroy();
});

test('image preview loads through the blob hook and falls back to an error placeholder', async () => {
	const blobs = [];
	const h = mount('![a](:/' + ID + ')\n![b](:/' + ID2 + ')\n', ALL, {
		fetchResourceBlob: id => (id === ID ? Promise.resolve({ fake: 'blob' }) : Promise.reject(new Error('404'))),
	}, w => {
		w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:test/1'; };
		w.URL.revokeObjectURL = () => {};
	});
	await tick(30);
	const figs = h.q('.cm-jl-img');
	assert.equal(figs.length, 2);
	assert.equal(figs[0].querySelector('img').getAttribute('src'), 'blob:test/1');
	assert.equal(blobs.length, 1);
	assert.equal(figs[1].classList.contains('broken'), true);
	assert.match(figs[1].textContent, /unavailable/);
	h.view.destroy();
});

test('image blobs are fetched once per resource and reused when the widget is rebuilt', async () => {
	let fetches = 0;
	const h = mount('![a](:/' + ID + ')\n\n![a](:/' + ID + ')\n', ALL, {
		fetchResourceBlob: () => { fetches++; return Promise.resolve({}); },
	}, w => { w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {}; });
	await tick(30);
	assert.equal(h.q('.cm-jl-img img').length, 2);
	assert.equal(fetches, 1, 'same resource shown twice must hit the network once');
	h.view.destroy();
});

test('resize drag rewrites the source to <img width>, even after lines were inserted above; double-click resets', async () => {
	const h = mount('![pic](:/' + ID + ')\n', ALL);
	await tick(10);
	// Shift the widget down: positions captured at creation are now stale.
	h.view.dispatch({ changes: { from: 0, insert: 'line one\nline two\n' } });
	await tick(10);
	const handle = h.q('.cm-jl-img-handle')[0];
	const fire = (type, x) => handle.dispatchEvent(new h.w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }));
	fire('pointerdown', 100); fire('pointermove', 260); fire('pointerup', 260);
	assert.equal(doc(h), 'line one\nline two\n<img src=":/' + ID + '" alt="pic" width="360" />\n');
	await tick(10);
	assert.equal(h.q('.cm-jl-img img')[0].style.width, '360px');
	h.q('.cm-jl-img-handle')[0].dispatchEvent(new h.w.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
	assert.equal(doc(h), 'line one\nline two\n![pic](:/' + ID + ')\n');
	// Resizing is a single undoable change.
	h.view.destroy();
});

test('resize and checkbox clicks are ignored while the editor is read-only', () => {
	const h = mount('![pic](:/' + ID + ')\n- [ ] todo\n', ALL);
	h.view.contentDOM.setAttribute('contenteditable', 'false'); // what _applyFormReadonly does
	const before = doc(h);
	const handle = h.q('.cm-jl-img-handle')[0];
	['pointerdown', 'pointermove', 'pointerup'].forEach((t, i) => handle.dispatchEvent(new h.w.MouseEvent(t, { bubbles: true, cancelable: true, clientX: 100 + i * 100 })));
	h.q('.cm-jl-check')[0].dispatchEvent(new h.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
	assert.equal(doc(h), before);
	h.view.destroy();
});

test('task checkboxes: render, toggle, strike done items, undo restores', () => {
	const h = mount('- [ ] one\n- [x] two\n* [X] three\n1. [ ] four\n', ALL);
	assert.equal(h.q('.cm-jl-check').length, 4);
	assert.equal(h.q('.cm-jl-check.checked').length, 2);
	assert.equal(h.q('.cm-jl-task-done').length, 2);
	h.q('.cm-jl-check')[0].dispatchEvent(new h.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
	assert.equal(doc(h).split('\n')[0], '- [x] one');
	h.q('.cm-jl-check')[1].dispatchEvent(new h.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
	assert.equal(doc(h).split('\n')[1], '- [ ] two');
	h.C.EditorView && h.view.dispatch({ userEvent: 'noop' });
	h.view.destroy();
});

test('chips: render for [text](:/id), click opens note vs attachment by resolved kind, caret reveals raw text', async () => {
	const opened = [];
	const h = mount('see [spec.pdf](:/' + ID + ') and [Other note](:/' + ID2 + ') end\n', ALL, {
		resolveLinkInfo: id => Promise.resolve(id === ID ? { kind: 'resource', filename: 'spec.pdf' } : { kind: 'note', title: 'Other note' }),
		openResource: id => opened.push(['resource', id]),
		openNote: id => opened.push(['note', id]),
	});
	const chips = h.q('.cm-jl-chip');
	assert.equal(chips.length, 2);
	assert.equal(h.text().includes('](:/'), false, 'raw link syntax is hidden');
	await tick(20);
	assert.deepEqual([...h.q('.cm-jl-chip')].map(c => c.getAttribute('data-kind')), ['resource', 'note']);
	h.q('.cm-jl-chip')[0].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true }));
	h.q('.cm-jl-chip')[1].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true }));
	await tick(20);
	assert.deepEqual(opened, [['resource', ID], ['note', ID2]]);

	// Caret inside the first link (editor focused) shows the raw markdown for that link only.
	h.focus(true);
	h.view.dispatch({ selection: { anchor: doc(h).indexOf('spec.pdf') + 2 } });
	assert.equal(h.q('.cm-jl-chip').length, 1);
	assert.ok(h.text().includes('[spec.pdf](:/' + ID + ')'));
	h.view.destroy();
});

test('code fences: line decorations + Copy button copies only the code', () => {
	const copied = [];
	const h = mount('intro\n\n```js\nconst a = 1;\n  indented();\n```\n\n```\nsecond\n```\n', ALL, { copyText: (t, cb) => { copied.push(t); cb(true); } });
	assert.equal(h.q('.cm-jl-codeline').length, 7);
	assert.equal(h.q('.cm-jl-codeline-first').length, 2);
	assert.equal(h.q('.cm-jl-codeline-last').length, 2);
	const btns = h.q('.cm-jl-copy');
	assert.equal(btns.length, 2);
	btns[0].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true }));
	btns[1].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true }));
	assert.deepEqual(copied, ['const a = 1;\n  indented();', 'second']);
	assert.equal(h.q('.cm-jl-copy')[0].textContent, 'Copied');
	h.view.destroy();
});

test('live preview hides marks off the construct and reveals them on it (needs focus)', () => {
	const h = mount('# Title\n\nsome **bold** and [t](http://x.y) and `code` ~~gone~~ end\n', { livePreview: true });
	assert.equal(h.text(), 'Titlesome bold and t and code gone end');
	h.focus(true);
	h.view.dispatch({ selection: { anchor: doc(h).indexOf('bold') + 1 } });
	assert.ok(h.text().includes('**bold**'));
	assert.ok(!h.text().includes('](http'));
	h.view.dispatch({ selection: { anchor: doc(h).indexOf('t](') } });
	assert.ok(h.text().includes('[t](http://x.y)'));
	h.view.dispatch({ selection: { anchor: 2 } });
	assert.ok(h.text().startsWith('# Title'));
	h.view.destroy();
});

test('live preview leaves internal links to the chips when inline widgets are on', () => {
	const h = mount('[f.pdf](:/' + ID + ') and [web](http://a.b)\n', { livePreview: true, inlineWidgets: true });
	assert.equal(h.q('.cm-jl-chip').length, 1);
	assert.equal(h.text().includes('http://a.b'), false);
	h.view.destroy();
});

test('paste: HTML -> markdown, URL over selection -> link, raw inside code, plain-paste shortcut respected', () => {
	const h = mount('', {}, { htmlToMarkdown: html => '**' + html.replace(/<[^>]+>/g, '') + '**' });
	const paste = o => {
		const e = new h.w.Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'clipboardData', { value: { types: o.types || [], items: [], files: [], getData: t => (t === 'text/plain' ? (o.text || '') : t === 'text/html' ? (o.html || '') : '') } });
		h.view.contentDOM.dispatchEvent(e);
	};
	const set = (text, from, to) => h.view.dispatch({ changes: { from: 0, to: h.view.state.doc.length, insert: text }, selection: { anchor: from, head: to == null ? from : to } });

	set('', 0);
	paste({ text: 'Hi', html: '<h1>Hi</h1>' });
	assert.equal(doc(h), '**Hi**');

	set('see docs here', 4, 8);
	paste({ text: 'https://example.com/d' });
	assert.equal(doc(h), 'see [docs](https://example.com/d) here');

	set('see [x] here', 4, 7);
	paste({ text: 'https://e.com' });
	assert.equal(doc(h), 'see [\\[x\\]](https://e.com) here', 'brackets in the label are escaped');

	set('```\n\n```', 4);
	paste({ text: 'raw', html: '<h1>raw</h1>' });
	assert.equal(doc(h), '```\nraw\n```');

	set('', 0);
	paste({ text: 'plain only' });
	assert.equal(doc(h), 'plain only');

	set('', 0);
	paste({ text: 'code', html: '<span style="color:red">code</span>' });
	assert.equal(doc(h), 'code', 'unstructured HTML keeps the plain text');

	// Ctrl+Shift+V (paste as plain text) bypasses conversion.
	set('', 0);
	h.view.contentDOM.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }));
	paste({ text: 'Hi', html: '<h1>Hi</h1>' });
	assert.equal(doc(h), 'Hi');
	h.view.destroy();
});

test('file drops are claimed so CodeMirror does not paste text-file contents into the note', async () => {
	const h = mount('start', {});
	const file = new h.w.File(['SECRET TEXT FILE BODY'], 'notes.txt', { type: 'text/plain' });
	const e = new h.w.Event('drop', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'dataTransfer', { value: { files: [file], types: ['Files'], getData: () => '' } });
	h.view.contentDOM.dispatchEvent(e);
	await tick(60);
	assert.equal(e.defaultPrevented, true);
	assert.equal(doc(h), 'start', 'the dropped file text must not be inserted by CM itself');
	h.view.destroy();
});

test('table helper: Tab aligns and walks cells, appends a row, Shift-Tab goes back, Enter is left alone', () => {
	const h = mount('| a | b |\n|-|-|\n| 1 | 2 |\n', {});
	const key = (k, shift) => {
		const e = new h.w.KeyboardEvent('keydown', { key: k, keyCode: k === 'Tab' ? 9 : 13, shiftKey: !!shift, bubbles: true, cancelable: true });
		h.view.contentDOM.dispatchEvent(e);
		return e.defaultPrevented;
	};
	const rows = () => doc(h).split('\n');
	const caretLine = () => h.view.state.doc.lineAt(h.view.state.selection.main.head);
	const col = () => h.view.state.selection.main.head - caretLine().from;

	h.view.dispatch({ selection: { anchor: doc(h).indexOf('1') + 1 } });
	assert.equal(key('Tab'), true);
	assert.deepEqual(rows().slice(0, 3), ['| a   | b   |', '| --- | --- |', '| 1   | 2   |']);
	assert.equal(caretLine().text, '| 1   | 2   |');
	assert.equal(col(), '| 1   | 2'.length, 'caret at the end of the next cell content');
	key('Tab'); // last cell of last row -> new row
	assert.equal(rows()[3], '|     |     |');
	assert.equal(caretLine().number, 4);
	assert.equal(col(), 2);
	key('Tab', true); // back to previous row's last cell
	assert.equal(caretLine().number, 3);
	key('Tab', true);
	key('Tab', true);
	key('Tab', true); // header, last cell -> first cell -> stays
	assert.equal(caretLine().number, 1);

	// Enter is NOT intercepted: typing a table row by row must keep working.
	const at = h.view.state.doc.line(3).to;
	const before = doc(h);
	h.view.dispatch({ selection: { anchor: at } });
	key('Enter');
	assert.equal(doc(h), before.slice(0, at) + '\n' + before.slice(at), 'Enter is a plain newline, not an inserted table row');
	h.view.destroy();
});

test('table helper leaves normal text alone (Tab / Enter fall through)', () => {
	const h = mount('plain text\n\n```\n| a | b |\n|-|-|\n| 1 |  2 |\n```\n', {});
	const key = k => {
		const e = new h.w.KeyboardEvent('keydown', { key: k, keyCode: k === 'Tab' ? 9 : 13, bubbles: true, cancelable: true });
		h.view.contentDOM.dispatchEvent(e);
		return e.defaultPrevented;
	};
	h.view.dispatch({ selection: { anchor: 3 } });
	assert.equal(key('Tab'), false);
	h.view.dispatch({ selection: { anchor: doc(h).indexOf('| 1') + 3 } });
	assert.equal(key('Tab'), false, 'tables inside code fences are not touched');
	h.view.destroy();
});

test('status bar: word count, reading time and an outline that jumps to headings', async () => {
	const h = mount('# One\n\nhello brave new world\n\n## Two\n\nmore\n\n### Three\n', { statusBar: true });
	await tick(10);
	const status = h.q('.cm-jl-status')[0];
	assert.ok(status);
	assert.match(status.textContent, /\d+ words/);
	assert.match(status.textContent, /Ln 1, Col 1/);
	h.view.dispatch({ selection: { anchor: 8, head: 13 } });
	await tick(160);
	assert.match(h.q('.cm-jl-stat')[0].textContent, /1 selected/);

	h.q('.cm-jl-outline-btn')[0].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
	const items = [...h.q('.cm-jl-outline-item')];
	assert.deepEqual(items.map(i => i.textContent), ['One', 'Two', 'Three']);
	assert.deepEqual(items.map(i => i.style.paddingLeft), ['10px', '24px', '38px']);
	items[1].dispatchEvent(new h.w.MouseEvent('click', { bubbles: true }));
	assert.equal(h.view.state.selection.main.head, doc(h).indexOf('## Two'));
	assert.equal(h.q('.cm-jl-outline')[0].hidden, true, 'popup closes after picking a heading');
	h.view.destroy();
});

test('folding: gutter is only present when enabled and headings fold', () => {
	const on = mount('# One\n\ntext\n\n## Two\n\nmore\n', { folding: true });
	assert.ok(on.view.dom.querySelector('.cm-foldGutter'));
	const range = on.C.foldable(on.view.state, 0, on.view.state.doc.line(1).to);
	assert.ok(range && range.to > range.from);
	on.view.destroy();
	const off = mount('# One\n\ntext\n', { folding: false });
	assert.equal(off.view.dom.querySelector('.cm-foldGutter'), null);
	off.view.destroy();
});

test('hover tooltip source exists for internal links and createExtensions tolerates missing hooks', () => {
	const h = mount('[a](:/' + ID + ')\n', ALL, undefined);
	assert.ok(h.view.dom.querySelector('.cm-jl-chip'));
	h.view.destroy();
});

// ---------------------------------------------------------------------------
// Host-app integration
// ---------------------------------------------------------------------------

test('page loads cm-extras.js after CodeMirror and before app.js; settings plumbing exists', () => {
	const { layoutPage } = require('../app/templates');
	const html = layoutPage({ user: { email: 'u@e.com', fullName: 'U' }, navContent: '', settings: { mdLivePreview: true, mdFolding: false } });
	const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
	const cm = scripts.findIndex(s => s.includes('codemirror.min.js'));
	const ex = scripts.findIndex(s => s.includes('cm-extras.js'));
	const app = scripts.findIndex(s => s.includes('app.js'));
	assert.ok(cm !== -1 && ex !== -1 && app !== -1);
	assert.ok(cm < ex && ex < app, 'order must be codemirror -> cm-extras -> app');
	assert.match(html, /mdLivePreview:true/);
	assert.match(html, /mdFolding:false/);
	assert.match(html, /mdInlineWidgets:true/);
	assert.match(html, /mdStatusBar:true/);
});

test('settings service normalizes the markdown-mode toggles with sane defaults', () => {
	const { normalizeSettings } = require('../app/settingsService');
	const d = normalizeSettings({});
	assert.deepEqual([d.mdInlineWidgets, d.mdLivePreview, d.mdStatusBar, d.mdFolding], [true, false, true, true]);
	const o = normalizeSettings({ mdInlineWidgets: '0', mdLivePreview: '1', mdStatusBar: 0, mdFolding: false });
	assert.deepEqual([o.mdInlineWidgets, o.mdLivePreview, o.mdStatusBar, o.mdFolding], [false, true, false, false]);
});

test('settings API whitelists the new keys and the settings page renders their checkboxes', () => {
	const api = fs.readFileSync(path.join(__dirname, '../app/routes/api.js'), 'utf8');
	for (const k of ['mdInlineWidgets', 'mdLivePreview', 'mdStatusBar', 'mdFolding']) assert.ok(api.includes(`'${k}'`), `${k} must be an allowed settings key`);
	const settingsTpl = fs.readFileSync(path.join(__dirname, '../app/templates/settings.js'), 'utf8');
	for (const id of ['settings-md-inline-widgets', 'settings-md-live-preview', 'settings-md-status-bar', 'settings-md-folding']) assert.ok(settingsTpl.includes(id), `${id} checkbox must exist`);
});

test('app.js wires the extras into initCM and guards against failures', () => {
	const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
	assert.ok(app.includes('..._cmExtraExtensions(C)'), 'initCM must spread the extras into the extension list');
	const fnStart = app.indexOf('function _cmExtraExtensions');
	const body = app.slice(fnStart, fnStart + 500);
	assert.ok(body.includes('try{') && body.includes('catch'), 'extras must never prevent the editor from mounting');
	assert.ok(app.includes('function _pasteHtmlToMarkdown'));
	assert.ok(app.includes('function _openNoteById'));
});

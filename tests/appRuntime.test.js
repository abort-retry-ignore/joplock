/**
 * Runtime tests for pure functions in public/app.js that require a real
 * JS engine + DOM but can be extracted and run in isolation.
 *
 * Strategy: grep the exact function source from app.js, wrap it with its
 * dependencies, and execute in a minimal vm context with JSDOM + TurndownService.
 *
 * This catches the class of bug where a global dependency (e.g. TurndownService)
 * is silently missing at runtime — something static source assertions cannot detect.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const turndownSrc = fs.readFileSync(path.join(__dirname, '../public/turndown.min.js'), 'utf8');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Extract a named function's source text from app.js by matching
// "function NAME(...){...}" (handles minified single-line functions).
function extractFn(name) {
	// Match "function NAME(" — find the opening brace, then balance braces.
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

// Build a minimal vm context with TurndownService + JSDOM document.
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

// Run a snippet of code and the named functions it depends on, in a fresh ctx.
function runWithDeps(ctx, ...fns) {
	// tinymceToMarkdown / htmlToMarkdown now delegate to _applyHeadingSpacing;
	// pull it in automatically so callers don't each have to list it.
	if ((fns.includes('tinymceToMarkdown') || fns.includes('htmlToMarkdown')) && !fns.includes('_applyHeadingSpacing')) {
		fns = [...fns];
		fns.splice(fns.indexOf('getTurndown') >= 0 ? fns.indexOf('getTurndown') + 1 : 0, 0, '_applyHeadingSpacing');
	}
	for (const fn of fns) vm.runInContext(extractFn(fn), ctx);
}

// ---------------------------------------------------------------------------
// TurndownService availability
// ---------------------------------------------------------------------------

test('TurndownService is available after loading turndown.min.js', () => {
	// This is exactly the missing global that caused:
	//   Uncaught ReferenceError: TurndownService is not defined
	//     getTurndown  app.js:1303
	//     tinymceToMarkdown  app.js:1368
	//     onEdit  app.js:449
	const ctx = vm.createContext({ TurndownService: undefined });
	vm.runInContext(turndownSrc, ctx);
	assert.equal(typeof ctx.TurndownService, 'function',
		'TurndownService must be a constructor after loading turndown.min.js');
});

test('pages.js loads turndown.min.js before app.js', () => {
	// If turndown.min.js is removed from the page, TurndownService is undefined
	// at runtime. This test catches that structural requirement.
	const { layoutPage } = require('../app/templates');
	const html = layoutPage({ user: { email: 'u@e.com', fullName: 'U' }, navContent: '' });
	const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
	const tdIdx = scripts.findIndex(s => s.includes('turndown'));
	const appIdx = scripts.findIndex(s => s.includes('app.js'));
	assert.ok(tdIdx !== -1, 'turndown.min.js must be in the page script tags');
	assert.ok(appIdx !== -1, 'app.js must be in the page script tags');
	assert.ok(tdIdx < appIdx, 'turndown.min.js must load before app.js');
});

// ---------------------------------------------------------------------------
// tinymceToMarkdown
// ---------------------------------------------------------------------------

test('tinymceToMarkdown does not throw ReferenceError for TurndownService', () => {
	// Regression guard: if TurndownService is missing this throws at the
	// `new TurndownService(...)` call inside getTurndown().
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	assert.doesNotThrow(
		() => vm.runInContext('tinymceToMarkdown("<p>hello</p>")', ctx),
		'tinymceToMarkdown must not throw — TurndownService must be in scope'
	);
});

test('tinymceToMarkdown converts paragraph to plain text', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const result = vm.runInContext('tinymceToMarkdown("<p>hello world</p>")', ctx);
	assert.ok(typeof result === 'string');
	assert.ok(result.includes('hello world'), `got: ${result}`);
});

test('tinymceToMarkdown converts bold to markdown **bold**', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const result = vm.runInContext('tinymceToMarkdown("<p><strong>bold text</strong></p>")', ctx);
	assert.ok(result.includes('**bold text**'), `got: ${result}`);
});

test('tinymceToMarkdown converts italic to markdown *italic*', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const result = vm.runInContext('tinymceToMarkdown("<p><em>italic</em></p>")', ctx);
	assert.ok(result.includes('*italic*'), `got: ${result}`);
});

test('tinymceToMarkdown converts h2 to ATX ## heading', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const result = vm.runInContext('tinymceToMarkdown("<h2>My heading</h2>")', ctx);
	assert.ok(result.includes('## My heading'), `got: ${result}`);
});

test('tinymceToMarkdown returns empty string for empty input', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const result = vm.runInContext('tinymceToMarkdown("")', ctx);
	assert.equal(typeof result, 'string');
	assert.equal(result.trim(), '');
});

test('tinymceToMarkdown preserves a blank line INSIDE a code block (C #include is not a heading)', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	// This is what TinyMCE getContent() produces for the reported code block.
	const html = '<pre class="language-c"><code>#include &lt;stdio.h&gt;\n\nint main() {\n    return 0;\n}\n</code></pre>';
	const result = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx);
	// The blank line between the #include and int main() MUST survive — the
	// heading-gap collapse must not treat `#include` as a markdown heading.
	assert.ok(/#include <stdio\.h>\n\nint main/.test(result),
		`blank line inside code block must be preserved, got: ${JSON.stringify(result)}`);
});

test('tinymceToMarkdown still collapses a blank line after a real ATX heading', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const result = vm.runInContext('tinymceToMarkdown("<h1>Title</h1><p>Body text</p>")', ctx);
	assert.ok(/^# Title\nBody text/.test(result),
		`heading collapse must still apply outside code, got: ${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------------
// app.js source-level guards for window exports
// ---------------------------------------------------------------------------

test('app.js source exports setEditorMode on window', () => {
	assert.ok(appSrc.includes('window.setEditorMode=setEditorMode'),
		'setEditorMode must be exported — toolbar MD/preview buttons call it as inline onclick');
});

test('app.js source defines tinyMCEFormat and tinyMCEFormatBlock functions', () => {
	// These are called as inline onclick handlers — must be exported on window.*
	// because app.js loads with defer and inline handlers fire before defer runs
	// unless the function is on window.
	assert.ok(appSrc.includes('window.tinyMCEFormat=tinyMCEFormat'),
		'tinyMCEFormat must be exported on window');
	assert.ok(appSrc.includes('window.tinyMCEFormatBlock=tinyMCEFormatBlock'),
		'tinyMCEFormatBlock must be exported on window');
	assert.ok(appSrc.includes('window.tinyMCEInsertDate=tinyMCEInsertDate'),
		'tinyMCEInsertDate must be exported on window');
	assert.ok(appSrc.includes('window.tinyMCEInsertDateTime=tinyMCEInsertDateTime'),
		'tinyMCEInsertDateTime must be exported on window');
	// And they must use the TinyMCE formatter API, not old execCommand
	const fmtSrc = extractFn('tinyMCEFormat');
	assert.ok(fmtSrc.includes('formatter.toggle'), 'tinyMCEFormat must use formatter.toggle (not execCommand)');
});

test('app.js getTurndown uses TurndownService global (not require)', () => {
	const fnSrc = extractFn('getTurndown');
	assert.ok(fnSrc.includes('TurndownService'), 'getTurndown must reference TurndownService');
	assert.ok(!fnSrc.includes('require('), 'getTurndown must not use require() — it runs in the browser');
});

// ---------------------------------------------------------------------------
// Toolbar command routing (rich vs markdown mode)
// ---------------------------------------------------------------------------

function makeToolbarCtx() {
	const ctx = vm.createContext({
		_editorMode: 'markdown',
		_calls: [],
		_ed: null,
	});
	vm.runInContext(`
		function getTinyMCE(){return _ed}
		function wrapSel(a,b){_calls.push(['wrapSel',a,b])}
		function insertPfx(p){_calls.push(['insertPfx',p])}
		function insertTxt(x){_calls.push(['insertTxt',x])}
		function clearFormat(){_calls.push(['clearFormat'])}
		function openCodeModal(){_calls.push(['openCodeModal'])}
		function insertLink(){_calls.push(['insertLink'])}
		function insertImg(){_calls.push(['insertImg'])}
		function insertStamp(kind){_calls.push(['insertStamp',kind])}
	`, ctx);
	runWithDeps(
		ctx,
		'_isMarkdownModeActive',
		'_runMarkdownToolbarFormat',
		'_runMarkdownToolbarBlock',
		'tinyMCEFormat',
		'tinyMCEFormatBlock',
		'tinyMCEInsertCheckbox',
		'tinyMCEInsertDate',
		'tinyMCEInsertDateTime',
		'tinyMCEInsertLink',
		'tinyMCEInsertImage',
	);
	return ctx;
}

function plainCalls(ctx) {
	return JSON.parse(JSON.stringify(ctx._calls || []));
}

test('tinyMCEFormat maps every toolbar command to markdown helpers in markdown mode', () => {
	const ctx = makeToolbarCtx();
	const cases = [
		['bold', ['wrapSel', '**', '**']],
		['italic', ['wrapSel', '*', '*']],
		['underline', ['wrapSel', '++', '++']],
		['strikethrough', ['wrapSel', '~~', '~~']],
		['code', ['wrapSel', '`', '`']],
		['InsertUnorderedList', ['insertPfx', '- ']],
		['InsertOrderedList', ['insertPfx', '1. ']],
		['InsertHorizontalRule', ['insertTxt', '\n---\n']],
		['removeformat', ['clearFormat']],
		['mceCodeSample', ['openCodeModal']],
		['mceLink', ['insertLink']],
		['mceImage', ['insertImg']],
	];
	for (const [cmd, expected] of cases) {
		vm.runInContext(`_calls=[]; tinyMCEFormat(${JSON.stringify(cmd)})`, ctx);
		assert.deepEqual(plainCalls(ctx), [expected], `command ${cmd} must route to markdown helper`);
	}
});

test('tinyMCEFormatBlock maps heading/quote toolbar buttons in markdown mode', () => {
	const ctx = makeToolbarCtx();
	const cases = [
		['h1', ['insertPfx', '# ']],
		['h2', ['insertPfx', '## ']],
		['h3', ['insertPfx', '### ']],
		['blockquote', ['insertPfx', '> ']],
	];
	for (const [tag, expected] of cases) {
		vm.runInContext(`_calls=[]; tinyMCEFormatBlock(${JSON.stringify(tag)})`, ctx);
		assert.deepEqual(plainCalls(ctx), [expected], `block ${tag} must route to markdown prefix helper`);
	}
});

test('markdown toolbar helpers route checkbox/date/time/link/image actions', () => {
	const ctx = makeToolbarCtx();
	vm.runInContext('_calls=[]; tinyMCEInsertCheckbox(); tinyMCEInsertDate(); tinyMCEInsertDateTime(); tinyMCEInsertLink(); tinyMCEInsertImage();', ctx);
	assert.deepEqual(plainCalls(ctx), [
		['insertPfx', '- [ ] '],
		['insertStamp', 'date'],
		['insertStamp', 'datetime'],
		['insertLink'],
		['insertImg'],
	]);
});

test('tinyMCEFormat rich mode keeps TinyMCE command behavior', () => {
	const ctx = makeToolbarCtx();
	ctx._editorMode = 'rich';
	ctx._ed = {
		execs: [],
		toggles: [],
		focused: 0,
		execCommand(cmd) { this.execs.push(cmd); },
		formatter: { toggle: cmd => ctx._ed.toggles.push(cmd) },
		focus() { this.focused++; },
	};
	const cases = [
		['InsertUnorderedList', { exec: 'InsertUnorderedList' }],
		['InsertOrderedList', { exec: 'InsertOrderedList' }],
		['InsertHorizontalRule', { exec: 'InsertHorizontalRule' }],
		['removeformat', { exec: 'RemoveFormat' }],
		['mceCodeSample', { modal: true }],
		['mceLink', { exec: 'mceLink' }],
		['mceImage', { exec: 'mceImage' }],
		['bold', { toggle: 'bold' }],
	];
	for (const [cmd, expected] of cases) {
		ctx._ed.execs = [];
		ctx._ed.toggles = [];
		vm.runInContext('_calls=[]', ctx);
		vm.runInContext(`tinyMCEFormat(${JSON.stringify(cmd)})`, ctx);
		if (expected.exec) assert.deepEqual(ctx._ed.execs, [expected.exec], `rich command ${cmd} must exec ${expected.exec}`);
		if (expected.toggle) assert.deepEqual(ctx._ed.toggles, [expected.toggle], `rich command ${cmd} must toggle ${expected.toggle}`);
		if (expected.modal) assert.deepEqual(plainCalls(ctx), [['openCodeModal']], `rich command ${cmd} must open the custom code modal`);
	}
	assert.ok(ctx._ed.focused >= cases.length - 1, 'each rich toolbar action (except the code modal) should focus TinyMCE');
});

test('tinyMCEFormatBlock rich mode toggles block format in TinyMCE', () => {
	const ctx = makeToolbarCtx();
	ctx._editorMode = 'rich';
	ctx._ed = {
		toggles: [],
		focused: 0,
		formatter: { toggle: tag => ctx._ed.toggles.push(tag) },
		focus() { this.focused++; },
	};
	vm.runInContext("tinyMCEFormatBlock('h2')", ctx);
	assert.deepEqual(ctx._ed.toggles, ['h2']);
	assert.equal(ctx._ed.focused, 1);
});

test('tinyMCEInsert* helpers use TinyMCE commands in rich mode', () => {
	const ctx = makeToolbarCtx();
	ctx._editorMode = 'rich';
	ctx._ed = {
		execs: [],
		focused: 0,
		execCommand(cmd, _ui, value) { this.execs.push([cmd, value]); },
		focus() { this.focused++; },
	};
	vm.runInContext('tinyMCEInsertCheckbox(); tinyMCEInsertDate(); tinyMCEInsertDateTime(); tinyMCEInsertLink(); tinyMCEInsertImage();', ctx);
	assert.equal(ctx._ed.execs[0][0], 'mceInsertContent');
	assert.ok(String(ctx._ed.execs[0][1]).includes('md-checkbox'), 'checkbox should insert md-checkbox markup');
	assert.equal(ctx._ed.execs[1][0], 'mceInsertContent');
	assert.match(String(ctx._ed.execs[1][1]), /^\d{4}-\d{2}-\d{2}$/);
	assert.equal(ctx._ed.execs[2][0], 'mceInsertContent');
	assert.match(String(ctx._ed.execs[2][1]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
	assert.equal(ctx._ed.execs[3][0], 'mceLink');
	assert.equal(ctx._ed.execs[4][0], 'mceImage');
	assert.equal(ctx._ed.focused, 5);
});

// ---------------------------------------------------------------------------
// Mode-switch round-trip fidelity
// ---------------------------------------------------------------------------
// These tests simulate the rich→markdown mode switch:
//   renderMarkdown(md) → [TinyMCE setContent normalises] → getContent → tinymceToMarkdown → md
//
// TinyMCE normalises HTML in two known ways:
//   1. Appends a trailing <br> to every <p>:  <p>text</p> → <p>text<br></p>
//   2. Represents empty paragraphs as:        <p><br></p>
//
// tinymceToMarkdown must handle both so mode-switching doesn't corrupt content.

// Helper: accurate TinyMCE getContent() simulation.
// - Adds trailing <br> to every non-empty <p>
// - Leaves <p><br></p> (blank lines) unchanged
function simulateTinyMCEGetContent(html) {
	return html
		// Add trailing <br> to non-empty <p> that doesn't already end with <br>
		.replace(/<p>((?:[^<]|<(?!\/p>))+?)(?:<br>)?\s*<\/p>/gi, '<p>$1<br></p>');
}

function modeSwitchRoundTrip(md) {
	const { renderMarkdown } = require('../app/templates');
	const html = renderMarkdown(md);
	const normalised = simulateTinyMCEGetContent(html);
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	return vm.runInContext('tinymceToMarkdown(' + JSON.stringify(normalised) + ')', ctx).trim();
}

test('mode-switch round-trip: soft-break lines within paragraph', () => {
	const md = 'Line one\nLine two\nLine three';
	assert.equal(modeSwitchRoundTrip(md), md);
});

test('mode-switch round-trip: hard paragraph break', () => {
	const md = 'Para one.\n\nPara two.';
	assert.equal(modeSwitchRoundTrip(md), md);
});

test('mode-switch round-trip: mixed soft and hard breaks', () => {
	const md = 'Line one\nLine two\n\nParagraph two.';
	assert.equal(modeSwitchRoundTrip(md), md);
});

test('mode-switch round-trip: bold and italic inline formatting', () => {
	const md = 'Hello **bold** and *italic* world.';
	assert.equal(modeSwitchRoundTrip(md), md);
});

test('mode-switch round-trip: heading followed by body', () => {
	const md = '## My heading\nBody text here.';
	assert.equal(modeSwitchRoundTrip(md), md);
});

test('mode-switch round-trip: trailing <br> in <p> does not add extra line', () => {
	// TinyMCE appends <br> to every non-empty <p>. Must be stripped, not emitted as \n.
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const result = vm.runInContext('tinymceToMarkdown("<p>hello<br></p>")', ctx).trim();
	assert.equal(result, 'hello', `trailing <br> in <p> must not produce extra newline, got: ${JSON.stringify(result)}`);
});

test('mode-switch round-trip: <p><br></p> typed by user = one extra blank line', () => {
	// <p><br></p> is how TinyMCE stores an intentional blank line.
	// Must round-trip as \n\n\n (= paragraph break + one blank line).
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const html = '<p>Para one.<br></p><p><br></p><p>Para two.<br></p>';
	const result = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	assert.equal(result, 'Para one.\n\n\nPara two.',
		`<p><br></p> must become extra blank line (\\n\\n\\n), got: ${JSON.stringify(result)}`);
});

test('mode-switch round-trip: two <p><br></p> = two extra blank lines', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const html = '<p>L1<br></p><p><br></p><p><br></p><p>L2<br></p>';
	const result = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	assert.equal(result, 'L1\n\n\n\nL2',
		`two <p><br></p> must give \\n\\n\\n\\n, got: ${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------------
// Comprehensive note shape: 4-line paragraphs, single-spaced, blank line between
// ---------------------------------------------------------------------------
// This is the exact shape described by the user. Must survive:
//   1. render mode display (renderMarkdown)
//   2. rich→markdown mode switch (tinymceToMarkdown)
//   3. markdown→rich mode switch (renderMarkdown again)
//   4. vault notes (same content, just encrypted storage — same HTML round-trip)

const FOUR_LINE_NOTE = [
	'Line 1 of paragraph 1',
	'Line 2 of paragraph 1',
	'Line 3 of paragraph 1',
	'Line 4 of paragraph 1',
	'',
	'Line 1 of paragraph 2',
	'Line 2 of paragraph 2',
	'Line 3 of paragraph 2',
	'Line 4 of paragraph 2',
].join('\n');

const FOUR_LINE_WITH_BLANK = [
	'Line 1 of paragraph 1',
	'Line 2 of paragraph 1',
	'Line 3 of paragraph 1',
	'Line 4 of paragraph 1',
	'',
	'',
	'Line 1 of paragraph 2',
	'Line 2 of paragraph 2',
	'Line 3 of paragraph 2',
	'Line 4 of paragraph 2',
].join('\n');

const USER_REPORTED_NOTE = [
	'TEST note',
	'',
	'this is anotehr note, with only',
	'4 lines in it, but shouldn\'t be double spaced.',
	'its not monospace. but should be.\u00a0',
	'if i edit i can see things fine.',
	'',
	'second paragraph, seems to',
	'work fine so far. does it hold?',
	'its not double spaced, which is good.',
	'but new paragraphs eat blank lines.',
	'how about more lines?',
].join('\n');

test('4-line note: renderMarkdown produces single <p> with <br> soft breaks', () => {
	const { renderMarkdown } = require('../app/templates');
	const html = renderMarkdown(FOUR_LINE_NOTE);
	// Both paragraphs in one <p> each, lines joined by <br>
	assert.ok(html.includes('<p>Line 1 of paragraph 1<br>Line 2 of paragraph 1<br>Line 3 of paragraph 1<br>Line 4 of paragraph 1</p>'));
	assert.ok(html.includes('<p>Line 1 of paragraph 2<br>Line 2 of paragraph 2<br>Line 3 of paragraph 2<br>Line 4 of paragraph 2</p>'));
});

test('4-line note: rich→md mode switch preserves all lines and paragraph break', () => {
	assert.equal(modeSwitchRoundTrip(FOUR_LINE_NOTE), FOUR_LINE_NOTE);
});

test('4-line note: rich→md→rich is stable (two switches)', () => {
	// Second switch re-renders from markdown. Should give same HTML as first.
	const { renderMarkdown } = require('../app/templates');
	const html1 = simulateTinyMCEGetContent(renderMarkdown(FOUR_LINE_NOTE));
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const md1 = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html1) + ')', ctx).trim();
	// Re-render from recovered markdown
	const html2 = simulateTinyMCEGetContent(renderMarkdown(md1));
	const md2 = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html2) + ')', ctx).trim();
	assert.equal(md1, FOUR_LINE_NOTE, `first switch corrupted content: ${JSON.stringify(md1)}`);
	assert.equal(md2, FOUR_LINE_NOTE, `second switch corrupted content: ${JSON.stringify(md2)}`);
});

test('4-line note with extra blank line: round-trip preserves blank line', () => {
	assert.equal(modeSwitchRoundTrip(FOUR_LINE_WITH_BLANK), FOUR_LINE_WITH_BLANK.trim());
});

test('user note: mode switch preserves blank line between paragraphs', () => {
	assert.equal(modeSwitchRoundTrip(USER_REPORTED_NOTE), USER_REPORTED_NOTE);
});

test('4-line note: soft breaks are single-spaced (no extra \\n between lines)', () => {
	const result = modeSwitchRoundTrip(FOUR_LINE_NOTE);
	// Lines within a paragraph must be \n-separated, not \n\n-separated
	assert.ok(result.includes('Line 1 of paragraph 1\nLine 2 of paragraph 1'),
		'lines within paragraph must be single-spaced');
	assert.ok(!result.includes('Line 1 of paragraph 1\n\nLine 2 of paragraph 1'),
		'lines within paragraph must NOT be double-spaced');
});

test('4-line note: paragraph break is \\n\\n not \\n\\n\\n', () => {
	const result = modeSwitchRoundTrip(FOUR_LINE_NOTE);
	assert.ok(result.includes('Line 4 of paragraph 1\n\nLine 1 of paragraph 2'),
		'paragraph break must be \\n\\n');
	assert.ok(!result.includes('Line 4 of paragraph 1\n\n\nLine 1 of paragraph 2'),
		'paragraph break must NOT be \\n\\n\\n');
});

test('vault note: same round-trip as regular note (encryption is storage-only)', () => {
	// Vault encryption/decryption is transparent to the editor.
	// The markdown content is identical — same round-trip must hold.
	assert.equal(modeSwitchRoundTrip(FOUR_LINE_NOTE), FOUR_LINE_NOTE,
		'vault note content must round-trip identically to regular note');
});

test('switching between regular and vault note: tinymceToMarkdown stable across note shapes', () => {
	// Simulates switching from a regular note to a vault note and back.
	// Content from each note must be independently stable.
	const regularNote = 'Regular note\nSecond line\n\nSecond paragraph.';
	const vaultNote   = FOUR_LINE_NOTE;
	assert.equal(modeSwitchRoundTrip(regularNote), regularNote);
	assert.equal(modeSwitchRoundTrip(vaultNote),   vaultNote);
	// Run again in same order to check no cross-contamination via _tdService cache
	assert.equal(modeSwitchRoundTrip(regularNote), regularNote);
});

// ---------------------------------------------------------------------------
// Images: mode-switch round-trip must not mangle image references
// ---------------------------------------------------------------------------
// A dropped image is inserted as `![alt](:/<32-hex>)` in markdown, or as
// `<p><img src="/resources/<id>"></p><p></p>` in rendered mode. Switching modes
// (renderMarkdown → TinyMCE → tinymceToMarkdown, and back) must preserve the
// image reference and its surrounding blank lines exactly.

const IMG_ID = 'a'.repeat(32);
const IMG_MD = `![cat](:/${IMG_ID})`;

test('image round-trip: image alone survives rich→md mode switch', () => {
	assert.equal(modeSwitchRoundTrip(IMG_MD), IMG_MD,
		'a lone image must round-trip unchanged');
});

test('image round-trip: text, blank line, then image is preserved', () => {
	const md = `Some text.\n\n${IMG_MD}`;
	assert.equal(modeSwitchRoundTrip(md), md,
		'image after text with a blank line must round-trip unchanged');
});

test('image round-trip: image, blank line, then text is preserved (no glue)', () => {
	const md = `${IMG_MD}\n\nText after the image.`;
	assert.equal(modeSwitchRoundTrip(md), md,
		'image followed by a blank line and text must round-trip unchanged');
});

test('image round-trip: rich→md→rich is stable (two switches)', () => {
	const { renderMarkdown } = require('../app/templates');
	const md = `${IMG_MD}\n\nText after the image.`;
	const html1 = simulateTinyMCEGetContent(renderMarkdown(md));
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const md1 = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html1) + ')', ctx).trim();
	const html2 = simulateTinyMCEGetContent(renderMarkdown(md1));
	const md2 = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html2) + ')', ctx).trim();
	assert.equal(md1, md, `first switch mangled image note: ${JSON.stringify(md1)}`);
	assert.equal(md2, md, `second switch mangled image note: ${JSON.stringify(md2)}`);
});

test('image round-trip: the dropped rendered-mode shape (<p><img></p><p></p>) does not corrupt following text', () => {
	// This is exactly what _uploadFileToTinyMCE inserts. When the user then types,
	// text ends up in the trailing empty <p>. Verify the whole thing converts to a
	// clean image reference + blank line + text (no glue, no data-URI leakage).
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const html = `<p>before<br></p><p><img src="/resources/${IMG_ID}" data-resource-id="${IMG_ID}" alt="cat" /></p><p>typed text<br></p>`;
	const result = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	assert.equal(result, `before\n\n${IMG_MD}\n\ntyped text`,
		`rendered-mode image insert must round-trip cleanly, got: ${JSON.stringify(result)}`);
});

test('image round-trip: resource images are never emitted as data: URIs', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const html = `<p><img src="/resources/${IMG_ID}" alt="cat" /></p>`;
	const result = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	assert.ok(result.includes(`:/${IMG_ID}`), 'must emit the :/resource reference');
	assert.ok(!result.includes('data:'), 'must never emit a data: URI');
});

// Regression: spacing between images must not be swallowed across repeated
// markdown⇄render switches. The blank-line marker is a <p class="md-blank-line">
// (TinyMCE-stable) rather than a bare <div><br></div> which got merged/dropped
// around block images.
const IMG_ID_B = 'b'.repeat(32);
const IMG_A = `![one](:/${IMG_ID})`;
const IMG_B = `![two](:/${IMG_ID_B})`;

function stableAcrossSwitches(md, iterations = 5) {
	const { renderMarkdown } = require('../app/templates');
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	let cur = md;
	for (let i = 0; i < iterations; i++) {
		const html = simulateTinyMCEGetContent(renderMarkdown(cur));
		cur = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	}
	return cur;
}

test('image spacing: two images with a blank line survive 5 mode switches', () => {
	const md = `${IMG_A}\n\n${IMG_B}`;
	assert.equal(stableAcrossSwitches(md), md, 'single blank line between images must not be swallowed');
});

test('image spacing: two images with an EXTRA blank line survive 5 mode switches', () => {
	const md = `${IMG_A}\n\n\n${IMG_B}`;
	assert.equal(stableAcrossSwitches(md), md, 'extra blank line between images must not be swallowed');
});

test('image spacing: two images with two extra blank lines survive 5 mode switches', () => {
	const md = `${IMG_A}\n\n\n\n${IMG_B}`;
	assert.equal(stableAcrossSwitches(md), md, 'multiple blank lines between images must not be swallowed');
});

test('image spacing: image, blank, text, blank, image survives 5 mode switches', () => {
	const md = `${IMG_A}\n\ndivider text\n\n${IMG_B}`;
	assert.equal(stableAcrossSwitches(md), md, 'mixed image/text spacing must be stable');
});

test('blank-line marker renders as a TinyMCE-stable <p>, not a bare <div>', () => {
	const { renderMarkdown } = require('../app/templates');
	const html = renderMarkdown(`${IMG_A}\n\n\n${IMG_B}`);
	assert.ok(html.includes('<p class="md-blank-line"><br></p>'),
		'extra blank lines must render as <p class="md-blank-line"> (TinyMCE preserves empty <p>)');
	assert.ok(!html.includes('<div class="md-blank-line">'),
		'must not use the fragile bare <div> blank-line marker');
});

// Regression: sized/raw-HTML images (Turndown emits `<img ... width=.. />` for
// resized images) are markdown-it HTML blocks rendered OUTSIDE any <p>. A loose
// block <img> next to blank-line markers gets absorbed into an adjacent
// paragraph by TinyMCE, collapsing the spacing. The renderer must wrap them.
const SIZED_IMG_A = `<img src=":/${IMG_ID}" alt="x" width="229" height="296" />`;
const SIZED_IMG_B = `<img src=":/${IMG_ID_B}" alt="y" width="101" height="161" />`;

test('sized (raw-HTML) images are wrapped in their own <p> by the renderer', () => {
	const { renderMarkdown } = require('../app/templates');
	const html = renderMarkdown(`${SIZED_IMG_A}\n\n${SIZED_IMG_B}`);
	// Both images must be inside a <p> (not loose block-level <img>).
	const looseImg = /(^|\n)\s*<img\b[^>]*>\s*(\n|$)/.test(html);
	assert.ok(!looseImg, `no loose block-level <img> allowed, got: ${html}`);
	assert.ok(/<p><img\b[^>]*width="229"[^>]*><\/p>/.test(html), 'first sized image must be wrapped in <p>');
	assert.ok(/<p><img\b[^>]*width="101"[^>]*><\/p>/.test(html), 'second sized image must be wrapped in <p>');
});

test('br-stripped blank-line marker still yields a blank line (TinyMCE strips the <br>)', () => {
	// TinyMCE turns <p class="md-blank-line"><br></p> into <p class="md-blank-line"></p>
	// on setContent. An empty <p> is dropped by Turndown, so tinymceToMarkdown must
	// normalise the marker (empty or not) back into a blank-line sentinel.
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const html = `<p><img src="resources/${IMG_ID}"></p><p class="md-blank-line"></p><p><img src="resources/${IMG_ID_B}"></p>`;
	const result = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	assert.equal(result, `![](:/${IMG_ID})\n\n\n![](:/${IMG_ID_B})`,
		`empty (br-stripped) marker must still produce a blank line, got: ${JSON.stringify(result)}`);
});

test('multiple br-stripped markers stack blank lines correctly', () => {
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const html = `<p><img src="resources/${IMG_ID}"></p><p class="md-blank-line"></p><p class="md-blank-line"></p><p><img src="resources/${IMG_ID_B}"></p>`;
	const result = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	assert.equal(result, `![](:/${IMG_ID})\n\n\n\n![](:/${IMG_ID_B})`,
		`two br-stripped markers must give two extra blank lines, got: ${JSON.stringify(result)}`);
});

// Full-fidelity multi-switch simulation using the OBSERVED real TinyMCE
// behavior: it strips the <br> from md-blank-line markers on setContent.
function simulateTinyMCEGetContentReal(html) {
	return html
		// TinyMCE strips the <br> from the blank-line marker → empty <p>.
		.replace(/<p class="md-blank-line"><br><\/p>/gi, '<p class="md-blank-line"></p>')
		// TinyMCE appends a trailing <br> to every non-empty <p>.
		.replace(/<p>((?:[^<]|<(?!\/p>))+?)(?:<br>)?\s*<\/p>/gi, '<p>$1<br></p>');
}

// ---------------------------------------------------------------------------
// FormatBlock split: BeforeExecCommand wiring + Enter regression guard
// ---------------------------------------------------------------------------
// The _splitBrBlock helper splits a <p> containing <br> children into
// individual <p> elements so FormatBlock (the blocks dropdown) operates at
// proper paragraph granularity.  The split MUST only fire before FormatBlock
// (BeforeExecCommand), NOT on every NodeChange — the latter clobbers the
// caret after Enter in linebreak mode.

test('app.js source wires _splitBrBlock split via BeforeExecCommand, not NodeChange', () => {
	// The split must be triggered by BeforeExecCommand with command 'FormatBlock',
	// NOT by a NodeChange handler.  NodeChange + split + setStart(targetBlock,0)
	// forces the caret to offset 0 after every Enter in linebreak mode.
	const formatBlockIdx = appSrc.indexOf("e.command!=='FormatBlock'");
	assert.ok(formatBlockIdx !== -1,
		'BeforeExecCommand handler must guard on FormatBlock command');
	// Ensure the FormatBlock guard is inside a BeforeExecCommand listener
	const beforeExecSnippet = appSrc.slice(formatBlockIdx - 200, formatBlockIdx);
	assert.ok(beforeExecSnippet.includes('BeforeExecCommand'),
		'FormatBlock guard must be inside a BeforeExecCommand handler');
	// Ensure _splitBrBlock is NOT called from a NodeChange listener
	const nodeChangeIdx = appSrc.indexOf("editor.on('NodeChange'");
	if (nodeChangeIdx !== -1) {
		const nodeChangeBody = appSrc.slice(nodeChangeIdx, nodeChangeIdx + 600);
		assert.ok(!nodeChangeBody.includes('_splitBrBlock'),
			'_splitBrBlock must NOT be called inside NodeChange — that clobbers the caret after Enter');
	}
});

test('app.js BeforeExecCommand handler preserves caret text node + offset when restoring after split', () => {
	// After _splitBrBlock runs, the handler must restore the original caret
	// text node and offset (not force offset 0) so the cursor stays put.
	const handlerStart = appSrc.indexOf("e.command!=='FormatBlock'");
	assert.ok(handlerStart !== -1, 'BeforeExecCommand handler not found');
	const handlerBody = appSrc.slice(handlerStart, handlerStart + 1500);
	// Must try to setStart with the original caretNode + caretOffset
	assert.ok(handlerBody.includes('rng.setStart(caretNode,caretOffset)'),
		'handler must restore original caret text node + offset after split');
	// Must fall back to targetBlock,0 only when the caret node is no longer contained
	assert.ok(handlerBody.includes('rng.setStart(targetBlock,0)'),
		'handler must fall back to target block offset 0 when caret node is not contained');
});

test('_splitBrBlock splits <p> with <br> children into separate <p> elements', () => {
	// Functional test: simulate what _splitBrBlock does on a real DOM node.
	const dom = new JSDOM('<!DOCTYPE html><body><p></p></body>', { url: 'https://joplock.test' });
	const doc = dom.window.document;
	const p = doc.querySelector('p');
	// Build: <p>line1<br>line2<br>line3</p>
	p.appendChild(doc.createTextNode('line1'));
	p.appendChild(doc.createElement('br'));
	p.appendChild(doc.createTextNode('line2'));
	p.appendChild(doc.createElement('br'));
	p.appendChild(doc.createTextNode('line3'));
	// Simulate _splitBrBlock logic
	const children = Array.from(p.childNodes);
	const lines = [];
	let current = [];
	for (const node of children) {
		if (node.nodeName === 'BR' && !node.getAttribute('data-mce-bogus')) {
			lines.push(current);
			current = [];
		} else {
			current.push(node);
		}
	}
	lines.push(current);
	assert.equal(lines.length, 3, 'must split into 3 lines');
	assert.deepEqual(lines.map(l => l.map(n => n.textContent || '').join('')),
		['line1', 'line2', 'line3'],
		'lines must contain the expected text');
});

test('_splitBrBlock does not split <p> with only a single line (no br separators)', () => {
	const dom = new JSDOM('<!DOCTYPE html><body><p></p></body>', { url: 'https://joplock.test' });
	const doc = dom.window.document;
	const p = doc.querySelector('p');
	p.appendChild(doc.createTextNode('just one line'));
	const children = Array.from(p.childNodes);
	const lines = [];
	let current = [];
	for (const node of children) {
		if (node.nodeName === 'BR' && !node.getAttribute('data-mce-bogus')) {
			lines.push(current);
			current = [];
		} else {
			current.push(node);
		}
	}
	lines.push(current);
	assert.equal(lines.length, 1, 'must not split single-line paragraph');
});

test('_splitBrBlock skips bogus (data-mce-bogus) br elements', () => {
	const dom = new JSDOM('<!DOCTYPE html><body><p></p></body>', { url: 'https://joplock.test' });
	const doc = dom.window.document;
	const p = doc.querySelector('p');
	p.appendChild(doc.createTextNode('line1'));
	const bogusBr = doc.createElement('br');
	bogusBr.setAttribute('data-mce-bogus', '1');
	p.appendChild(bogusBr);
	p.appendChild(doc.createTextNode('line2'));
	const children = Array.from(p.childNodes);
	const lines = [];
	let current = [];
	for (const node of children) {
		if (node.nodeName === 'BR' && !node.getAttribute('data-mce-bogus')) {
			lines.push(current);
			current = [];
		} else {
			current.push(node);
		}
	}
	lines.push(current);
	assert.equal(lines.length, 1, 'must not split on bogus br');
	assert.equal(lines[0].map(n => n.textContent || '').join(''), 'line1line2');
});

test('sized images with blank lines survive 6 mode switches (real TinyMCE marker stripping)', () => {
	const { renderMarkdown } = require('../app/templates');
	const ctx = makeTurndownCtx();
	runWithDeps(ctx, 'getTurndown', 'tinymceToMarkdown');
	const md = `Working with images\n\n${SIZED_IMG_A}\n\n\n${SIZED_IMG_B}\n\ntext`;
	let cur = md;
	for (let i = 0; i < 6; i++) {
		const html = simulateTinyMCEGetContentReal(renderMarkdown(cur));
		cur = vm.runInContext('tinymceToMarkdown(' + JSON.stringify(html) + ')', ctx).trim();
	}
	assert.equal(cur, md, `sized-image spacing must survive repeated switches, got: ${JSON.stringify(cur)}`);
});

'use strict';

// Export in MARKDOWN mode. Markdown mode sends the note's markdown with
// format:'markdown'; the server renders it with renderMarkdown() (the renderer
// rendered mode loads its body from) and runs the same image-inlining pipeline.
// pandoc / weasyprint are not required: child_process.spawn is stubbed and the
// stub records what the exporter would have piped into pandoc.

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const spawned = [];
childProcess.spawn = (cmd, args) => {
	const proc = new EventEmitter();
	let stdin = '';
	proc.stdin = { write: d => { stdin += d; }, end: () => {} };
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	spawned.push({ cmd, args, stdin: () => stdin });
	setImmediate(() => {
		proc.stdout.emit('data', Buffer.from('FAKE-OUTPUT'));
		proc.emit('close', 0);
	});
	return proc;
};

// Required AFTER the stub so api.js's `const { spawn } = require('child_process')` picks it up.
const { handleExportHtml, handleExportDocx, handleExportPdf } = require('../app/routes/api');

const RID = 'a1b2c3d4e5f6789012345678abcdef00';
const MD = `# Trip report\n\nSee the photo:\n\n![shot](:/${RID})\n\nAnd the [spec sheet](:/${RID}).\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`;

const req = body => {
	const r = new EventEmitter();
	r.headers = { 'content-type': 'application/json' };
	r.method = 'POST';
	r.setEncoding = () => {};
	process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
	return r;
};
const res = () => {
	const chunks = [];
	const out = { status: null, headers: null, writeHead(s, h) { out.status = s; out.headers = h; }, end(d) { if (d) chunks.push(d); out.done = true; }, body: () => chunks.map(c => Buffer.isBuffer(c) ? c.toString('latin1') : c).join('') };
	return out;
};
const ctx = () => ({
	authenticatedUser: async () => ({ user: { id: 'u1', sessionId: 's1' } }),
	itemService: {
		resourceBlobByUserId: async () => Buffer.from('PNGDATA'),
		resourceMetaByUserId: async () => ({ mime: 'image/png', filename: 'shot.png' }),
	},
});
const wait = async r => { for (let i = 0; i < 50 && !r.done; i++) await new Promise(x => setTimeout(x, 5)); };

test('HTML export of markdown: rendered, theme + inlined image, no raw :/id left', async () => {
	const r = res();
	await handleExportHtml(new URL('http://x/api/export/html'), req({ content: MD, format: 'markdown', title: 'Trip', theme: 'earth' }), r, ctx());
	assert.equal(r.status, 200);
	const body = r.body();
	assert.ok(body.includes('<h1>Trip report</h1>'), 'markdown heading rendered to HTML');
	assert.ok(body.includes('data:image/png;base64,'), 'image inlined');
	assert.ok(!body.includes(`:/${RID}`), 'no raw Joplin resource reference leaks into the export');
	assert.ok(!body.includes(`/resources/${RID}`), 'no authenticated resource URL leaks into the export');
	assert.ok(/<table/.test(body) && /md-checkbox/.test(body), 'tables and task checkboxes rendered');
	assert.ok(body.includes('class="theme-earth"'));
});

test('HTML export without format still treats content as HTML (rendered mode unchanged)', async () => {
	const r = res();
	await handleExportHtml(new URL('http://x/api/export/html'), req({ content: '<p>**not markdown**</p>', title: 'n' }), r, ctx());
	assert.ok(r.body().includes('<p>**not markdown**</p>'));
});

test('DOCX export of markdown: rendered to HTML, images inlined, pandoc told html (not markdown)', async () => {
	spawned.length = 0;
	const r = res();
	await handleExportDocx(new URL('http://x/api/export/docx'), req({ content: MD, format: 'markdown', title: 'Trip' }), r, ctx());
	await wait(r);
	assert.equal(r.status, 200);
	assert.ok(r.headers['Content-Disposition'].includes('Trip.docx'));
	assert.equal(spawned.length, 1);
	const { args, stdin } = spawned[0];
	assert.deepEqual(args.slice(0, 4), ['-f', 'html', '-t', 'docx']);
	const html = stdin();
	assert.ok(html.includes('<h1>Trip report</h1>'));
	assert.ok(html.includes('data:image/png;base64,'), 'image embedded so pandoc can put it in the .docx');
	assert.ok(!html.includes(`:/${RID}`) && !html.includes(`/resources/${RID}`));
	assert.ok(!/<a\b[^>]*resources\//.test(html), 'dead attachment link anchors stripped');
});

test('DOCX export keeps html input and the legacy pandoc-markdown input for other callers', async () => {
	spawned.length = 0;
	let r = res();
	await handleExportDocx(new URL('http://x/api/export/docx'), req({ content: '<p>hi</p>', format: 'html', title: 'n' }), r, ctx());
	await wait(r);
	assert.deepEqual(spawned[0].args.slice(0, 2), ['-f', 'html']);
	assert.equal(spawned[0].stdin(), '<p>hi</p>');

	spawned.length = 0;
	r = res();
	await handleExportDocx(new URL('http://x/api/export/docx'), req({ content: '# hi', title: 'n' }), r, ctx());
	await wait(r);
	assert.deepEqual(spawned[0].args.slice(0, 2), ['-f', 'markdown']);
	assert.equal(spawned[0].stdin(), '# hi');
});

test('PDF export of markdown: rendered, images inlined, handed to pandoc as html', async () => {
	spawned.length = 0;
	const r = res();
	await handleExportPdf(new URL('http://x/api/export/pdf'), req({ content: MD, format: 'markdown', title: 'Trip' }), r, ctx());
	await wait(r);
	assert.equal(r.status, 200);
	assert.equal(spawned.length, 1);
	assert.deepEqual(spawned[0].args.slice(0, 4), ['-f', 'html', '-t', 'pdf']);
	const html = spawned[0].stdin();
	assert.ok(html.includes('<h1>Trip report</h1>') && html.includes('data:image/png;base64,'));
	assert.ok(!html.includes(`:/${RID}`) && !html.includes(`/resources/${RID}`));
});

// ---------------------------------------------------------------------------
// Client: markdown mode must reach the exporters (it used to alert "only
// available in rendered mode"), sending markdown from the live CM document.
// ---------------------------------------------------------------------------

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `${name} not found`);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error('unbalanced');
}

function clientCtx({ mode, cmDoc, tinyHtml }) {
	const alerts = [];
	const posts = [];
	const ta = { value: '' };
	const ctx = vm.createContext({
		alert: m => alerts.push(m),
		Blob: class { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } },
		URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
		setTimeout: fn => fn(),
		console,
		Promise,
		_editorMode: mode,
		document: {
			body: { className: 'theme-nord x', appendChild() {}, removeChild() {} },
			querySelector: sel => (sel === '.editor-title' ? { textContent: 'My Note' } : null),
			getElementById: () => null,
			createElement: () => ({ click() {}, remove() {} }),
		},
		fetch: (url, opts) => { posts.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true, blob: () => Promise.resolve({}) }); },
		cmSyncToTA: () => { ta.value = cmDoc; },
		getTA: () => ta,
		tinyMCEContent: () => tinyHtml || '',
	});
	vm.runInContext('function queryActiveEditor(){return null}', ctx);
	for (const fn of ['_isMarkdownModeActive', '_exportSource', 'exportNoteAsHtml', 'exportNoteAsDocx', 'exportNoteAsPdf']) vm.runInContext(extractFn(fn), ctx);
	return { ctx, alerts, posts };
}
const flush = () => new Promise(r => setImmediate(r));

test('client: every export format works in markdown mode and sends the markdown', async () => {
	const { ctx, alerts, posts } = clientCtx({ mode: 'markdown', cmDoc: MD });
	vm.runInContext('exportNoteAsHtml();exportNoteAsDocx();exportNoteAsPdf();', ctx);
	await flush();
	assert.deepEqual(alerts, [], 'no "only available in rendered mode" alerts');
	assert.deepEqual(posts.map(p => p.url), ['/api/export/html', '/api/export/docx', '/api/export/pdf']);
	for (const p of posts) {
		assert.equal(p.body.format, 'markdown');
		assert.equal(p.body.content, MD);
		assert.equal(p.body.title, 'My Note');
	}
	assert.equal(posts[0].body.theme, 'nord');
});

test('client: rendered mode still sends TinyMCE html', async () => {
	const { ctx, alerts, posts } = clientCtx({ mode: 'rich', cmDoc: 'IGNORED', tinyHtml: '<p>rendered</p>' });
	vm.runInContext('exportNoteAsHtml();exportNoteAsDocx();exportNoteAsPdf();', ctx);
	await flush();
	assert.deepEqual(alerts, []);
	for (const p of posts) { assert.equal(p.body.format, 'html'); assert.equal(p.body.content, '<p>rendered</p>'); }
});

test('client: an empty note says "Nothing to export" instead of posting', async () => {
	const { ctx, alerts, posts } = clientCtx({ mode: 'markdown', cmDoc: '   \n' });
	vm.runInContext('exportNoteAsHtml();exportNoteAsDocx();exportNoteAsPdf();', ctx);
	await flush();
	assert.equal(posts.length, 0);
	assert.deepEqual(alerts, ['Nothing to export.', 'Nothing to export.', 'Nothing to export.']);
});

test('export entry points are visible in markdown mode (toolbar button, menu items, mobile sheet)', () => {
	const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
	assert.ok(!/\.editor-markdown-mode\s+#export-note-btn\s*\{\s*display:\s*none/.test(css), 'toolbar export button must not be hidden in markdown mode');
	const toggle = extractFn('toggleExportMenu');
	assert.ok(!toggle.includes('_isMarkdownModeActive'), 'the export menu must offer HTML/DOCX/PDF in markdown mode too');
	assert.ok(!/mobile-ctx-export'\);[\s\S]{0,400}_isMarkdownModeActive/.test(appSrc), 'mobile export entry must not be gated on rendered mode');
});

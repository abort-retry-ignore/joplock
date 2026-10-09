// Things Joplock must not break in a Joplin account: HTML notes, end-to-end
// encrypted items, conflict copies, and the internal `fields` never leaking to the browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { createServer } = require('../app/createServer');
const { createFolderOps } = require('../app/items/folderOps');
const { editorFragment, noteListItem, navigationFragment } = require('../app/templates/fragments');
const { mobileNotesFragment, mobileFoldersFragment } = require('../app/templates/mobile');

const folders = [{ id: 'f1', title: 'Folder', parentId: '' }];
const baseNote = { id: 'n1', title: 'T', body: 'body', parentId: 'f1', createdTime: 1, updatedTime: 2, deletedTime: 0, fields: {} };
const dom = html => new JSDOM(`<body>${html}</body>`).window.document;

// ── HTML notes ──
test('HTML note: rendered body is sanitized, form is flagged read-only, no markdown/rendered switch target', () => {
	const html = editorFragment({ ...baseNote, markupLanguage: 2, body: '<h1>Hi</h1><script>alert(1)</script><p onclick="x()">t</p><img src=":/a1b2c3d4e5f60718293a4b5c6d7e8f90">' }, folders);
	const d = dom(html);
	const form = d.querySelector('#note-editor-form');
	assert.equal(form.dataset.htmlNote, '1');
	assert.match(d.querySelector('.html-note-banner').textContent, /HTML note/);
	assert.equal(d.querySelector('.editor-title').getAttribute('contenteditable'), 'false');
	assert.equal(d.querySelector('#note-body').style.display, 'none');
	assert.equal(d.querySelector('#note-body').value, '<h1>Hi</h1><script>alert(1)</script><p onclick="x()">t</p><img src=":/a1b2c3d4e5f60718293a4b5c6d7e8f90">', 'original HTML kept verbatim for non-content saves');
	const rendered = d.querySelector('#tinymce-slot').getAttribute('data-rendered-body');
	assert.match(rendered, /<h1>Hi<\/h1>/);
	assert.match(rendered, /\/resources\/a1b2c3d4e5f60718293a4b5c6d7e8f90/);
	assert.doesNotMatch(rendered, /script|onclick|alert/);
});

test('markdown notes are untouched by the HTML-note path', () => {
	const d = dom(editorFragment({ ...baseNote, markupLanguage: 1, body: '# md' }, folders));
	assert.equal(d.querySelector('#note-editor-form').dataset.htmlNote, undefined);
	assert.equal(d.querySelector('.html-note-banner'), null);
	assert.equal(d.querySelector('.editor-title').getAttribute('contenteditable'), 'true');
	assert.match(d.querySelector('#tinymce-slot').getAttribute('data-rendered-body'), /<h1[^>]*>md<\/h1>/);
});

// ── E2EE ──
test('end-to-end encrypted note: placeholder only, no form that could save', () => {
	const html = editorFragment({ ...baseNote, e2ee: true, title: '\u{1F512} Encrypted note', body: '' }, folders);
	const d = dom(html);
	assert.ok(d.querySelector('#editor-e2ee'));
	assert.equal(d.querySelector('form'), null);
	assert.equal(d.querySelector('textarea'), null);
	assert.match(d.body.textContent, /end-to-end encrypted by Joplin/);
});

test('E2EE items are marked in note lists and the nav/mobile folder rows', () => {
	const item = dom(noteListItem({ ...baseNote, e2ee: true, title: '\u{1F512} Encrypted note' }, '', 'f1')).querySelector('.notelist-item');
	assert.equal(item.dataset.e2ee, '1');
	assert.ok(item.querySelector('.note-lock-icon'));
	const row = dom(mobileNotesFragment([{ ...baseNote, e2ee: true }], 'f1', 'F', false, 0, 'u')).querySelector('.mobile-note-row');
	assert.equal(row.dataset.e2ee, '1');
	const nav = dom(navigationFragment([{ id: 'e', title: '\u{1F512} Encrypted notebook', parentId: '', e2ee: true }], new Map([['e', 1]]), '', ''));
	assert.equal(nav.querySelector('.nav-folder[data-folder-id="e"]').dataset.e2ee, '1');
	const m = dom(mobileFoldersFragment([{ id: 'e', title: 'x', parentId: '', e2ee: true }], new Map()));
	assert.equal(m.querySelector('.mobile-folder-row[data-folder-id="e"]').dataset.e2ee, '1');
});

// ── folder delete with encrypted / conflict contents ──
const USER = { id: 'u1', sessionId: 's1' };
const opsWorld = ({ foldersList, notesList }) => {
	const calls = [];
	const notesQueries = [];
	const state = { folders: foldersList.map(f => ({ parentId: '', ownerId: 'u1', shareId: '', deletedTime: 0, ...f })), notes: notesList };
	const ops = createFolderOps({
		itemService: {
			foldersByUserId: async () => state.folders.map(f => ({ ...f })),
			folderByUserIdAndJopId: async (u, id) => { const f = state.folders.find(x => x.id === id); return f ? { ...f } : null; },
			notesByUserId: async (u, o) => { notesQueries.push(o); return state.notes.filter(n => n.parentId === o.folderId); },
		},
		itemWriteService: {
			createFolder: async (s, f) => { calls.push(['createFolder', f]); return { id: 'gen' }; },
			updateFolder: async (s, e, u) => { calls.push(['updateFolder', e.id, u]); },
			updateNote: async (s, e, u) => { calls.push(['updateNote', e.id, u]); },
			deleteFolder: async (s, id) => { calls.push(['deleteFolder', id]); },
		},
	});
	return { ops, calls, notesQueries };
};

test('deleting a notebook refuses, before writing anything, when it holds encrypted notes or notebooks', async () => {
	const w = opsWorld({
		foldersList: [{ id: 'p', title: 'P' }, { id: 'kid', title: 'Kid', parentId: 'p' }, { id: 'ekid', title: 'E', parentId: 'p', e2ee: true }],
		notesList: [{ id: 'n1', parentId: 'p' }],
	});
	await assert.rejects(w.ops.deleteFolder({ user: USER, folderId: 'p' }), e => e.statusCode === 409 && /end-to-end encrypted/.test(e.message));
	assert.equal(w.calls.length, 0, 'nothing moved, nothing deleted');

	const w2 = opsWorld({ foldersList: [{ id: 'p', title: 'P' }], notesList: [{ id: 'n1', parentId: 'p', e2ee: true }] });
	await assert.rejects(w2.ops.deleteFolder({ user: USER, folderId: 'p' }), e => e.statusCode === 409);
	assert.equal(w2.calls.length, 0);
});

test('an encrypted notebook itself cannot be deleted or moved from Joplock', async () => {
	const w = opsWorld({ foldersList: [{ id: 'e', title: 'E', e2ee: true }, { id: 'o', title: 'O' }], notesList: [] });
	await assert.rejects(w.ops.deleteFolder({ user: USER, folderId: 'e' }), e => e.statusCode === 403);
	assert.equal(w.calls.length, 0);
});

test('deleting a notebook also moves its hidden conflict copies (they are not left behind)', async () => {
	const w = opsWorld({ foldersList: [{ id: 'p', title: 'P' }, { id: 'g', title: 'General' }], notesList: [{ id: 'c1', parentId: 'p', isConflict: true }] });
	await w.ops.deleteFolder({ user: USER, folderId: 'p' });
	assert.ok(w.notesQueries.every(q => q.includeConflicts === true), 'asks for conflict copies too');
	assert.deepEqual(w.calls.find(c => c[0] === 'updateNote'), ['updateNote', 'c1', { parentId: 'g' }]);
});

// ── JSON API never exposes the internal fields ──
const startServer = async itemService => {
	const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplock-public-'));
	fs.writeFileSync(path.join(publicDir, 'htmx.min.js'), '// stub');
	const server = createServer({
		publicDir, joplinPublicBasePath: '/joplin', joplinPublicBaseUrl: 'http://localhost:5444',
		joplinServerPublicUrl: 'http://localhost:5444/joplin', joplinServerOrigin: 'http://server:22300',
		itemService,
		itemWriteService: {},
		sessionService: { userBySessionId: async sid => sid === 'test-session' ? { id: 'user-1', email: 'u@example.com', sessionId: sid } : null, touchSession: async () => {}, getLastSeen: async () => null, deleteSession: async () => {} },
		settingsService: { settingsByUserId: async () => ({}), saveSettings: async (u, s) => s, appSettings: async () => ({ authRateLimitAttempts: 20 }), getTotpSeed: async () => null },
		historyService: {},
		database: { query: async () => ({ rows: [] }) },
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	return { port: server.address().port, close: () => new Promise(r => server.close(r)) };
};
const get = (port, p) => new Promise((resolve, reject) => {
	http.get({ hostname: '127.0.0.1', port, path: p, headers: { Cookie: 'sessionId=test-session' } }, res => {
		const chunks = [];
		res.on('data', c => chunks.push(c));
		res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
	}).on('error', reject);
});

test('JSON API responses for notes and notebooks do not include the internal `fields`', async () => {
	const secretFields = { title: 'T', user_data: '{"plugin":"secret"}', body: 'b' };
	const s = await startServer({
		foldersByUserId: async () => [{ id: 'f1', title: 'F', parentId: '', fields: secretFields }],
		notesByUserId: async () => [{ ...baseNote, fields: secretFields }],
		noteByUserIdAndJopId: async () => ({ ...baseNote, fields: secretFields }),
	});
	try {
		for (const p of ['/api/web/folders', '/api/web/notes', '/api/web/notes/n1']) {
			const res = await get(s.port, p);
			assert.equal(res.statusCode, 200, p);
			assert.doesNotMatch(res.body, /"fields"|plugin|secret/, p);
		}
		assert.match((await get(s.port, '/api/web/notes/n1')).body, /"title":"T"/, 'the rest of the note is still there');
	} finally {
		await s.close();
	}
});

// ── client: HTML notes never sync back into the textarea ──
test('client: _isHtmlNoteActive and tinyMCESyncToTA leave an HTML note alone', () => {
	const src = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
	const extract = name => {
		const start = src.indexOf(`function ${name}(`);
		let depth = 0;
		for (let i = start; i < src.length; i++) {
			if (src[i] === '{') depth++;
			else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
		}
		throw new Error(name);
	};
	const d = new JSDOM('<form id="note-editor-form" data-html-note="1" data-note-id="n1"><textarea id="note-body">RAW HTML</textarea></form>');
	const ctx = vm.createContext({ document: d.window.document, window: d.window, _tinymceEditor: { getContent: () => '<p>converted</p>' }, _tinymceContentNoteId: 'n1' });
	vm.runInContext(`
		function activeEditorForm(){return document.getElementById('note-editor-form')}
		function _formNoteId(f){return f.dataset.noteId}
		function getTA(){return document.getElementById('note-body')}
		function tinymceToMarkdown(h){return 'MARKDOWN'}
		function _log(){}
	`, ctx);
	vm.runInContext(extract('_isHtmlNoteActive'), ctx);
	vm.runInContext(extract('tinyMCESyncToTA'), ctx);
	assert.equal(vm.runInContext('_isHtmlNoteActive()', ctx), true);
	vm.runInContext('tinyMCESyncToTA()', ctx);
	assert.equal(d.window.document.getElementById('note-body').value, 'RAW HTML', 'the stored HTML is never overwritten by a markdown conversion');
});

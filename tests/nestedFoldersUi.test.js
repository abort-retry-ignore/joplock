/**
 * Nested notebooks — rendering and client behaviour.
 *
 * Server fragments are asserted structurally (JSDOM), and the real nav/mobile
 * functions are extracted from public/app.js and run against that DOM, so the
 * contract between template and script is what is actually tested.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
	navigationFragment, mobileFoldersFragment, editorFragment, folderSelectOob,
} = require('../app/templates');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

const braceBlock = start => {
	assert.ok(start !== -1, 'function not found in app.js');
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error('unbalanced');
};
const extractFn = name => braceBlock(appSrc.indexOf(`function ${name}(`));
const extractWindowFn = name => braceBlock(appSrc.indexOf(`window.${name}=function(`));

const folders = [
	{ id: '__all_notes__', parentId: '', title: 'All Notes', isVirtualAllNotes: true, noteCount: 9 },
	{ id: 'work', parentId: '', title: 'Work' },
	{ id: 'home', parentId: '', title: 'Home' },
	{ id: 'proj', parentId: 'work', title: 'Projects' },
	{ id: 'alpha', parentId: 'proj', title: 'Alpha' },
	{ id: 'de1e7ede1e7ede1e7ede1e7ede1e7ede', parentId: '', title: 'Trash', noteCount: 0 },
];
const counts = new Map([['__all__', 9], ['work', 1], ['proj', 2], ['alpha', 4], ['home', 2]]);

const navDom = (selected = '') => {
	const dom = new JSDOM(`<body>${navigationFragment(folders, counts, selected, '')}</body>`);
	return dom.window.document;
};

// ─── Desktop nav markup ──────────────────────────────────────────────────────

test('nav nests sub-notebooks inside their parent and keeps each notes list as a direct child', () => {
	const doc = navDom();
	const work = doc.querySelector('.nav-folder[data-folder-id="work"]');
	const proj = doc.querySelector('.nav-folder[data-folder-id="proj"]');
	const alpha = doc.querySelector('.nav-folder[data-folder-id="alpha"]');
	assert.equal(proj.parentElement.className, 'nav-folder-children');
	assert.equal(proj.parentElement.parentElement, work);
	assert.equal(alpha.parentElement.parentElement, proj);
	for (const el of [work, proj, alpha]) {
		const own = [...el.children].filter(c => c.classList.contains('nav-folder-notes'));
		assert.equal(own.length, 1, `${el.dataset.folderId} has exactly one own notes list`);
		assert.equal(own[0].dataset.folderId, el.dataset.folderId);
	}
	// children container comes BEFORE the folder's own notes
	const kids = [...work.children].map(c => c.className.split(' ')[0]);
	assert.deepEqual(kids, ['nav-folder-row', 'nav-folder-children', 'nav-folder-notes']);
});

test('nav rows carry depth, parent id and an indent variable', () => {
	const doc = navDom();
	const alpha = doc.querySelector('.nav-folder[data-folder-id="alpha"]');
	assert.equal(alpha.dataset.depth, '2');
	assert.equal(alpha.dataset.parentId, 'proj');
	assert.equal(alpha.getAttribute('style'), '--nav-depth:2');
	assert.equal(doc.querySelector('.nav-folder[data-folder-id="work"]').dataset.parentId, '');
});

test('a notebook that only holds sub-notebooks is expandable and has a chevron', () => {
	const doc = navDom();
	const work = doc.querySelector('.nav-folder[data-folder-id="work"]');
	const row = work.querySelector(':scope > .nav-folder-row');
	assert.ok(row.querySelector('button.nav-folder-toggle'));
	const noNotes = new JSDOM(`<body>${navigationFragment(
		[{ id: 'p', parentId: '', title: 'P' }, { id: 'c', parentId: 'p', title: 'C' }], new Map(), '', '')}</body>`).window.document;
	const p = noNotes.querySelector('.nav-folder[data-folder-id="p"]');
	assert.ok(!p.classList.contains('nav-folder-empty'), 'parent with only children is not "empty"');
	assert.ok(p.classList.contains('nav-folder-has-children'));
	assert.ok(noNotes.querySelector('.nav-folder[data-folder-id="c"]').classList.contains('nav-folder-empty'));
});

test('counts roll up descendants but data-note-count stays direct', () => {
	const doc = navDom();
	const countOf = id => doc.querySelector(`.nav-folder[data-folder-id="${id}"] > .nav-folder-row .sidebar-item-count`).textContent.trim();
	assert.equal(countOf('alpha'), '4');
	assert.equal(countOf('proj'), '6');
	assert.equal(countOf('work'), '7');
	assert.equal(countOf('home'), '2');
	assert.equal(doc.querySelector('.nav-folder[data-folder-id="work"]').dataset.noteCount, '1');
	assert.equal(countOf('__all_notes__'), '9');
});

test('tooltip carries the full notebook path', () => {
	const doc = navDom();
	assert.equal(doc.querySelector('.nav-folder[data-folder-id="alpha"] > .nav-folder-row .nav-folder-title').title, 'Work / Projects / Alpha');
});

test('flat folder lists render exactly one level with no children container', () => {
	const doc = new JSDOM(`<body>${navigationFragment([{ id: 'a', parentId: '', title: 'A' }, { id: 'b', parentId: '', title: 'B' }], new Map([['a', 1]]), '', '')}</body>`).window.document;
	assert.equal(doc.querySelectorAll('.nav-folder').length, 2);
	assert.equal(doc.querySelectorAll('.nav-folder-children').length, 0);
});

// ─── Notebook pickers ────────────────────────────────────────────────────────

test('editor folder select lists notebooks in tree order, indented, with the note\'s folder selected', () => {
	const html = editorFragment({ id: 'n1', title: 'T', body: '', parentId: 'proj', createdTime: 1, updatedTime: 2 }, folders);
	const doc = new JSDOM(`<body>${html}</body>`).window.document;
	const opts = [...doc.querySelectorAll('#editor-folder-select option')];
	assert.deepEqual(opts.map(o => o.value), ['work', 'proj', 'alpha', 'home']);
	assert.equal(opts.find(o => o.selected).value, 'proj');
	assert.ok(opts[1].textContent.includes('Projects') && opts[1].textContent.startsWith('\u00a0'));
	assert.equal(opts[2].title, 'Work / Projects / Alpha');
	assert.equal(opts[0].textContent, 'Work');
});

test('folderSelectOob uses the same tree-ordered options', () => {
	const doc = new JSDOM(`<body>${folderSelectOob(folders)}</body>`).window.document;
	assert.deepEqual([...doc.querySelectorAll('option')].map(o => o.value), ['work', 'proj', 'alpha', 'home']);
});

// ─── Mobile markup ───────────────────────────────────────────────────────────

const mobileDom = () => new JSDOM(`<body><div id="mobile-folders-body">${mobileFoldersFragment(folders, counts)}</div></body>`).window.document;

test('mobile rows: top level visible, nested rows hidden, chevron only where there are children', () => {
	const doc = mobileDom();
	const row = id => doc.querySelector(`.mobile-folder-row[data-folder-id="${id}"]`);
	assert.ok(!row('work').hidden && !row('home').hidden);
	assert.ok(row('proj').hidden && row('alpha').hidden);
	assert.ok(row('work').querySelector('.mobile-folder-toggle:not(.mobile-folder-toggle-placeholder)'));
	assert.ok(row('alpha').querySelector('.mobile-folder-toggle-placeholder'));
	assert.equal(row('alpha').dataset.depth, '2');
	assert.equal(row('alpha').dataset.parentId, 'proj');
	assert.equal(row('work').querySelector('.mobile-folder-count').textContent, '7');
});

test('mobile row keeps the mobilePushNotes onclick contract used by long-press wiring', () => {
	const doc = mobileDom();
	const onclick = doc.querySelector('.mobile-folder-row[data-folder-id="proj"]').getAttribute('onclick');
	assert.match(onclick, /mobilePushNotes\(\s*(?:"([^"]+)"|'([^']+)')\s*,\s*(?:"([^"]*)"|'([^']*)')/);
});

test('flat mobile lists get no chevron gutter at all', () => {
	const doc = new JSDOM(`<body>${mobileFoldersFragment([{ id: 'a', parentId: '', title: 'A' }], new Map([['a', 1]]))}</body>`).window.document;
	assert.equal(doc.querySelectorAll('.mobile-folder-toggle').length, 0);
});

// ─── Client behaviour (real functions from public/app.js) ────────────────────

const navCtx = (selected = '') => {
	const dom = new JSDOM(`<body>${navigationFragment(folders, counts, selected, '')}</body>`, { url: 'http://localhost/' });
	const { window } = dom;
	const ajaxCalls = [];
	const ctx = vm.createContext({
		window, document: window.document, localStorage: window.localStorage, console,
		_log() {}, isMobileShellMode: () => false,
		htmx: { ajax: (m, u, o) => { ajaxCalls.push(u); return Promise.resolve(o); } },
	});
	for (const name of ['navFolderState', 'saveNavFolderState', 'navFolderEl', 'navFolderNotesDiv', 'navParentFolder', 'navFolderVisible', 'navLoadFolderNotes', 'navLoadOpenDescendants', 'toggleNavFolder', 'expandNavFolderState', 'initNavPanel']) {
		vm.runInContext(extractFn(name), ctx);
	}
	return { ctx, doc: window.document, ajaxCalls, ls: window.localStorage };
};
const isOpen = (doc, id) => !doc.querySelector(`.nav-folder[data-folder-id="${id}"]`).classList.contains('collapsed');

test('opening a nested notebook also opens the notebooks above it (and remembers that)', () => {
	const { ctx, doc, ls } = navCtx();
	ctx.toggleNavFolder('alpha', true);
	assert.ok(isOpen(doc, 'alpha') && isOpen(doc, 'proj') && isOpen(doc, 'work'));
	const saved = JSON.parse(ls.getItem('joplock-nav-folders'));
	assert.equal(saved.alpha, '1');
	assert.equal(saved.proj, '1');
	assert.equal(saved.work, '1');
});

test('several notebooks can stay open at once (no accordion)', () => {
	const { ctx, doc } = navCtx();
	ctx.toggleNavFolder('work', true);
	ctx.toggleNavFolder('home', true);
	assert.ok(isOpen(doc, 'work') && isOpen(doc, 'home'));
});

test('collapsing a parent leaves its children\'s own state alone', () => {
	const { ctx, doc, ls } = navCtx();
	ctx.toggleNavFolder('alpha', true);
	ctx.toggleNavFolder('work', false);
	assert.ok(!isOpen(doc, 'work'));
	assert.equal(JSON.parse(ls.getItem('joplock-nav-folders')).proj, '1');
});

test('notes are lazy-loaded into the notebook\'s OWN list, never a sub-notebook\'s', () => {
	const { ctx, doc, ajaxCalls } = navCtx();
	ctx.toggleNavFolder('work', true);
	assert.deepEqual(ajaxCalls, ['/fragments/folder-notes?folderId=work']);
	const own = doc.querySelector('.nav-folder[data-folder-id="work"] > .nav-folder-notes');
	assert.equal(own.getAttribute('data-loaded'), '1');
	assert.equal(doc.querySelector('.nav-folder[data-folder-id="proj"] > .nav-folder-notes').getAttribute('data-loaded'), null);
});

test('a notebook with no direct notes does not request a notes page', () => {
	const dom = new JSDOM(`<body>${navigationFragment([{ id: 'p', parentId: '', title: 'P' }, { id: 'c', parentId: 'p', title: 'C' }], new Map([['c', 2]]), '', '')}</body>`, { url: 'http://localhost/' });
	const calls = [];
	const ctx = vm.createContext({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, console, _log() {}, isMobileShellMode: () => false, htmx: { ajax: (m, u) => { calls.push(u); return Promise.resolve(); } } });
	for (const name of ['navFolderState', 'saveNavFolderState', 'navFolderEl', 'navFolderNotesDiv', 'navParentFolder', 'navFolderVisible', 'navLoadFolderNotes', 'navLoadOpenDescendants', 'toggleNavFolder']) vm.runInContext(extractFn(name), ctx);
	ctx.toggleNavFolder('p', true);
	assert.deepEqual(calls, [], 'p has 0 direct notes');
	ctx.toggleNavFolder('c', true);
	assert.deepEqual(calls, ['/fragments/folder-notes?folderId=c']);
});

test('initNavPanel opens the selected notebook AND its ancestors when nothing is saved', () => {
	const { ctx, doc, ajaxCalls } = navCtx('alpha');
	ctx.initNavPanel();
	assert.ok(isOpen(doc, 'alpha') && isOpen(doc, 'proj') && isOpen(doc, 'work'));
	assert.ok(!isOpen(doc, 'home'));
	assert.ok(ajaxCalls.includes('/fragments/folder-notes?folderId=alpha'));
	assert.ok(ajaxCalls.includes('/fragments/folder-notes?folderId=work'));
});

test('initNavPanel trusts saved state and does not load notes hidden inside a collapsed parent', () => {
	const { ctx, doc, ajaxCalls, ls } = navCtx();
	ls.setItem('joplock-nav-folders', JSON.stringify({ work: '0', proj: '1', alpha: '1' }));
	ctx.initNavPanel();
	assert.ok(!isOpen(doc, 'work'));
	assert.ok(isOpen(doc, 'proj') && isOpen(doc, 'alpha'));
	assert.ok(!ajaxCalls.some(u => /folderId=(work|proj|alpha)$/.test(u)), 'proj/alpha are open but invisible, so nothing is fetched');
	// Expanding the parent then loads the already-open descendants.
	ctx.toggleNavFolder('work', true);
	assert.ok(ajaxCalls.includes('/fragments/folder-notes?folderId=proj'));
	assert.ok(ajaxCalls.includes('/fragments/folder-notes?folderId=alpha'));
});

test('expandNavFolderState remembers a notebook and every ancestor', () => {
	const { ctx, ls } = navCtx();
	ctx.expandNavFolderState('alpha');
	assert.deepEqual(JSON.parse(ls.getItem('joplock-nav-folders')), { alpha: '1', proj: '1', work: '1' });
});

const mobileCtx = () => {
	const dom = new JSDOM(`<body><div id="mobile-folders-body">${mobileFoldersFragment(folders, counts)}</div></body>`, { url: 'http://localhost/' });
	const { window } = dom;
	const ctx = vm.createContext({ window, document: window.document, localStorage: window.localStorage, console });
	const src = [
		'var _MOBILE_FOLDERS_KEY=\'joplock-mobile-folders\';',
		extractFn('mobileFolderState'), extractFn('saveMobileFolderState'), extractFn('_mobileFolderOpen'),
		extractWindowFn('mobileApplyFolderTree'), extractWindowFn('mobileToggleFolderRow'), extractWindowFn('mobileExpandFolderState'),
	].join('\n');
	// the window.* assignments in app.js target the global `window`
	vm.runInContext(src.replace(/window\.(\w+)=function/g, 'window.$1=function'), ctx);
	return { ctx, window, doc: window.document, ls: window.localStorage };
};
const visible = (doc, id) => !doc.querySelector(`.mobile-folder-row[data-folder-id="${id}"]`).hidden;

test('mobile tree: applying with no saved state hides everything below the top level', () => {
	const { window, doc } = mobileCtx();
	window.mobileApplyFolderTree();
	assert.ok(visible(doc, 'work') && visible(doc, 'home'));
	assert.ok(!visible(doc, 'proj') && !visible(doc, 'alpha'));
});

test('mobile tree: toggling expands one level at a time and persists', () => {
	const { window, doc, ls } = mobileCtx();
	window.mobileApplyFolderTree();
	window.mobileToggleFolderRow('work');
	assert.ok(visible(doc, 'proj') && !visible(doc, 'alpha'));
	assert.ok(doc.querySelector('.mobile-folder-row[data-folder-id="work"]').classList.contains('expanded'));
	window.mobileToggleFolderRow('proj');
	assert.ok(visible(doc, 'alpha'));
	assert.deepEqual(JSON.parse(ls.getItem('joplock-mobile-folders')), { work: '1', proj: '1' });
	window.mobileToggleFolderRow('work');
	assert.ok(!visible(doc, 'proj') && !visible(doc, 'alpha'), 'collapsing a parent hides the whole subtree');
});

test('mobile tree: the chevron tap does not also open the notebook', () => {
	const { window } = mobileCtx();
	let stopped = false; let prevented = false;
	window.mobileToggleFolderRow('work', { stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
	assert.ok(stopped && prevented);
});

test('mobile tree: mobileExpandFolderState opens the notebook and its ancestors', () => {
	const { window, doc, ls } = mobileCtx();
	window.mobileExpandFolderState('alpha');
	assert.deepEqual(JSON.parse(ls.getItem('joplock-mobile-folders')), { alpha: '1', proj: '1', work: '1' });
	window.mobileApplyFolderTree();
	assert.ok(visible(doc, 'alpha'));
});

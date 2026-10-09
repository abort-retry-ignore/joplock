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

// ─── Drag and drop (desktop) ─────────────────────────────────────────────────

test('only ordinary notebooks are draggable/droppable; the top-level strip is absent in search mode', () => {
	const list = [
		{ id: '__all_notes__', parentId: '', title: 'All Notes', isVirtualAllNotes: true, noteCount: 1 },
		{ id: 'a', parentId: '', title: 'A' },
		{ id: 'v', parentId: '', title: 'V', isVault: true },
		{ id: 'e', parentId: '', title: 'E', e2ee: true },
		{ id: 'de1e7ede1e7ede1e7ede1e7ede1e7ede', parentId: '', title: 'Trash', noteCount: 0 },
	];
	const doc = new JSDOM(`<body>${navigationFragment(list, new Map(), '', '')}</body>`).window.document;
	const dnd = [...doc.querySelectorAll('.nav-folder-row[data-dnd="1"]')].map(r => r.closest('.nav-folder').dataset.folderId);
	assert.deepEqual(dnd, ['a']);
	assert.equal(doc.querySelectorAll('.nav-folder-row[draggable="true"]').length, 1);
	assert.ok(doc.getElementById('nav-drop-root'));
	const search = new JSDOM(`<body>${navigationFragment(list, [], '', '', 'q')}</body>`).window.document;
	assert.equal(search.getElementById('nav-drop-root'), null);
});

const dragCtx = () => {
	const dom = new JSDOM(`<body><div id="nav-panel">${navigationFragment(folders, counts, '', '')}</div></body>`, { url: 'http://localhost/' });
	const { window } = dom;
	const calls = { requests: [], expanded: [], refreshed: [], toggled: [], alerts: [] };
	const timers = [];
	const ctx = vm.createContext({
		window, document: window.document, console,
		isMobileShellMode: () => false,
		_folderRequest: (m, u, b) => { calls.requests.push([m, u, b]); return Promise.resolve(''); },
		_expandFolderState: id => calls.expanded.push(id),
		_afterFolderChange: (o, id) => calls.refreshed.push([o, id]),
		toggleNavFolder: (id, f) => calls.toggled.push([id, f]),
		alert: m => calls.alerts.push(m),
		setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
		clearTimeout: id => { if (timers[id - 1]) timers[id - 1].live = false; },
	});
	vm.runInContext('var _navDrag=null;var _NAV_DRAG_EXPAND_MS=700;', ctx);
	for (const name of ['_navDragClearMarks', 'navDropAllowed', 'navMoveFolder', 'navDragStart', 'navDragOver', 'navDragLeave', 'navDrop', 'navDragEnd']) vm.runInContext(extractFn(name), ctx);
	const doc = window.document;
	const row = id => doc.querySelector(`.nav-folder[data-folder-id="${id}"] > .nav-folder-row`);
	const runTimers = () => { for (const t of timers) if (t.live) { t.live = false; t.fn(); } };
	const ev = (target, extra = {}) => { const e = { target, prevented: false, preventDefault() { this.prevented = true; }, dataTransfer: { setData() {}, dropEffect: '' }, ...extra }; return e; };
	return { ctx, doc, calls, row, runTimers, ev, timers };
};

test('navDropAllowed: not itself, not its own subtree, not where it already is', () => {
	const { ctx, doc } = dragCtx();
	const el = id => doc.querySelector(`.nav-folder[data-folder-id="${id}"]`);
	const drag = id => ({ id, el: el(id), parentId: el(id).dataset.parentId });
	const allowed = (src, target) => vm.runInContext('navDropAllowed', ctx)(drag(src), el(target));
	assert.equal(allowed('proj', 'home'), true);
	assert.equal(allowed('proj', 'proj'), false, 'itself');
	assert.equal(allowed('work', 'alpha'), false, 'a descendant');
	assert.equal(allowed('work', 'proj'), false, 'a descendant');
	assert.equal(allowed('proj', 'work'), false, 'already its parent: nothing to do');
	assert.equal(allowed('alpha', 'work'), true, 'up a level is fine');
	assert.equal(allowed('home', 'alpha'), true, 'a top-level notebook can go deep');
});

test('dragging a nested notebook onto another moves it; the drop is accepted only on valid targets', () => {
	const { ctx, doc, calls, row, runTimers, ev } = dragCtx();
	const fn = name => vm.runInContext(name, ctx);
	fn('navDragStart')(ev(row('proj')));
	runTimers();
	assert.ok(doc.querySelector('.nav-folder[data-folder-id="proj"]').classList.contains('nav-dragging'));
	assert.ok(doc.body.classList.contains('nav-dragging-folder') && doc.body.classList.contains('nav-drag-nested'));

	const bad = ev(row('alpha'));
	fn('navDragOver')(bad);
	assert.equal(bad.prevented, false, 'a descendant is not a drop target');
	assert.equal(bad.dataTransfer.dropEffect, 'none');
	assert.ok(!row('alpha').classList.contains('nav-drop-target'));

	const good = ev(row('home'));
	fn('navDragOver')(good);
	assert.equal(good.prevented, true);
	assert.equal(good.dataTransfer.dropEffect, 'move');
	assert.ok(row('home').classList.contains('nav-drop-target'));

	const drop = ev(row('home'));
	fn('navDrop')(drop);
	assert.equal(drop.prevented, true);
	assert.deepEqual(calls.requests, [['PUT', '/fragments/folders/proj', 'parentId=home']]);
	assert.ok(!doc.body.classList.contains('nav-dragging-folder'), 'drag state is cleaned up on drop');
	assert.ok(!row('home').classList.contains('nav-drop-target'));
});

test('the top-level strip moves a nested notebook to the top, and is not offered to a top-level one', () => {
	const { ctx, doc, calls, row, runTimers, ev } = dragCtx();
	const fn = name => vm.runInContext(name, ctx);
	const strip = doc.getElementById('nav-drop-root');

	fn('navDragStart')(ev(row('alpha')));
	runTimers();
	const over = ev(strip);
	fn('navDragOver')(over);
	assert.equal(over.prevented, true);
	assert.ok(strip.classList.contains('nav-drop-active'));
	fn('navDrop')(ev(strip));
	assert.deepEqual(calls.requests, [['PUT', '/fragments/folders/alpha', 'parentId=']]);

	fn('navDragStart')(ev(row('home')));
	runTimers();
	assert.ok(!doc.body.classList.contains('nav-drag-nested'), 'strip hidden: it is already top level');
	const noop = ev(strip);
	fn('navDragOver')(noop);
	assert.equal(noop.prevented, false);
	fn('navDrop')(ev(strip));
	assert.equal(calls.requests.length, 1, 'no request for a no-op');
	fn('navDragEnd')();
});

test('hovering a closed notebook with sub-notebooks opens it after a delay; leaving cancels', () => {
	const { ctx, calls, row, runTimers, ev, timers } = dragCtx();
	const fn = name => vm.runInContext(name, ctx);
	fn('navDragStart')(ev(row('home')));
	runTimers();
	fn('navDragOver')(ev(row('work'))); // work is collapsed and has proj below it
	const pending = timers.filter(t => t.live && t.ms === 700);
	assert.equal(pending.length, 1);
	runTimers();
	assert.deepEqual(calls.toggled, [['work', true]]);

	calls.toggled.length = 0;
	fn('navDragOver')(ev(row('work')));
	fn('navDragOver')(ev(row('home')));  // moved away before the delay
	runTimers();
	assert.deepEqual(calls.toggled, [], 'no expansion once the pointer left');
	fn('navDragEnd')();
});

test('drag and drop is ignored for non-notebook rows, in the mobile shell, and without a drag in progress', () => {
	const a = dragCtx();
	const startOnAll = a.ev(a.row('__all_notes__'));
	vm.runInContext('navDragStart', a.ctx)(startOnAll);
	assert.equal(vm.runInContext('_navDrag', a.ctx), null, 'All Notes cannot be dragged');
	const overIdle = a.ev(a.row('home'));
	vm.runInContext('navDragOver', a.ctx)(overIdle);
	assert.equal(overIdle.prevented, false);

	const m = dragCtx();
	vm.runInContext('isMobileShellMode = function(){return true}', m.ctx);
	vm.runInContext('navDragStart', m.ctx)(m.ev(m.row('proj')));
	assert.equal(vm.runInContext('_navDrag', m.ctx), null);
});

test('a failed move shows the server\'s reason instead of failing silently', async () => {
	const { ctx, calls } = dragCtx();
	vm.runInContext('_folderRequest = function(){return Promise.reject(new Error("Stop sharing this notebook before moving it"))}', ctx);
	await vm.runInContext('navMoveFolder', ctx)('proj', 'home');
	assert.deepEqual(calls.alerts, ['Stop sharing this notebook before moving it']);
	assert.deepEqual(calls.refreshed, []);
});

test('dragleave only clears the highlight when the pointer really left the target', () => {
	const { ctx, doc, row, runTimers, ev } = dragCtx();
	const fn = name => vm.runInContext(name, ctx);
	fn('navDragStart')(ev(row('proj')));
	runTimers();
	const target = row('home');
	fn('navDragOver')(ev(target));
	assert.ok(target.classList.contains('nav-drop-target'));
	target.getBoundingClientRect = () => ({ left: 0, right: 200, top: 100, bottom: 130 });

	// to another element inside the nav: kept (the next dragenter/dragover decides)
	fn('navDragLeave')(ev(target, { relatedTarget: doc.querySelector('#nav-panel .nav-folder-title') }));
	assert.ok(target.classList.contains('nav-drop-target'));
	// child boundary crossing with a null relatedTarget, pointer still inside the row: kept
	fn('navDragLeave')(ev(target, { relatedTarget: null, clientX: 50, clientY: 115 }));
	assert.ok(target.classList.contains('nav-drop-target'), 'still inside the row');
	// really left (pointer outside the row, nothing in the nav under it): cleared
	fn('navDragLeave')(ev(target, { relatedTarget: null, clientX: 500, clientY: 115 }));
	assert.ok(!target.classList.contains('nav-drop-target'));
	fn('navDragEnd')();
});

test('dragenter marks the target immediately (not only on the delayed dragover)', () => {
	const { doc, row, ev, ctx, runTimers } = dragCtx();
	vm.runInContext('navDragStart', ctx)(ev(row('proj')));
	runTimers();
	const e = ev(row('home'));
	vm.runInContext('navDragOver', ctx)(e); // dragenter is wired to the same handler
	assert.equal(e.prevented, true);
	assert.ok(row('home').classList.contains('nav-drop-target'));
	void doc;
	assert.ok(/addEventListener\('dragenter',navDragOver\)/.test(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8')));
});

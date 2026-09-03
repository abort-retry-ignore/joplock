/**
 * Regression tests for the plaintext save identity guard
 * (_plaintextSaveIdentityOk) and its wiring in public/app.js.
 *
 * Bug class this locks down: a raced async render (e.g. /fragments/preview
 * response for note A arriving after the user switched to note B) loaded
 * note A's content into the persistent TinyMCE; the next TinyMCE→textarea
 * sync wrote it into note B's form and the autosave PUT replaced note B's
 * body with note A's contents. Before any note write, the client must verify
 * it is saving the note whose content signature it last displayed.
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

const NOTE_A = 'a'.repeat(32);
const NOTE_B = 'b'.repeat(32);

function makeCtx(opts) {
	opts = opts || {};
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const doc = dom.window.document;
	const host = doc.createElement('div');
	host.id = 'tinymce-host';
	if (opts.tinymceVisible) host.classList.add('tinymce-host-visible');
	doc.body.appendChild(host);
	const formA = doc.createElement('form');
	formA.id = 'note-editor-form';
	formA.setAttribute('hx-put', '/fragments/editor/' + NOTE_A);
	formA.dataset.noteId = NOTE_A;
	doc.body.appendChild(formA);
	const ctx = vm.createContext({
		document: doc,
		_displayedNoteId: opts.displayed !== undefined ? opts.displayed : NOTE_A,
		_tinymceContentNoteId: opts.tinymceContent !== undefined ? opts.tinymceContent : '',
		_editorMode: opts.mode || 'markdown',
		_tinymceEditor: opts.tinymceEditor !== undefined ? opts.tinymceEditor : null,
		activeEditorForm: function () { return opts.activeForm === undefined ? formA : opts.activeForm; },
		_log: function () {},
	});
	vm.runInContext(extractFn('_formNoteId'), ctx);
	vm.runInContext(extractFn('_plaintextSaveIdentityOk'), ctx);
	return { ctx, formA };
}

test('passes for the connected active form matching the displayed note', () => {
	const { ctx, formA } = makeCtx({ mode: 'markdown' });
	assert.equal(vm.runInContext('_plaintextSaveIdentityOk(formA)', Object.assign(ctx, { formA })), true);
});

test('blocks when the displayed note is a different note', () => {
	const { ctx, formA } = makeCtx({ displayed: NOTE_B, mode: 'markdown' });
	assert.equal(vm.runInContext('_plaintextSaveIdentityOk(formA)', Object.assign(ctx, { formA })), false);
});

test('blocks when the form is detached (stale captured form)', () => {
	const { ctx, formA } = makeCtx({ mode: 'markdown' });
	formA.remove();
	assert.equal(vm.runInContext('_plaintextSaveIdentityOk(formA)', Object.assign(ctx, { formA })), false);
});

test('blocks in rendered mode when visible TinyMCE content belongs to another note', () => {
	const { ctx, formA } = makeCtx({ mode: 'rich', tinymceEditor: {}, tinymceVisible: true, tinymceContent: NOTE_B });
	assert.equal(vm.runInContext('_plaintextSaveIdentityOk(formA)', Object.assign(ctx, { formA })), false);
});

test('passes in rendered mode when TinyMCE content matches the note', () => {
	const { ctx, formA } = makeCtx({ mode: 'rich', tinymceEditor: {}, tinymceVisible: true, tinymceContent: NOTE_A });
	assert.equal(vm.runInContext('_plaintextSaveIdentityOk(formA)', Object.assign(ctx, { formA })), true);
});

test('permissive when provenance stamps are empty (boot state)', () => {
	const { ctx, formA } = makeCtx({ displayed: '', tinymceContent: '', mode: 'rich', tinymceEditor: {}, tinymceVisible: true });
	assert.equal(vm.runInContext('_plaintextSaveIdentityOk(formA)', Object.assign(ctx, { formA })), true);
});

test('blocks when the form is not the active editor form', () => {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const doc = dom.window.document;
	const formA = doc.createElement('form');
	formA.setAttribute('hx-put', '/fragments/editor/' + NOTE_A);
	doc.body.appendChild(formA);
	const formB = doc.createElement('form');
	formB.setAttribute('hx-put', '/fragments/editor/' + NOTE_B);
	doc.body.appendChild(formB);
	const ctx = vm.createContext({
		document: doc,
		_displayedNoteId: NOTE_A,
		_tinymceContentNoteId: '',
		_editorMode: 'markdown',
		_tinymceEditor: null,
		activeEditorForm: function () { return formB; },
		_log: function () {},
	});
	vm.runInContext(extractFn('_formNoteId'), ctx);
	vm.runInContext(extractFn('_plaintextSaveIdentityOk'), ctx);
	assert.equal(vm.runInContext('_plaintextSaveIdentityOk(formA)', Object.assign(ctx, { formA })), false);
});

// --- Static wiring assertions: every save path must consult the guard, and
// every async content injection must be identity-guarded. ---

test('scheduleSave, scheduleSaveTitle and buildFlushRequest consult the identity guard', () => {
	assert.ok(appSrc.includes("_plaintextSaveIdentityOk(form)){_log('scheduleSave aborted"), 'scheduleSave guard missing');
	assert.ok(appSrc.includes("_plaintextSaveIdentityOk(form)){_log('scheduleSaveTitle aborted"), 'scheduleSaveTitle guard missing');
	assert.ok(/function buildFlushRequest\(form\)\{[\s\S]*?_plaintextSaveIdentityOk\(form\)/.test(appSrc), 'buildFlushRequest guard missing');
});

test('htmx:configRequest choke point blocks editor PUTs on identity mismatch', () => {
	const idx = appSrc.indexOf("editor save blocked at configRequest");
	assert.ok(idx !== -1, 'configRequest guard missing');
	const block = appSrc.slice(appSrc.lastIndexOf('htmx:configRequest', idx), idx + 400);
	assert.ok(block.includes('e.preventDefault()'), 'configRequest guard does not cancel the request');
	assert.ok(block.includes("_plaintextSaveIdentityOk(form)"), 'configRequest guard does not call the identity check');
	assert.ok(block.includes("form.dataset.encrypted==='1'"), 'configRequest guard must skip encrypted saves');
});

test('async preview loads are discarded when the note changed mid-flight', () => {
	assert.ok(appSrc.includes("'setEditorMode: preview response discarded, note changed mid-flight'"), 'setEditorMode guard missing');
	assert.ok(appSrc.includes("'refreshTinyMCE: preview response discarded, note changed mid-flight'"), 'refreshTinyMCEForActiveNote guard missing');
	assert.ok(/function setEditorMode\(mode\)\{[\s\S]*?var _swNoteId=form\?_formNoteId\(form\):'';/.test(appSrc), 'setEditorMode does not capture the note id');
});

test('_setTinyMCEContent stamps provenance and sync paths verify it', () => {
	assert.ok(/function _setTinyMCEContent\(html,noteId\)\{[\s\S]{0,400}_tinymceContentNoteId=noteId/.test(appSrc), '_setTinyMCEContent provenance stamp missing');
	assert.ok(appSrc.includes("'tinyMCESyncToTA skipped: TinyMCE content belongs to another note'"), 'tinyMCESyncToTA provenance guard missing');
	assert.ok(appSrc.includes("'_lazyTinyMCESyncBeforeSave skipped: TinyMCE content provenance mismatch'"), '_lazyTinyMCESyncBeforeSave provenance guard missing');
});

test('_completeUnlock refuses to write plaintext into a switched-to note', () => {
	assert.ok(appSrc.includes("'_completeUnlock aborted: active note changed during unlock'"), '_completeUnlock identity guard missing');
});

test('stale save responses cannot mark a new note as Saved', () => {
	assert.ok(appSrc.includes("'afterRequest: ignoring stale editor save response (form replaced)'"), 'afterRequest stale-save guard missing');
	assert.ok(appSrc.includes('if(activeEditorForm()===form){snapshotHash()'), 'flushSave stale-save guard missing');
});

test('editor swap clears the displayed-content stamps', () => {
	const idx = appSrc.indexOf("_searchHlTerm=pt||navTerm||'';hideTinyMCEHost();_displayedNoteId='';_tinymceContentNoteId=''");
	assert.ok(idx !== -1, 'beforeSwap provenance clear missing');
});

test('initEditorPanel stamps the displayed note before its early return', () => {
	assert.ok(/function initEditorPanel\(\)\{var form=activeEditorForm\(\);if\(form\)_displayedNoteId=_formNoteId\(form\);if\(!form\|\|form.dataset.editorInit\)return;/.test(appSrc), 'initEditorPanel provenance stamp missing');
});
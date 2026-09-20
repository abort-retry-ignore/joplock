/**
 * Regression: unlocking an encrypted note with markdown as the preferred
 * open mode showed a blank editor.
 *
 * Root cause: locked notes skip editor init, so TinyMCE never received this
 * note's plaintext (and `#tinymce-host` stays hidden). `_completeUnlock`
 * used to call `setEditorMode('markdown')`, which `tinyMCESyncToTA()`s the
 * leftover/empty iframe over the just-decrypted textarea, then mounts CM6
 * from that wiped body.
 *
 * Pins:
 *   * `_completeUnlock` seeds markdown from the `plaintext` argument.
 *   * `tinyMCESyncToTA` refuses to write when the TinyMCE host is hidden
 *     (empty `_tinymceContentNoteId` is otherwise permissive).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

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

const NOTE_ID = 'a'.repeat(32);
const VAULT_ID = 'b'.repeat(32);

// ---------------------------------------------------------------------------
// Static wiring
// ---------------------------------------------------------------------------

test('_completeUnlock markdown path seeds CM6 from plaintext, not setEditorMode', () => {
	const src = extractFn('_completeUnlock');
	assert.ok(src.includes("if(preferredEditorMode()==='markdown')"), '_completeUnlock must branch on markdown preference');
	assert.ok(src.includes('mountMarkdownEditor(plaintext)'), '_completeUnlock must mount CM6 from the decrypted plaintext argument');
	assert.ok(!src.includes("setEditorMode(_defaultNoteOpenMode==='markdown'?'markdown':'rich')"), '_completeUnlock must not route markdown unlock through setEditorMode (that tinyMCESyncToTA()s leftover iframe content over the decrypted body)');
	assert.ok(src.includes("setEditorMode('rich')"), 'rich-preference unlock may still use setEditorMode (cmSyncToTA is a no-op when CM is unmounted)');
});

test('tinyMCESyncToTA skips when the TinyMCE host is not visible', () => {
	const src = extractFn('tinyMCESyncToTA');
	assert.ok(src.includes("tinyMCESyncToTA skipped: TinyMCE host not visible"), 'tinyMCESyncToTA must refuse to write when #tinymce-host is hidden');
	assert.ok(src.includes('tinymce-host-visible'), 'visibility check must use the tinymce-host-visible class');
});

// ---------------------------------------------------------------------------
// Behavioral
// ---------------------------------------------------------------------------

function makeUnlockDom({ hostVisible = false } = {}) {
	const hostClass = hostVisible ? 'tinymce-host tinymce-host-visible' : 'tinymce-host';
	return new JSDOM(`<!DOCTYPE html>
		<body>
			<form id="note-editor-form" class="editor-form"
				data-note-id="${NOTE_ID}" data-encrypted="1" data-vault-id="${VAULT_ID}"
				hx-put="/fragments/editor/${NOTE_ID}">
				<div class="editor-locked" id="editor-locked">locked</div>
				<div class="editor-toolbar" id="editor-toolbar" style="display:none"></div>
				<button type="button" id="markdown-toggle" style="display:none">MD</button>
				<button type="button" id="preview-toggle" style="display:none">PV</button>
				<textarea name="body" class="editor-body" id="note-body">CIPHERTEXT</textarea>
				<div id="cm-host" class="cm-host" style="display:none"></div>
				<div id="tinymce-slot" class="tinymce-slot"></div>
			</form>
			<div id="tinymce-host" class="${hostClass}"></div>
		</body>`, { url: 'https://joplock.test' });
}

function makeSyncSandbox({ hostVisible, taValue, tinymceHtml, contentNoteId = '' }) {
	const dom = makeUnlockDom({ hostVisible });
	const ta = dom.window.document.getElementById('note-body');
	ta.value = taValue;
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		Event: dom.window.Event,
		_tinymceEditor: { getContent() { return tinymceHtml; } },
		_tinymceContentNoteId: contentNoteId,
		_logs: [],
	});
	vm.runInContext(`
		function activeEditorForm(){return document.getElementById('note-editor-form')}
		function _formNoteId(form){return (form&&form.dataset&&form.dataset.noteId)||''}
		function getTA(){return document.getElementById('note-body')}
		function tinymceToMarkdown(html){return String(html||'').replace(/<[^>]+>/g,'').trim()}
		function _log(){ _logs.push([].slice.call(arguments).join(' ')); }
	`, ctx);
	vm.runInContext(extractFn('tinyMCESyncToTA'), ctx);
	return { ctx, ta };
}

test('tinyMCESyncToTA does not clobber textarea when TinyMCE host is hidden', () => {
	const { ctx, ta } = makeSyncSandbox({
		hostVisible: false,
		taValue: 'just decrypted plaintext',
		tinymceHtml: '<p></p>',
		contentNoteId: '',
	});
	const changed = vm.runInContext('tinyMCESyncToTA()', ctx);
	assert.equal(changed, false, 'must report no change');
	assert.equal(ta.value, 'just decrypted plaintext', 'hidden TinyMCE leftover/empty content must not overwrite decrypted plaintext');
});

test('tinyMCESyncToTA still syncs when TinyMCE host is visible (rich→markdown switch)', () => {
	const { ctx, ta } = makeSyncSandbox({
		hostVisible: true,
		taValue: 'stale textarea',
		tinymceHtml: '<p>live rich edits</p>',
		contentNoteId: NOTE_ID,
	});
	const changed = vm.runInContext('tinyMCESyncToTA()', ctx);
	assert.equal(changed, true, 'visible TinyMCE must sync into the textarea');
	assert.equal(ta.value, 'live rich edits', 'visible TinyMCE content is the source of truth for a real mode switch');
});

function makeUnlockSandbox({ openMode = 'markdown' } = {}) {
	const dom = makeUnlockDom({ hostVisible: false });
	const mounted = [];
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		Event: dom.window.Event,
		_defaultNoteOpenMode: openMode,
		_editorMode: 'rich',
		_tinymceEditor: { getContent() { return '<p>LEFTOVER FROM PREVIOUS NOTE</p>'; } },
		_tinymceContentNoteId: '',
		_mounted: mounted,
		_saveTimer: null,
		_savedHash: 0,
		SVG_LOCK_OPEN: 'open',
		SVG_LOCK_CLOSED: 'closed',
	});
	vm.runInContext(`
		function activeEditorForm(){return document.getElementById('note-editor-form')}
		function _formNoteId(form){return (form&&form.dataset&&form.dataset.noteId)||''}
		function _activeEditorNoteId(){return _formNoteId(activeEditorForm())}
		function getTA(){return document.getElementById('note-body')}
		function queryActiveEditor(sel){var f=activeEditorForm();return f&&f.querySelector?f.querySelector(sel):null}
		function touchVaultActivity(){}
		function _log(){}
		function applyEditorModeVisibility(mode){
			var host=queryActiveEditor('#cm-host');
			var ta=getTA();
			if(mode==='markdown'){if(host)host.style.display='';if(ta)ta.style.display='none'}
		}
		function mountMarkdownEditor(content){ _mounted.push(content); }
		function syncEditorModeButtons(){}
		function _reconcileSaveStateAfterModeSwitch(){}
		function snapshotHash(){ _savedHash = 1; }
		function _updateLockToggle(){}
		function _updateNoteLockIcon(){}
		function _refreshVaultIcon(){}
		function setEditorMode(mode){
			// Deliberately the OLD clobbering behaviour, so the test fails if
			// _completeUnlock still routes markdown unlock through this.
			var ta=getTA();
			if(mode==='markdown'&&ta) ta.value='CLOBBERED BY TINYMCE SYNC';
			_editorMode=mode;
		}
		function preferredEditorMode(){return _defaultNoteOpenMode==='markdown'?'markdown':'rich'}
		function tinymceToMarkdown(html){return String(html||'').replace(/<[^>]+>/g,'').trim()}
	`, ctx);
	vm.runInContext(extractFn('_completeUnlock'), ctx);
	return { ctx, dom, mounted };
}

test('_completeUnlock with markdown preference keeps decrypted plaintext and mounts it', () => {
	const { ctx, dom, mounted } = makeUnlockSandbox({ openMode: 'markdown' });
	vm.runInContext(`_completeUnlock(${JSON.stringify(NOTE_ID)}, 'hello from the vault', ${JSON.stringify(VAULT_ID)})`, ctx);
	const ta = dom.window.document.getElementById('note-body');
	assert.equal(ta.value, 'hello from the vault', 'textarea must keep decrypted plaintext');
	assert.deepEqual(mounted, ['hello from the vault'], 'CM6 must be seeded from decrypted plaintext');
	assert.equal(ctx._editorMode, 'markdown');
	assert.equal(dom.window.document.getElementById('editor-locked').style.display, 'none', 'lock overlay must hide');
	assert.equal(dom.window.document.getElementById('editor-toolbar').style.display, '', 'toolbar must show');
});

test('_completeUnlock with rendered preference still uses setEditorMode(rich)', () => {
	const { ctx, dom, mounted } = makeUnlockSandbox({ openMode: 'preview' });
	vm.runInContext(`_completeUnlock(${JSON.stringify(NOTE_ID)}, 'hello from the vault', ${JSON.stringify(VAULT_ID)})`, ctx);
	const ta = dom.window.document.getElementById('note-body');
	assert.equal(ta.value, 'hello from the vault', 'rich unlock must not clobber plaintext either');
	assert.equal(mounted.length, 0, 'markdown editor must not mount when preference is rendered');
	assert.equal(ctx._editorMode, 'rich');
});

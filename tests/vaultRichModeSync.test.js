/**
 * Regression tests for a bug where vault notes edited in rich (TinyMCE) mode
 * lost content on autosave and on folder-change (move out of vault).
 *
 * Root cause: TinyMCE does NOT sync its content into the hidden #note-body
 * textarea on every keystroke (perf optimization — see onEdit's comment in
 * app.js and tests/tinymceOnEditSync.test.js). The plain-note save path
 * accounts for this by calling _lazyTinyMCESyncBeforeSave() right before
 * hashing/reading the textarea. Two vault-specific code paths did NOT do
 * this and read/hashed a stale #note-body value instead:
 *
 *   1. The encrypted scheduleSave() override (used for all vault notes).
 *      Effect: formHash(form) never changed after typing in rich mode, so
 *      the debounced autosave silently no-op'd ("skip, hash unchanged")
 *      while the UI still showed "Saved". The real edit stayed trapped in
 *      the TinyMCE iframe and was never persisted unless the user
 *      navigated away (buildFlushRequest DOES sync correctly).
 *
 *   2. The folder-change handler (moving a note in/out of a vault). Effect:
 *      moving a vault note to a non-vault folder right after typing in rich
 *      mode saved stale/empty plaintext instead of what was on screen.
 *
 * This file pins:
 *   * Static wiring: both code paths call _lazyTinyMCESyncBeforeSave() at
 *     the right point (before formHash / before reading ta.value).
 *   * Behavioral: extracted copies of both functions, run against a fake
 *     TinyMCE editor whose content has diverged from #note-body, produce
 *     the NEW content — not the stale one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function extractBraced(startIdx, openBraceOffset) {
	let depth = 1, i = startIdx + openBraceOffset;
	while (i < appSrc.length && depth > 0) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') depth--;
		i++;
	}
	return appSrc.slice(startIdx, i);
}

// Same brace-matching as extractBraced, but returns only the INNER body
// (the text between the opening and matching closing brace), not the
// surrounding statement.
function extractBracedInner(startIdx, openBraceOffset) {
	let depth = 1, i = startIdx + openBraceOffset;
	while (i < appSrc.length && depth > 0) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') depth--;
		i++;
	}
	return appSrc.slice(startIdx + openBraceOffset, i - 1);
}

// Extracts the body of `scheduleSave=function(){...}` (the encrypted-note
// override that reassigns the global scheduleSave, distinct from the
// original `function scheduleSave(){...}` declaration).
function extractScheduleSaveOverride() {
	const marker = 'scheduleSave=function(){';
	const idx = appSrc.indexOf(marker);
	assert.ok(idx !== -1, 'encrypted scheduleSave override not found in app.js');
	return extractBraced(idx, marker.length);
}

// Extracts the folder-change `change` event listener callback body
// (the handler bound to #editor-folder-select inside the
// "Move note: encrypt/decrypt when folder changes" IIFE).
function extractFolderChangeHandler() {
	const iifeMarker = '// Move note: encrypt/decrypt when folder changes';
	const iifeIdx = appSrc.indexOf(iifeMarker);
	assert.ok(iifeIdx !== -1, 'folder-change IIFE not found in app.js');
	const marker = "document.body.addEventListener('change',function(e){";
	const idx = appSrc.indexOf(marker, iifeIdx);
	assert.ok(idx !== -1, 'folder-change change listener not found in app.js');
	return extractBracedInner(idx, marker.length);
}

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
// Static wiring guards
// ---------------------------------------------------------------------------

test('app.js: encrypted scheduleSave override calls _lazyTinyMCESyncBeforeSave before formHash', () => {
	const src = extractScheduleSaveOverride();
	const syncIdx = src.indexOf('_lazyTinyMCESyncBeforeSave()');
	const hashIdx = src.indexOf('formHash(form)');
	assert.ok(syncIdx !== -1, 'encrypted scheduleSave override must call _lazyTinyMCESyncBeforeSave — otherwise rich-mode edits to vault notes are silently skipped (hash never changes)');
	assert.ok(hashIdx !== -1, 'encrypted scheduleSave override must still hash-check');
	assert.ok(syncIdx < hashIdx, 'lazy sync must run BEFORE formHash in the encrypted-save override, same as the plain path');
});

test('app.js: folder-change handler calls _lazyTinyMCESyncBeforeSave after getTA() and before reading ta.value', () => {
	const src = extractFolderChangeHandler();
	// Strip //-comments before scanning for ta.value usage — the fix's own
	// explanatory comment mentions "ta.value" in prose, which would
	// otherwise be a false-positive match for the code-usage scan below.
	const codeOnly = src.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
	const taIdx = codeOnly.indexOf('getTA()');
	const syncIdx = codeOnly.indexOf('_lazyTinyMCESyncBeforeSave()');
	assert.ok(taIdx !== -1, 'folder-change handler must read the active textarea');
	assert.ok(syncIdx !== -1, 'folder-change handler must call _lazyTinyMCESyncBeforeSave — otherwise moving a vault note right after typing in rich mode saves stale/empty content');
	assert.ok(syncIdx > taIdx, 'sync must run after ta is obtained (getTA() must resolve to the current form before syncing)');
	// Every later use of `ta.value` in this handler must come after the sync.
	const taValueUses = [...codeOnly.matchAll(/ta\.value/g)].map(m => m.index);
	assert.ok(taValueUses.length > 0, 'sanity: handler should read ta.value somewhere');
	for (const useIdx of taValueUses) {
		assert.ok(useIdx > syncIdx, `every ta.value read (at ${useIdx}) must come after the _lazyTinyMCESyncBeforeSave() call (at ${syncIdx})`);
	}
});

// ---------------------------------------------------------------------------
// Behavioral: encrypted scheduleSave override actually encrypts the LATEST
// TinyMCE content, not a stale #note-body value.
// ---------------------------------------------------------------------------

function makeEncryptedSaveSandbox({ taValue = '', tinymceHtml = '<p></p>', identityOk = true } = {}) {
	const dom = new JSDOM(`<!DOCTYPE html>
		<body>
			<form id="note-editor-form" data-note-id="note1" data-vault-id="vault1" data-encrypted="1">
				<select name="parentId"><option value="vault1" selected>Vault</option></select>
				<textarea name="body" id="note-body">${taValue}</textarea>
			</form>
			<div id="tinymce-host" class="tinymce-host tinymce-host-visible"></div>
		</body>`, { url: 'https://joplock.test' });

	const editor = { getContent() { return tinymceHtml; } };
	const savedCiphertexts = [];

	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		Event: dom.window.Event,
		setTimeout: (fn) => { fn(); return 0; }, // run "debounced" callback immediately for the test
		clearTimeout: () => {},
		_tinymceEditor: editor,
		_tinymceSuppressEdits: false,
		_tinymceReadonly: false,
		_editorMode: 'rich',
		_saveTimer: null,
		_syncPVInFlight: false,
		_pvSyncTimer: null,
		_flushSaveInFlight: false,
		_savedHash: 'stale-hash', // deliberately different from the post-sync hash
		savedCiphertexts,
	});

	vm.runInContext(`
		function activeEditorForm(){return document.getElementById('note-editor-form')}
		function _origScheduleSave(){throw new Error('should not fall back to plain path for a vault note')}
		function _log(){}
		function _anyModalOpen(){return false}
		function _encryptedSaveIdentityOk(){return ${identityOk}}
		function _activeEditorNoteId(){return 'note1'}
		function tinymceToMarkdown(html){return String(html||'').replace(/<[^>]+>/g,'')}
		function getTA(){return document.getElementById('note-body')}
		function isEncryptedBody(v){return /joplock_encrypted/.test(v)}
		function formHash(form){return form.querySelector('textarea').value+'|'+form.querySelector('select').value}
		function getVaultKey(){return Promise.resolve('fake-key')}
		function getVaultSalt(){return 'fake-salt'}
		function encryptForVault(plaintext){return Promise.resolve('joplock_encrypted:'+plaintext)}
		function _triggerEncryptedSave(form,ciphertext){savedCiphertexts.push(ciphertext)}
		function touchVaultActivity(){}
		function setSaveState(){}
	`, ctx);

	vm.runInContext(extractFn('_lazyTinyMCESyncBeforeSave'), ctx);
	vm.runInContext(`var scheduleSave; ${extractScheduleSaveOverride().replace(/^scheduleSave=function\(\)\{/, 'scheduleSave=function(){')}`, ctx);
	// The extracted text already starts with "scheduleSave=function(){" so
	// just run it directly as an assignment statement.
	return { ctx, dom, savedCiphertexts };
}

test('behavioral: encrypted scheduleSave override encrypts fresh TinyMCE content, not stale #note-body', async () => {
	const { ctx, savedCiphertexts } = makeEncryptedSaveSandbox({
		taValue: 'old plaintext',
		tinymceHtml: '<p>new plaintext typed in rich mode</p>',
	});
	vm.runInContext('scheduleSave()', ctx);
	// scheduleSave's internal work is async (await getVaultKey(), etc.) even
	// though our fake setTimeout runs synchronously — flush microtasks.
	await new Promise(resolve => setImmediate(resolve));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(savedCiphertexts.length, 1, 'exactly one encrypted save must fire');
	assert.match(savedCiphertexts[0], /new plaintext typed in rich mode/, 'ciphertext must be derived from the CURRENT TinyMCE content, not the stale textarea value');
	assert.doesNotMatch(savedCiphertexts[0], /^joplock_encrypted:old plaintext$/, 'must not encrypt the stale textarea value');
});

test('behavioral: encrypted scheduleSave skips when TinyMCE content truly matches saved state', async () => {
	const { ctx, savedCiphertexts } = makeEncryptedSaveSandbox({
		taValue: 'same content',
		tinymceHtml: '<p>same content</p>',
	});
	// Pre-compute what the hash WILL be after lazy-sync so the test doesn't
	// spuriously fire a save (sync is a no-op here since content matches).
	vm.runInContext("_savedHash=formHash(activeEditorForm())", ctx);
	vm.runInContext('scheduleSave()', ctx);
	await new Promise(resolve => setImmediate(resolve));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(savedCiphertexts.length, 0, 'no save should fire when nothing actually changed');
});

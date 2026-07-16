/**
 * Tests for the /ask slash-command runtime in public/app.js:
 *   - detectAskCommand(): line matcher for "/ask <question>"
 *   - askDisabledForActiveNote(): vault/encrypted-note guard
 *   - handleAskInCM(): placeholder-insert -> fetch -> answer-swap flow (CM6)
 *
 * Functions are extracted from public/app.js and executed in a vm sandbox,
 * following the pattern established in tests/expanderRuntime.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// Extract a named function's source text from app.js (handles minified single-line functions).
function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `function ${name} not found in app.js`);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error(`Could not find closing brace for function ${name}`);
}

// ---------------------------------------------------------------------------
// detectAskCommand()
// ---------------------------------------------------------------------------

const detectCtx = vm.createContext({});
vm.runInContext(extractFn('detectAskCommand'), detectCtx);
const detectAskCommand = detectCtx.detectAskCommand;

test('detectAskCommand: valid question', () => {
	assert.equal(detectAskCommand('/ask What is rain?').question, 'What is rain?');
});

test('detectAskCommand: trims trailing whitespace', () => {
	assert.equal(detectAskCommand('/ask   spaced question   ').question, 'spaced question');
});

test('detectAskCommand: rejects leading whitespace', () => {
	assert.equal(detectAskCommand('  /ask leading space'), null);
});

test('detectAskCommand: rejects no space after /ask', () => {
	assert.equal(detectAskCommand('/asknospace'), null);
});

test('detectAskCommand: rejects /ask alone', () => {
	assert.equal(detectAskCommand('/ask'), null);
});

test('detectAskCommand: rejects /ask followed by only spaces', () => {
	assert.equal(detectAskCommand('/ask    '), null);
});

test('detectAskCommand: rejects mid-line /ask', () => {
	assert.equal(detectAskCommand('the /ask should not match'), null);
});

test('detectAskCommand: accepts tab as separator', () => {
	assert.equal(detectAskCommand('/ask\tHello?').question, 'Hello?');
});

test('detectAskCommand: empty or falsy input', () => {
	assert.equal(detectAskCommand(''), null);
	assert.equal(detectAskCommand(null), null);
	assert.equal(detectAskCommand(undefined), null);
});

// ---------------------------------------------------------------------------
// askDisabledForActiveNote()
// ---------------------------------------------------------------------------

function makeGuardCtx(formAttrs) {
	const attrs = formAttrs || {};
	const dom = new JSDOM(
		'<!DOCTYPE html><body><form id="note-editor-form"></form></body>',
		{ url: 'https://joplock.test' },
	);
	const form = dom.window.document.getElementById('note-editor-form');
	Object.keys(attrs).forEach(k => { form.dataset[k] = attrs[k]; });
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		isMobileShellMode() { return false; },
	});
	vm.runInContext(extractFn('activeEditorForm'), ctx);
	vm.runInContext(extractFn('askDisabledForActiveNote'), ctx);
	return ctx;
}

test('askDisabledForActiveNote: false for plain note', () => {
	const ctx = makeGuardCtx({});
	assert.equal(ctx.askDisabledForActiveNote(), false);
});

test('askDisabledForActiveNote: true when encrypted=1', () => {
	const ctx = makeGuardCtx({ encrypted: '1' });
	assert.equal(ctx.askDisabledForActiveNote(), true);
});

test('askDisabledForActiveNote: true when inside a vault (vaultId set)', () => {
	const ctx = makeGuardCtx({ vaultId: 'vault-123' });
	assert.equal(ctx.askDisabledForActiveNote(), true);
});

test('askDisabledForActiveNote: false when no active form', () => {
	const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		isMobileShellMode() { return false; },
	});
	vm.runInContext(extractFn('activeEditorForm'), ctx);
	vm.runInContext(extractFn('askDisabledForActiveNote'), ctx);
	assert.equal(ctx.askDisabledForActiveNote(), false);
});

// ---------------------------------------------------------------------------
// handleAskInCM(): placeholder-insert -> fetch -> answer-swap flow
// ---------------------------------------------------------------------------

function makeCMHandlerCtx({ docText, resolvedAnswer = 'The answer.', formNoteId = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', switchNoteBeforeResolve = false } = {}) {
	const dom = new JSDOM(
		'<!DOCTYPE html><body><form id="note-editor-form"></form></body>',
		{ url: 'https://joplock.test' },
	);
	const form = dom.window.document.getElementById('note-editor-form');
	form.setAttribute('hx-put', `/fragments/editor/${formNoteId}`);

	let doc = docText;
	let caret = docText.length;
	const dispatched = [];
	const mockCM = {
		get state() {
			return {
				selection: { main: { from: caret, to: caret, head: caret, empty: true } },
				sliceDoc: (a, b) => doc.slice(a, b == null ? doc.length : b),
				doc: { toString: () => doc, length: doc.length },
			};
		},
		dispatch(tr) {
			dispatched.push(tr);
			if (tr.changes) {
				const { from, to, insert } = tr.changes;
				doc = doc.slice(0, from) + (insert || '') + doc.slice(to == null ? from : to);
			}
			if (tr.selection && typeof tr.selection.anchor === 'number') caret = tr.selection.anchor;
		},
	};

	let resolveAnswer;
	const answerPromise = new Promise(resolve => { resolveAnswer = resolve; });

	const syncCalls = [];
	const ctx = vm.createContext({
		document: dom.window.document,
		window: dom.window,
		Promise,
		console: { info() {}, warn() {}, error() {} },
		getCM() { return mockCM; },
		activeEditorForm() { return form; },
		cmSyncToTA() { syncCalls.push('sync'); },
		markEdited() { syncCalls.push('edited'); },
		scheduleSave() { syncCalls.push('scheduled'); },
		requestAskCompletion(question, context, profileId) {
			ctx._lastAskCall = { question, context, profileId };
			return answerPromise;
		},
	});
	vm.runInContext(extractFn('_formNoteId'), ctx);
	vm.runInContext(extractFn('handleAskInCM'), ctx);

	return {
		ctx,
		form,
		getDoc: () => doc,
		resolveAnswer: () => resolveAnswer(resolvedAnswer),
		resolveEmpty: () => resolveAnswer(''),
		switchNote: () => form.setAttribute('hx-put', '/fragments/editor/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'),
		syncCalls,
	};
}

test('handleAskInCM: inserts placeholder immediately, then answer on resolve', async () => {
	const h = makeCMHandlerCtx({ docText: '/ask what is 2 plus 2?' });
	const { ctx } = h;
	const line = { text: '/ask what is 2 plus 2?', from: 0, to: 22 };

	ctx.handleAskInCM(ctx.getCM(), line, 'what is 2 plus 2?');
	assert.equal(h.getDoc(), '\u23f3 Asking\u2026', 'placeholder should replace the /ask line');

	h.resolveAnswer();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(h.getDoc(), 'The answer.', 'answer should replace the placeholder');
	assert.ok(h.syncCalls.includes('sync'));
	assert.ok(h.syncCalls.includes('scheduled'));
});

test('handleAskInCM: restores original line when answer is empty', async () => {
	const h = makeCMHandlerCtx({ docText: '/ask what is 2 plus 2?' });
	const { ctx } = h;
	const line = { text: '/ask what is 2 plus 2?', from: 0, to: 22 };

	ctx.handleAskInCM(ctx.getCM(), line, 'what is 2 plus 2?');
	h.resolveEmpty();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(h.getDoc(), '/ask what is 2 plus 2?', 'original line should be restored on empty answer');
});

test('handleAskInCM: drops result if the note changed before the response arrived', async () => {
	const h = makeCMHandlerCtx({ docText: '/ask what is 2 plus 2?' });
	const { ctx } = h;
	const line = { text: '/ask what is 2 plus 2?', from: 0, to: 22 };

	ctx.handleAskInCM(ctx.getCM(), line, 'what is 2 plus 2?');
	assert.equal(h.getDoc(), '\u23f3 Asking\u2026');

	h.switchNote();
	h.resolveAnswer();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();

	// Placeholder remains untouched because the identity guard dropped the result.
	assert.equal(h.getDoc(), '\u23f3 Asking\u2026', 'result must not be written after note switch');
});

test('handleAskInCM: passes text before the /ask line as context', () => {
	const context = 'Some earlier note text.\n';
	const askLine = '/ask what is 2 plus 2?';
	const h = makeCMHandlerCtx({ docText: context + askLine });
	const { ctx } = h;
	const line = { text: askLine, from: context.length, to: context.length + askLine.length };

	ctx.handleAskInCM(ctx.getCM(), line, 'what is 2 plus 2?');
	assert.equal(ctx._lastAskCall.context, context);
	assert.equal(ctx._lastAskCall.question, 'what is 2 plus 2?');
});

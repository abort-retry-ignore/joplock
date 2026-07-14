const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { editorFragment } = require('../app/templates');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

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

function plainCalls(ctx) {
	return JSON.parse(JSON.stringify(ctx._calls || []));
}

function makeCtxWithToolbar() {
	const html = editorFragment(
		{ id: 'n1', title: 'Active', body: 'Body', parentId: 'f1', deletedTime: 0, createdTime: 1000, updatedTime: 2000 },
		[{ id: 'f1', title: 'Folder 1' }],
	);
	const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, { url: 'https://joplock.test' });
	const ctx = vm.createContext({
		window: dom.window,
		document: dom.window.document,
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
		function openUploadModal(){_calls.push(['openUploadModal'])}
		function openHistoryModal(id){_calls.push(['openHistoryModal',id])}
		function toggleExportMenu(){_calls.push(['toggleExportMenu'])}
	`, ctx);
	[
		'_isMarkdownModeActive',
		'_runMarkdownToolbarFormat',
		'_runMarkdownToolbarBlock',
		'tinyMCEFormat',
		'tinyMCEFormatBlock',
		'tinyMCEInsertCheckbox',
		'tinyMCEInsertDate',
		'tinyMCEInsertDateTime',
	].forEach((fn) => vm.runInContext(extractFn(fn), ctx));
	return ctx;
}

function clickToolbarButtonByTitle(ctx, title) {
	const escaped = JSON.stringify(title);
	const code = `
		(function(){
			var all=document.querySelectorAll('#editor-toolbar button[title]');
			var btn=null;
			for(var i=0;i<all.length;i++){
				if(all[i].getAttribute('title')===${escaped}){btn=all[i];break;}
			}
			if(!btn)throw new Error('button not found: '+${escaped});
			var onclick=btn.getAttribute('onclick');
			if(!onclick)throw new Error('onclick missing for: '+${escaped});
			return onclick;
		})();
	`;
	const onclick = vm.runInContext(code, ctx);
	vm.runInContext(onclick, ctx);
}

test('markdown toolbar click path: every toolbar button dispatches expected markdown action', () => {
	const ctx = makeCtxWithToolbar();
	const cases = [
		['Bold (Ctrl+B)', ['wrapSel', '**', '**']],
		['Italic (Ctrl+I)', ['wrapSel', '*', '*']],
		['Underline', ['wrapSel', '++', '++']],
		['Strikethrough', ['wrapSel', '~~', '~~']],
		['Heading 1', ['insertPfx', '# ']],
		['Heading 2', ['insertPfx', '## ']],
		['Heading 3', ['insertPfx', '### ']],
		['Bullet list', ['insertPfx', '- ']],
		['Numbered list', ['insertPfx', '1. ']],
		['Checkbox', ['insertPfx', '- [ ] ']],
		['Inline code', ['wrapSel', '`', '`']],
		['Code block', ['openCodeModal']],
		['Quote', ['insertPfx', '> ']],
		['Horizontal rule', ['insertTxt', '\n---\n']],
		['Insert date', ['insertStamp', 'date']],
		['Insert date and time', ['insertStamp', 'datetime']],
		['Clear formatting', ['clearFormat']],
		['Link', ['insertLink']],
		['Image', ['insertImg']],
		['Upload file', ['openUploadModal']],
		['Note history', ['openHistoryModal', 'n1']],
		['Export note', ['toggleExportMenu']],
	];

	const buttonCount = vm.runInContext("document.querySelectorAll('#editor-toolbar button[title]').length", ctx);
	assert.equal(buttonCount, cases.length, 'test matrix must cover every toolbar button with a title');

	for (const [title, expectedCall] of cases) {
		vm.runInContext('_calls=[]', ctx);
		clickToolbarButtonByTitle(ctx, title);
		assert.deepEqual(plainCalls(ctx), [expectedCall], `toolbar click mismatch for: ${title}`);
	}
});

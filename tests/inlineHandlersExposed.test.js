// Inline handlers in the server templates (onclick="foo()", hx-on:..., etc.) only see what
// public/app.js assigns to `window`: its functions are not globals. A handler that names a
// function nobody exposes is a runtime "x is not defined" that no unit test of the function
// itself can catch (it happened with toggleFolderSort). This test reads every inline handler
// the templates emit and checks each function it calls is exposed or defined on the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const templateFiles = fs.readdirSync(path.join(root, 'app/templates')).filter(f => f.endsWith('.js')).map(f => `app/templates/${f}`);
const appSrc = read('public/app.js');

// names that are never page-level functions of ours
const IGNORE = new Set([
	'if', 'for', 'while', 'switch', 'function', 'return', 'typeof', 'new', 'catch', 'void',
	'confirm', 'alert', 'prompt', 'setTimeout', 'clearTimeout', 'setInterval', 'fetch', 'encodeURIComponent', 'decodeURIComponent',
	'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Date', 'Math', 'RegExp', 'Event', 'URL',
	'JSON.stringify',
]);

// handler attribute values: onclick="...", onchange="...", onsubmit="..." ... (double-quoted; the
// templates escape inner quotes) and hx-on:... attributes
const handlerValues = src => {
	const out = [];
	const re = /\b(on[a-z]+|hx-on(?::|::)[a-z-]+)=("([^"]*)"|'([^']*)')/g;
	let m;
	while ((m = re.exec(src))) out.push({ attr: m[1], value: m[3] !== undefined ? m[3] : m[4] });
	return out;
};

const calledFunctions = code => {
	// strip server-side `${...}` interpolations (they run in Node, not in the browser) and
	// string literals (names inside them are not calls)
	const stripped = code
		.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
		.replace(/\$\{/g, '').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/&quot;[^&]*&quot;/g, '');
	const names = new Set();
	const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
	let m;
	while ((m = re.exec(stripped))) names.add(m[2]);
	return [...names].filter(n => !IGNORE.has(n));
};

const exposed = name => new RegExp(`window\\.${name.replace(/\$/g, '\\$')}\\s*=`).test(appSrc);
// functions defined by the page's own inline <script> blocks in the templates
const definedInTemplates = name => templateFiles.some(f => new RegExp(`function\\s+${name}\\s*\\(|window\\.${name}\\s*=|\\b${name}\\s*=\\s*function`).test(read(f)));

test('every function an inline template handler calls is exposed on window (or defined by a page script)', () => {
	const missing = new Map();
	for (const file of templateFiles) {
		for (const { attr, value } of handlerValues(read(file))) {
			for (const fn of calledFunctions(value)) {
				if (exposed(fn) || definedInTemplates(fn)) continue;
				if (!missing.has(fn)) missing.set(fn, []);
				missing.get(fn).push(`${file} ${attr}`);
			}
		}
	}
	assert.deepEqual([...missing.entries()].map(([fn, where]) => `${fn}  <-  ${[...new Set(where)].slice(0, 3).join(', ')}`), [],
		'inline handlers call functions that are not assigned to window (add `window.name=name;` in public/app.js)');
});

test('the guard itself works: it would flag an unexposed function', () => {
	assert.deepEqual(calledFunctions("toggleFolderSort();event.stopPropagation()"), ['toggleFolderSort']);
	assert.deepEqual(calledFunctions("this.closest('x');document.getElementById('a').focus()"), []);
	assert.deepEqual(calledFunctions("go(${escapeHtml(JSON.stringify(id))},event)"), ['go'], 'server-side interpolation is not a browser call');
	assert.ok(!exposed('definitelyNotAFunction'));
	assert.ok(exposed('toggleNavFolder'));
});

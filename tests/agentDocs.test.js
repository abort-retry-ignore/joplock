'use strict';

// The agent docs are only useful while they are small and true. AGENTS.md is loaded on every task,
// so it has a size budget; the topic files in docs/agents/ are read on demand, so each must be
// linked from AGENTS.md; and any file, function or npm script a doc names must still exist (a stale
// reference actively misleads an agent, which is worse than no doc).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const agents = read('AGENTS.md');
const topicDir = path.join(root, 'docs', 'agents');
const topics = fs.readdirSync(topicDir).filter(f => f.endsWith('.md')).sort();
const docs = { 'AGENTS.md': agents, ...Object.fromEntries(topics.map(f => [`docs/agents/${f}`, read(`docs/agents/${f}`)])) };

const ROOTS = '(?:app|public|tests|playwright-tests|integration-tests|scripts|docs|cm-build|hljs-build|prism-build)';

const globToRegExp = glob => new RegExp(`^${glob.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
const exists = rel => {
	if (!rel.includes('*')) return fs.existsSync(path.join(root, rel));
	const dir = path.join(root, path.dirname(rel));
	return fs.existsSync(dir) && fs.readdirSync(dir).some(name => globToRegExp(path.basename(rel)).test(name));
};

test('AGENTS.md is small enough to load on every task', () => {
	const lines = agents.split('\n').length;
	assert.ok(lines <= 130, `AGENTS.md is ${lines} lines (budget 130): move detail into docs/agents/`);
	assert.ok(agents.length <= 14000, `AGENTS.md is ${agents.length} chars (budget 14000)`);
});

test('no topic file grows into the next monolith', () => {
	for (const f of topics) assert.ok(docs[`docs/agents/${f}`].length <= 24000, `docs/agents/${f} is over 24000 chars: split it`);
});

test('every topic file is linked from AGENTS.md, and every docs/agents link resolves', () => {
	for (const f of topics) assert.ok(agents.includes(`docs/agents/${f}`), `docs/agents/${f} is not linked from AGENTS.md`);
	for (const [name, text] of Object.entries(docs)) {
		for (const [, link] of text.matchAll(/docs\/agents\/([\w-]+\.md)/g)) assert.ok(topics.includes(link), `${name} links to docs/agents/${link}, which does not exist`);
	}
});

test('every topic file says when to read it', () => {
	for (const f of topics) {
		const text = docs[`docs/agents/${f}`];
		assert.match(text, /^# .+\n\n> Read this before: /, `docs/agents/${f} must start with a title and a "Read this before" line`);
	}
});

test('every repo path a doc names exists', () => {
	const missing = [];
	for (const [name, text] of Object.entries(docs)) {
		for (const [, token] of text.matchAll(/`([^`\n]+)`/g)) {
			const m = new RegExp(`^(${ROOTS}/[\\w./@*\\-]+?)(?::\\d+)?$`).exec(token.trim());
			if (m && !exists(m[1])) missing.push(`${name}: ${token}`);
		}
	}
	assert.deepEqual(missing, []);
});

test('every npm script a doc names exists', () => {
	const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
	const missing = [];
	for (const [name, text] of Object.entries(docs)) {
		for (const [, script] of text.matchAll(/npm run ([\w:-]+)/g)) if (!scripts.includes(script)) missing.push(`${name}: npm run ${script}`);
	}
	assert.deepEqual(missing, []);
});

// Source files to look identifiers up in (not the docs themselves, not vendored bundles)
const sourceText = (() => {
	const out = [];
	const walk = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (['node_modules', 'tinymce', 'plans', 'graft', 'test-results', 'playwright-report', 'data', 'vendor'].includes(entry.name) || entry.name.startsWith('.')) continue;
				walk(full);
			} else if (/\.(js|mjs|json|css|html)$/.test(entry.name) && !/\.min\.js$/.test(entry.name) && !['html-docx.js'].includes(entry.name)) {
				out.push(fs.readFileSync(full, 'utf8'));
			}
		}
	};
	for (const dir of ['app', 'public', 'tests', 'playwright-tests', 'integration-tests', 'scripts']) walk(path.join(root, dir));
	out.push(read('server.js'), read('package.json'));
	return out.join('\n');
})();

// Names that are other people's APIs (TinyMCE, CodeMirror, htmx, the browser, Postgres, Node), not ours.
const EXTERNAL = new Set([
	'fetch', 'require', 'handle', 'alert', 'confirm', 'getContent', 'setContent', 'insertContent', 'execCommand', 'mceCodeSample',
	'convert_from', 'toString', 'focus', 'blur', 'dispatch', 'setSelection', 'scrollIntoView', 'getSelection', 'getBoundingClientRect',
	'posAtDOM', 'posAtCoords', 'requestMeasure', 'getNode', 'elementFromPoint', 'scrollTo', 'matchMedia', 'getComputedStyle',
	'addEventListener', 'setDeviceMetricsOverride', 'setViewportSize', 'setOffline', 'newCDPSession', 'newContext', 'toBeVisible',
	'dragstart', 'dragenter', 'dragover', 'dragleave', 'getElementById', 'querySelector', 'querySelectorAll', 'getAttribute',
	'pg_dump', 'pg_restore', 'CREATE', 'renderMarkdown', 'markdown', 'htmlToMarkdown',
	'flankingWhitespace', // Turndown internal (vendored public/turndown.min.js)
]);

test('every function a doc names still exists somewhere in the source', () => {
	const missing = [];
	for (const [name, text] of Object.entries(docs)) {
		for (const [, token] of text.matchAll(/`([A-Za-z_$][\w$.]*)\([^`\n]*\)`/g)) {
			const fn = token.split('.').pop();
			if (EXTERNAL.has(fn) || fn.length < 4) continue;
			if (!new RegExp(`\\b${fn.replace(/\$/g, '\\$')}\\b`).test(sourceText)) missing.push(`${name}: ${fn}()`);
		}
	}
	assert.deepEqual([...new Set(missing)], []);
});

test('source files that point at a topic doc point at one that exists', () => {
	const bad = [];
	const scan = rel => {
		for (const f of fs.readdirSync(path.join(root, rel))) {
			if (!/\.js$/.test(f) || /\.min\.js$/.test(f)) continue;
			const text = read(`${rel}/${f}`);
			for (const [, link] of text.matchAll(/docs\/agents\/([\w-]+\.md)/g)) if (!topics.includes(link)) bad.push(`${rel}/${f}: ${link}`);
		}
	};
	['app', 'app/items', 'app/routes', 'app/proxy', 'app/templates', 'public'].forEach(scan);
	assert.deepEqual(bad, []);
});

test('nothing still points at the removed AGENT_GUIDE.md', () => {
	const hits = [];
	for (const [name, text] of Object.entries({ ...docs, 'README.md': read('README.md') })) if (text.includes('AGENT_GUIDE')) hits.push(name);
	for (const rel of ['public/app.js', 'public/service-worker.js', 'server.js']) if (read(rel).includes('AGENT_GUIDE')) hits.push(rel);
	assert.deepEqual(hits, []);
});

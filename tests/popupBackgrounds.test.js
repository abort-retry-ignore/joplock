// Popups that float over other content must be opaque. The folder context menu used
// `background: var(--bg-elevated)`, which is a ~2% white tint in most themes, so the sidebar
// and editor showed straight through it. Guard both halves: the menu must sit on a solid
// colour, and every theme must define that colour as solid.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

const block = selector => {
	const start = css.indexOf(`\n${selector} {`);
	assert.ok(start !== -1, `${selector} rule not found`);
	return css.slice(start, css.indexOf('}', start));
};

// a value that cannot be see-through: #rgb / #rrggbb / rgb() / hsl() without alpha
const isOpaque = value => {
	const v = value.trim().toLowerCase();
	if (/^#[0-9a-f]{3}$/.test(v) || /^#[0-9a-f]{6}$/.test(v)) return true;
	if (/^(rgb|hsl)\(/.test(v) && !/[/,]\s*(0?\.\d+|0)\s*\)$/.test(v) && !/\//.test(v)) return v.split(',').length <= 3;
	return false;
};

test('the folder context menu sits on a solid colour, with the theme tint only layered on top', () => {
	const rule = block('.folder-context-menu');
	assert.match(rule, /background-color:\s*var\(--bg-side\)/, 'solid base colour');
	assert.match(rule, /background-image:\s*linear-gradient\(var\(--bg-elevated\),\s*var\(--bg-elevated\)\)/, 'tint layered over it');
	assert.doesNotMatch(rule, /background:\s*var\(--bg-elevated\)/, 'must not be the bare translucent variable');
});

test('every theme defines --bg-side as a solid colour (so the menu can never become see-through)', () => {
	const themes = [...css.matchAll(/^\.(theme-[a-z0-9-]+)[^{]*\{([^}]*)\}/gm)];
	assert.ok(themes.length >= 20, `expected the theme blocks, found ${themes.length}`);
	const offenders = [];
	let checked = 0;
	for (const [, name, body] of themes) {
		const m = /--bg-side:\s*([^;]+);/.exec(body);
		if (!m) continue;
		checked++;
		if (!isOpaque(m[1])) offenders.push(`${name}: ${m[1].trim()}`);
	}
	assert.ok(checked >= 20, `only ${checked} themes define --bg-side`);
	assert.deepEqual(offenders, []);
});

test('the opacity check itself rejects translucent values', () => {
	for (const bad of ['rgba(255,255,255,0.02)', '#ffffff80', 'transparent', 'rgb(0 0 0 / 50%)', 'hsla(0,0%,0%,0.5)']) assert.equal(isOpaque(bad), false, bad);
	for (const good of ['#0d140d', '#fff', 'rgb(10, 20, 30)', 'hsl(10, 20%, 30%)']) assert.equal(isOpaque(good), true, good);
});

// ── the menu must also stay on screen ──
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const extractFn = name => {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, name);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error(name);
};
const place = ({ w, h, vw, vh, x, y }) => {
	const dom = new JSDOM('<body><div id="m"></div></body>');
	const menu = dom.window.document.getElementById('m');
	Object.defineProperty(menu, 'offsetWidth', { value: w });
	Object.defineProperty(menu, 'offsetHeight', { value: h });
	const ctx = vm.createContext({ window: { innerWidth: vw, innerHeight: vh }, document: dom.window.document });
	vm.runInContext(extractFn('positionFolderContextMenu'), ctx);
	vm.runInContext('positionFolderContextMenu', ctx)(menu, x, y);
	return { left: parseInt(menu.style.left, 10), top: parseInt(menu.style.top, 10) };
};

test('context menu: placed at the pointer when it fits', () => {
	assert.deepEqual(place({ w: 180, h: 220, vw: 1200, vh: 800, x: 300, y: 200 }), { left: 300, top: 200 });
});

test('context menu: shifted up and left so none of it falls off the bottom / right edge', () => {
	const near = place({ w: 180, h: 220, vw: 1200, vh: 800, x: 1190, y: 790 });
	assert.equal(near.left + 180 + 8, 1200, 'right edge');
	assert.equal(near.top + 220 + 8, 800, 'bottom edge: Share / Delete stay clickable');
});

test('context menu: never above or left of the viewport, even in a tiny window', () => {
	const tiny = place({ w: 180, h: 500, vw: 300, vh: 300, x: 250, y: 250 });
	assert.ok(tiny.top >= 8 && tiny.left >= 8, JSON.stringify(tiny));
});

test('context menu: scrolls instead of overflowing when taller than the window', () => {
	const rule = block('.folder-context-menu');
	assert.match(rule, /max-height:\s*calc\(100vh - 16px\)/);
	assert.match(rule, /overflow-y:\s*auto/);
});

test('openFolderContextMenu positions the menu through the clamp (after the items are final)', () => {
	const src = extractFn('openFolderContextMenu');
	const hidden = src.indexOf('menu.hidden=false');
	const sync = src.indexOf('_syncFolderMenuPin(');
	const place = src.indexOf('positionFolderContextMenu(menu');
	assert.ok(hidden !== -1 && sync > hidden && place > sync, 'un-hide, finalise the items, then position');
	assert.ok(!/menu\.style\.left=\(event\.clientX/.test(src), 'no raw pointer coordinates any more');
});

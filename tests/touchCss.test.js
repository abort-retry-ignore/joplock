'use strict';

// iOS emulates :hover on tap and leaves it stuck until the next tap elsewhere, so a tapped
// toolbar button or list row stayed highlighted. Pure visual hover feedback lives inside
// @media (hover: hover). Reveal-on-hover affordances (a selector list that also names a
// focus/active/class state) have their own touch fallbacks and are exempt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

// every rule with its selector list and the at-rules around it
function rules(source) {
	const out = [];
	const stack = [];
	let buf = 0;
	for (const m of source.matchAll(/[{}]/g)) {
		if (m[0] === '{') {
			const selector = source.slice(buf, m.index).replace(/\/\*[\s\S]*?\*\//g, '').trim();
			stack.push(selector);
			buf = m.index + 1;
		} else {
			const selector = stack.pop();
			if (!selector.startsWith('@')) out.push({ selector, atRules: stack.filter(s => s.startsWith('@')) });
			buf = m.index + 1;
		}
	}
	return out;
}

const all = rules(css);
const pureHover = all.filter(r => r.selector.includes(':hover') && r.selector.split(',').every(part => part.includes(':hover')));

test('every pure :hover rule is inside @media (hover: hover)', () => {
	assert.ok(pureHover.length >= 38, `expected the wrapped hover rules, found ${pureHover.length}`);
	const ungated = pureHover.filter(r => !r.atRules.some(a => /\(hover:\s*hover\)/.test(a)));
	assert.deepEqual(ungated.map(r => r.selector), [], 'a bare :hover rule sticks on iOS after a tap: wrap it in @media (hover: hover)');
});

test('reveal-on-hover rules that mix in another state are left alone (they have touch fallbacks)', () => {
	const reveal = all.find(r => r.selector.includes('.cm-jl-img:hover .cm-jl-img-handle'));
	assert.ok(reveal, 'the image handle reveal rule still exists');
	assert.equal(reveal.atRules.length, 0);
	assert.match(css, /@media \(hover: none\) \{ \.cm-host \.cm-jl-img-handle/);
});

test('the touch block turns off double-tap zoom, callouts and tap flashes on controls, but not on text', () => {
	const touch = all.filter(r => r.atRules.some(a => /hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/.test(a)));
	const decls = selectorPart => touch.filter(r => r.selector.includes(selectorPart));
	assert.ok(decls('.mobile-note-row').length > 0);
	const manip = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
	assert.match(manip, /touch-action: manipulation;/);
	assert.match(manip, /-webkit-touch-callout: none;/);
	const textRule = touch.find(r => r.selector.includes('.cm-content'));
	assert.ok(textRule, 'selection stays on for fields and the editor');
	assert.ok(!touch.some(r => /^\s*(html|body)\b/.test(r.selector) && /user-select/.test(r.selector)));
});

test('reduced motion stops transitions and animations except the loading ring', () => {
	const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
	assert.match(block, /transition-duration: 0\.01ms !important/);
	assert.match(block, /\*:not\(\.note-loading-ring\)\s*\{\s*animation: none !important/);
});

test('zoom is allowed everywhere and interactive-widget is set, from one shared meta', () => {
	const templates = require('../app/templates');
	const { viewportMeta } = require('../app/templates/shared');
	assert.match(viewportMeta, /viewport-fit=cover/);
	assert.match(viewportMeta, /interactive-widget=resizes-content/);
	assert.doesNotMatch(viewportMeta, /user-scalable|maximum-scale/);
	const user = { id: 'u', email: 'a@b.c' };
	const pages = [
		templates.layoutPage({ user: null }),
		templates.layoutPage({ user, navContent: '', editorContent: '', settings: {} }),
		templates.diagPage({}),
		templates.settingsPage({ user, settings: {} }),
	];
	for (const html of pages) assert.ok(html.includes(`<meta name="viewport" content="${viewportMeta}" />`));
	// and the diagnostics page can still reproduce the old blocked-zoom meta for comparison
	assert.match(templates.diagPage({ query: new URLSearchParams('zoom=0') }), /user-scalable=no/);
});

'use strict';

// A phone in landscape is 812-956px wide, past the 768px breakpoint, so it used to get the desktop
// layout (sidebar and all) in about 390px of height, and rotating reloaded the page. The mobile
// shell now also covers any touch device whose PHYSICAL screen has a short side <= 500px. It must
// not use the window height: a soft keyboard shrinks the window (on iOS home-screen apps innerHeight
// shrinks with it), which would flip an iPad to the phone layout while typing.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

function extractFn(name) {
	const start = appSrc.indexOf(`function ${name}(`);
	assert.ok(start !== -1, `function ${name} not found in app.js`);
	let depth = 0;
	for (let i = start; i < appSrc.length; i++) {
		if (appSrc[i] === '{') depth++;
		else if (appSrc[i] === '}') { depth--; if (depth === 0) return appSrc.slice(start, i + 1); }
	}
	throw new Error(`no closing brace for ${name}`);
}

const constantLine = name => {
	const m = new RegExp(`var ${name}=[^;]+;`).exec(appSrc);
	assert.ok(m, `${name} not found`);
	return m[0];
};

// innerWidth/innerHeight are the window (keyboard changes them); screen is the physical display
function shell({ uiMode = 'auto', innerWidth, innerHeight = 800, screen: [sw, sh], coarse }) {
	const ctx = vm.createContext({
		_uiMode: uiMode,
		viewportWidth: () => innerWidth,
		viewportHeight: () => innerHeight, // available, but the decision must not use it
		innerHeight,
		window: { matchMedia: q => ({ matches: q === '(pointer: coarse)' ? coarse : false }), screen: { width: sw, height: sh } },
	});
	vm.runInContext(`${constantLine('_mobileShellMaxWidth')} ${constantLine('_phoneScreenMaxShortSide')} ${extractFn('_isPhoneScreen')} ${extractFn('_computeMobileShell')} var result=_computeMobileShell();`, ctx);
	return ctx.result;
}

test('phones keep the mobile shell in both orientations', () => {
	// iPhone Air home-screen app: screen reports 375x812 and does not rotate on iOS
	assert.equal(shell({ innerWidth: 375, screen: [375, 812], coarse: true }), true, 'portrait');
	assert.equal(shell({ innerWidth: 812, screen: [375, 812], coarse: true }), true, 'landscape');
	// Pixel 7: screen rotates on Android
	assert.equal(shell({ innerWidth: 412, screen: [412, 915], coarse: true }), true);
	assert.equal(shell({ innerWidth: 915, screen: [915, 412], coarse: true }), true);
	// largest phones
	assert.equal(shell({ innerWidth: 956, screen: [956, 440], coarse: true }), true);
});

test('tablets keep the desktop shell in every orientation, whatever the keyboard does to the window', () => {
	assert.equal(shell({ innerWidth: 820, screen: [820, 1180], coarse: true }), false, 'iPad Air portrait');
	assert.equal(shell({ innerWidth: 1180, screen: [820, 1180], coarse: true }), false, 'iPad Air landscape');
	// the keyboard shrinks the window, not the screen: a window-height test would have got these wrong
	assert.equal(shell({ innerWidth: 1180, innerHeight: 400, screen: [820, 1180], coarse: true }), false, 'iPad landscape, keyboard up (innerHeight ~400)');
	assert.equal(shell({ innerWidth: 1180, innerHeight: 120, screen: [820, 1180], coarse: true }), false, 'even a nearly flat window');
	assert.equal(shell({ innerWidth: 744, screen: [744, 1133], coarse: true }), true, 'a narrow iPad mini window <= 768 is mobile, as before');
});

test('mouse-driven windows only use the width rule', () => {
	assert.equal(shell({ innerWidth: 700, screen: [1920, 1080], coarse: false }), true, 'narrow desktop window');
	assert.equal(shell({ innerWidth: 900, screen: [1920, 1080], coarse: false }), false);
	assert.equal(shell({ innerWidth: 900, screen: [412, 915], coarse: false }), false, 'a phone-sized screen without a touch pointer (e.g. DevTools mouse) is not a phone');
});

test('the uiMode setting still wins', () => {
	assert.equal(shell({ uiMode: 'desktop', innerWidth: 375, screen: [375, 812], coarse: true }), false);
	assert.equal(shell({ uiMode: 'mobile', innerWidth: 1600, screen: [1920, 1080], coarse: false }), true);
});

test('all four mobile-shell media blocks use the same phone query, in step with app.js', () => {
	const phoneQuery = '@media (max-width: 768px), (pointer: coarse) and (max-device-width: 500px), (pointer: coarse) and (max-device-height: 500px) {';
	assert.equal(css.split(phoneQuery).length - 1, 4, 'the four former max-width: 768px blocks');
	assert.equal(css.includes('@media (max-width: 768px) {'), false, 'no block may keep the width-only query');
	assert.match(constantLine('_phoneScreenMaxShortSide'), /=500;/);
	assert.match(constantLine('_mobileShellMaxWidth'), /=768;/);
});

test('the phone query never looks at the window height (the keyboard changes that)', () => {
	const phoneQuery = css.match(/@media \(max-width: 768px\), [^{]+\{/)[0];
	assert.doesNotMatch(phoneQuery, /(?<!device-)(max|min)-height/);
});

test('the mobile shell keeps clear of landscape display cutouts', () => {
	assert.match(css, /\.mobile-app \{[^}]*inset: 0 env\(safe-area-inset-right, 0px\) 0 env\(safe-area-inset-left, 0px\);/);
	assert.match(css, /body\.force-mobile \.mobile-app \{[^}]*inset: 0 env\(safe-area-inset-right, 0px\) 0 env\(safe-area-inset-left, 0px\);/);
	assert.match(css, /\.mobile-fab \{[^}]*right: calc\(20px \+ env\(safe-area-inset-right, 0px\)\);/);
	assert.match(css, /\.mobile-fab-menu \{[^}]*right: calc\(20px \+ env\(safe-area-inset-right, 0px\)\);/);
	assert.match(css, /\.mobile-ctx-sheet \{[^}]*padding: 8px env\(safe-area-inset-right, 0px\) calc\(16px \+ env\(safe-area-inset-bottom, 0px\)\) env\(safe-area-inset-left, 0px\);/);
});

test('short windows tighten the shell chrome, and landscape typing hides only the editor title bar', () => {
	const short = css.slice(css.indexOf('@media (max-height: 500px) {'));
	assert.match(short, /\.mobile-header \{\s*height: calc\(36px/);
	assert.match(short, /\.mobile-app \.editor-toolbar \.tb \{[^}]*height: 34px/);
	assert.match(css, /@media \(max-height: 500px\) and \(orientation: landscape\) \{\s*html\[data-keyboard\] #mobile-editor-header \{\s*display: none;/);
	// the search header holds a text field: it must never be hidden while typing
	assert.doesNotMatch(css, /data-keyboard\][^{]*mobile-editor-search-header[^{]*\{\s*display: none/);
});

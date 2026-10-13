'use strict';

// public/viewport.js decides whether a soft keyboard is up. The numbers below are real readings
// from an iPhone Air home-screen app (/diag reports), plus the cases that must NOT count.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { keyboardVisible, isTypingElement, shouldPin } = require('../public/viewport.js');

const base = { coarse: true, typing: true, wasVisible: false, apiHeight: 0, vvScale: 1, remembered: 0 };

test('iPhone Air home-screen app: keyboard up is detected although innerHeight shrinks too', () => {
	// portrait, keyboard up: visual viewport 409, innerHeight 483 (or 409), large viewport 812
	assert.equal(keyboardVisible({ ...base, vvHeight: 409, inner: 483, large: 812 }), true);
	assert.equal(keyboardVisible({ ...base, vvHeight: 409, inner: 409, large: 812 }), true);
	// the old guess (innerHeight - vv.height < 80) called both of these "keyboard gone"
	assert.ok(483 - 409 < 80 && 409 - 409 < 80);
});

test('iPhone Air home-screen app: no keyboard when the viewport is full', () => {
	assert.equal(keyboardVisible({ ...base, vvHeight: 751, inner: 751, large: 812 }), false);
	// a field still focused with a hardware keyboard / after Done: viewport is full, so no
	assert.equal(keyboardVisible({ ...base, typing: true, vvHeight: 751, inner: 751, large: 812 }), false);
});

test('landscape keyboard (viewport 99 of 375) is detected', () => {
	assert.equal(keyboardVisible({ ...base, vvHeight: 99, inner: 208, large: 375 }), true);
	assert.equal(keyboardVisible({ ...base, vvHeight: 375, inner: 375, large: 375 }), false);
});

test('browser chrome alone is not a keyboard', () => {
	// Safari tab: toolbars take ~90px of ~850
	assert.equal(keyboardVisible({ ...base, vvHeight: 760, inner: 760, large: 852 }), false);
});

test('pinch zoom is not a keyboard', () => {
	assert.equal(keyboardVisible({ ...base, vvHeight: 409, inner: 751, large: 812, vvScale: 1.6 }), false);
});

test('needs a touch device and a typing element (or an already-up keyboard)', () => {
	assert.equal(keyboardVisible({ ...base, coarse: false, vvHeight: 409, inner: 751, large: 812 }), false);
	assert.equal(keyboardVisible({ ...base, typing: false, vvHeight: 409, inner: 751, large: 812 }), false);
});

test('an up keyboard stays up while the viewport is still shrunk, and ends when it is back', () => {
	// focus moved to a toolbar button: nothing typing, viewport still 409
	assert.equal(keyboardVisible({ ...base, typing: false, wasVisible: true, vvHeight: 409, inner: 751, large: 812 }), true);
	// dismissed: viewport is back
	assert.equal(keyboardVisible({ ...base, typing: false, wasVisible: true, vvHeight: 751, inner: 751, large: 812 }), false);
});

test('the VirtualKeyboard API wins when it reports a height', () => {
	assert.equal(keyboardVisible({ ...base, apiHeight: 300, vvHeight: 700, inner: 751, large: 812 }), true);
});

test('a remembered unobstructed height counts when the large viewport is the shrunk one', () => {
	assert.equal(keyboardVisible({ ...base, vvHeight: 380, inner: 380, large: 380, remembered: 800 }), true);
});

test('typing elements: text fields, textareas, contenteditable and TinyMCE iframes', () => {
	assert.equal(isTypingElement({ tagName: 'TEXTAREA' }), true);
	assert.equal(isTypingElement({ tagName: 'IFRAME' }), true);
	assert.equal(isTypingElement({ tagName: 'INPUT', type: 'text' }), true);
	assert.equal(isTypingElement({ tagName: 'INPUT', type: 'search' }), true);
	assert.equal(isTypingElement({ tagName: 'DIV', isContentEditable: true }), true);
	assert.equal(isTypingElement({ tagName: 'INPUT', type: 'checkbox' }), false);
	assert.equal(isTypingElement({ tagName: 'BUTTON' }), false);
	assert.equal(isTypingElement(null), false);
});

test('the stylesheet only changes .mobile-app while data-keyboard is set', () => {
	const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
	assert.match(css, /html\[data-keyboard\] \.mobile-app/);
	assert.match(css, /height: var\(--app-height\)/);
	assert.match(css, /top: var\(--app-top, 0px\)/);
});

test('the page scroll is pinned only in the mobile shell, and never while pinch-zoomed', () => {
	const scrolled = { shellShowing: true, scale: 1, scrollX: 0, scrollY: 268 };
	assert.equal(shouldPin(scrolled), true);
	assert.equal(shouldPin({ ...scrolled, scrollY: 0 }), false, 'nothing to put back');
	assert.equal(shouldPin({ ...scrolled, shellShowing: false }), false, 'desktop shell / other pages scroll normally');
	assert.equal(shouldPin({ ...scrolled, scale: 1.8 }), false, 'a zoomed page pans by scrolling: do not fight it');
	assert.equal(shouldPin({ ...scrolled, scrollY: 0, scrollX: 40 }), true);
});

/*
 * Joplock viewport sync: keeps the mobile shell on the part of the screen that is actually visible.
 *
 * Why: when a soft keyboard opens, iOS shrinks the visual viewport and then SCROLLS THE DOCUMENT to
 * bring the caret into view (measured on an iPhone Air home-screen app: scrollY 268-342px, with
 * body{position:fixed}). Everything pinned to the top of the shell, the header and the markdown
 * toolbar, goes off the top of the screen. Chrome on Android instead overlays the keyboard on a
 * layout viewport that did not change. The cure (the one herdr-web-ui ships) is to size the shell
 * to the visual viewport while the keyboard is up, keep it at the top of what is visible, and pin
 * the page scroll at 0, so there is nothing for the browser to scroll into view.
 *
 * What it does, only on a touch device (pointer: coarse):
 *  - html[data-keyboard] while a soft keyboard is up, plus --app-height / --app-top (px) that
 *    styles.css applies to .mobile-app only in that state; outside it nothing changes.
 *  - while the mobile shell is showing (and the user has not pinch-zoomed), any document scroll is
 *    put back to (0, 0).
 *  - fires "joplock:viewport" on document when the keyboard state or geometry changes.
 *
 * Never guess a keyboard from innerHeight - visualViewport.height: an iOS home-screen app shrinks
 * innerHeight together with the visual viewport, so an open keyboard looks closed (that guess hid
 * the markdown toolbar). Occlusion is measured against the largest height seen without a keyboard.
 *
 * Debug: with the admin debug flag on, state changes are posted to /api/web/client-log as
 * "viewport.kb" (read them with scripts/diag-reports.js --event viewport.kb). A real device can
 * switch the whole thing off with localStorage['joplock-viewport'] = 'off'.
 *
 * Pure helpers are exported for node tests (module.exports), like cm-extras.js.
 * Why this exists and how it is verified: docs/agents/pwa-mobile.md ("Soft keyboard / viewport").
 */
(function (root) {
	'use strict';

	// How much of the unobstructed height must be gone before we call it a keyboard. A phone
	// keyboard takes 35-45%; browser chrome and status bars take well under 15%.
	var OCCLUSION = 0.2;

	var TEXT_INPUT_BLOCKED = /^(button|checkbox|radio|range|submit|reset|file|color|image)$/;

	// An element whose focus raises the soft keyboard. TinyMCE edits inside an iframe, so the
	// document's activeElement is the IFRAME while it has focus.
	function isTypingElement(el) {
		if (!el) return false;
		var tag = el.tagName;
		if (tag === 'TEXTAREA' || tag === 'IFRAME') return true;
		if (tag === 'INPUT') return !TEXT_INPUT_BLOCKED.test(el.type || 'text');
		return el.isContentEditable === true;
	}

	/**
	 * s: { coarse, typing, wasVisible, apiHeight, vvHeight, vvScale, large, inner, remembered }
	 * wasVisible keeps the state up while the visual viewport is still shrunk after focus moved
	 * to a toolbar button (a tap there can blur the editor while the keyboard stays), and through
	 * the dismiss animation; it ends when the viewport comes back.
	 */
	function keyboardVisible(s) {
		if (!s.coarse) return false;
		if (s.apiHeight > 0) return true;
		if (!(s.typing || s.wasVisible)) return false;
		// pinch zoom shrinks the visual viewport with no keyboard
		if (Math.abs((s.vvScale || 1) - 1) > 0.01) return false;
		var reference = Math.max(s.large || 0, s.remembered || 0, s.inner || 0);
		return reference > 0 && reference - s.vvHeight > reference * OCCLUSION;
	}

	/**
	 * Whether a document scroll should be put back at (0,0): only while the mobile shell is showing
	 * (nothing in it scrolls the document) and never while the user has pinch-zoomed, when panning
	 * the zoomed page legitimately moves the scroll position.
	 */
	function shouldPin(s) {
		if (!s.shellShowing) return false;
		if (Math.abs((s.scale || 1) - 1) > 0.01) return false;
		return !!(s.scrollX || s.scrollY);
	}

	var pure = { OCCLUSION: OCCLUSION, isTypingElement: isTypingElement, keyboardVisible: keyboardVisible, shouldPin: shouldPin };
	if (typeof module !== 'undefined' && module.exports) module.exports = pure;
	if (typeof window === 'undefined' || typeof document === 'undefined') return;

	var doc = document;
	var html = doc.documentElement;
	var vv = window.visualViewport;
	var api = { pure: pure, enabled: false };
	root.JoplockViewport = api;

	try { if (window.localStorage.getItem('joplock-viewport') === 'off') return; } catch (e) { /* storage blocked */ }
	if (!vv) return;
	api.enabled = true;

	var coarse = window.matchMedia('(pointer: coarse)');
	var keyboard = navigator.virtualKeyboard;
	var visible = false;
	var remembered = {};      // unobstructed height seen per window width (portrait/landscape)
	var lastKey = '';
	var pins = 0;             // corrective scrolls: how often the browser scrolled the page under us
	var maxScroll = 0;        // largest scroll offset the browser applied before we put it back
	var settleTimer = null;

	// the large viewport: what the screen would be with the browser chrome retracted. The probe is
	// created once <body> exists (this script loads in <head>).
	var probe = null;
	function largeHeight() {
		if (!probe && doc.body) {
			probe = doc.createElement('div');
			probe.setAttribute('aria-hidden', 'true');
			probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none;contain:strict';
			doc.body.appendChild(probe);
		}
		return probe ? probe.getBoundingClientRect().height : 0;
	}

	function shellShowing() {
		return !!(doc.body && (doc.body.classList.contains('mobile-shell-active') || doc.querySelector('[data-viewport-pin]')));
	}

	function sync() {
		var width = window.innerWidth;
		var height = vv.height;
		var large = largeHeight();
		var remember = remembered[width] || 0;
		var apiHeight = keyboard && keyboard.boundingRect ? keyboard.boundingRect.height : 0;
		var next = keyboardVisible({
			coarse: coarse.matches,
			typing: isTypingElement(doc.activeElement),
			wasVisible: visible,
			apiHeight: apiHeight,
			vvHeight: height,
			vvScale: vv.scale,
			large: large,
			inner: window.innerHeight,
			remembered: remember,
		});
		if (!next) remembered[width] = Math.max(remember, large, window.innerHeight, height);

		// iOS scrolls the document to reveal the caret. Nothing in the shell scrolls the document
		// (body is position:fixed), so put it back, whether or not we think a keyboard is up.
		var pinnedNow = false;
		if (shouldPin({ shellShowing: shellShowing(), scale: vv.scale, scrollX: window.scrollX, scrollY: window.scrollY })) {
			pins++;
			maxScroll = Math.max(maxScroll, Math.round(window.scrollY));
			window.scrollTo(0, 0);
			pinnedNow = true;
		}

		visible = next;
		if (visible) {
			// right after scrolling back, offsetTop has not settled: read it on the next frame
			var top = pinnedNow ? 0 : Math.round(vv.offsetTop);
			html.setAttribute('data-keyboard', '');
			html.style.setProperty('--app-height', Math.round(height) + 'px');
			html.style.setProperty('--app-top', top + 'px');
		} else {
			html.removeAttribute('data-keyboard');
			html.style.removeProperty('--app-height');
			html.style.removeProperty('--app-top');
		}
		if (pinnedNow) window.requestAnimationFrame(sync);

		var key = [visible, Math.round(height), Math.round(vv.offsetTop)].join('|');
		if (key !== lastKey) {
			lastKey = key;
			try { doc.dispatchEvent(new CustomEvent('joplock:viewport', { detail: { keyboard: visible, height: Math.round(height), top: Math.round(vv.offsetTop) } })); } catch (e) { /* old engine */ }
		}
		scheduleReport();
	}

	// ---- debug reporting (admin debug flag only) --------------------------------------------

	var reports = 0;
	var lastReport = '';
	function debugOn() { return !!(root._joplockConfig && root._joplockConfig.debug); }
	function rectTop(selector) {
		var el = doc.querySelector(selector);
		if (!el) return -9999;
		var r = el.getBoundingClientRect();
		return r.width && r.height ? Math.round(r.top) : -9999;
	}
	function appBottom() {
		var app = doc.getElementById('mobile-app');
		return app && app.offsetWidth ? Math.round(app.getBoundingClientRect().bottom) : -9999;
	}
	function scheduleReport() {
		if (!debugOn() || reports >= 150) return;
		if (settleTimer) clearTimeout(settleTimer);
		settleTimer = setTimeout(report, 700); // after iOS has finished panning
	}
	function report() {
		settleTimer = null;
		if (!debugOn()) return;
		var toolbar = doc.querySelector('#mobile-editor-body #editor-toolbar');
		var data = {
			kb: visible,
			vvH: Math.round(vv.height), vvTop: Math.round(vv.offsetTop), vvScale: Math.round(vv.scale * 100) / 100,
			innerH: window.innerHeight, lvh: Math.round(largeHeight()),
			scrollY: Math.round(window.scrollY), pins: pins, maxScr: maxScroll,
			appH: (html.style.getPropertyValue('--app-height') || 'none'), appTop: (html.style.getPropertyValue('--app-top') || 'none'),
			// where the pieces are on screen: negative = scrolled off the top, -9999 = not shown
			hdrTop: rectTop('.mobile-screen-active .mobile-header'),
			tbTop: rectTop('#mobile-editor-body #editor-toolbar'),
			tbDisplay: toolbar ? (toolbar.style.display || 'css') : 'none',
			appBottom: appBottom(),
			focus: doc.activeElement ? doc.activeElement.tagName : 'none',
			standalone: !!(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true),
		};
		var key = JSON.stringify(data);
		if (key === lastReport) return;
		lastReport = key;
		reports++;
		try {
			window.fetch('/api/web/client-log', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: 'event=' + encodeURIComponent('viewport.kb') + '&data=' + encodeURIComponent(JSON.stringify(data)),
			}).catch(function () { /* logging only */ });
		} catch (e) { /* logging only */ }
	}

	// ---- wiring ----------------------------------------------------------------------------

	vv.addEventListener('resize', sync);
	vv.addEventListener('scroll', sync);
	window.addEventListener('scroll', sync, { passive: true });
	window.addEventListener('resize', sync);
	window.addEventListener('orientationchange', sync);
	if (coarse.addEventListener) coarse.addEventListener('change', sync);
	if (keyboard && keyboard.addEventListener) keyboard.addEventListener('geometrychange', sync);
	doc.addEventListener('focusin', sync);
	// focus moving field to field blurs first: look again once it has landed
	doc.addEventListener('focusout', function () { setTimeout(sync, 0); });
	doc.addEventListener('selectionchange', function () { if (visible) scheduleReport(); });
	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', sync);
	api.sync = sync;
	api.state = function () { return { keyboard: visible, pins: pins, maxScroll: maxScroll }; };
	sync();
})(typeof window !== 'undefined' ? window : this);

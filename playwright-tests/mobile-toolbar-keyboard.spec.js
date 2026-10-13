'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { ensureMobileFoldersScreen, login, openMobileFolder } = require('./helpers');

// In markdown mode the mobile formatting toolbar (B I U S H3 ...) is shown when a note opens and
// must stay while the soft keyboard is up. It used to disappear the moment a line was tapped:
// the viewport handler decided "keyboard gone" when innerHeight - visualViewport.height < 80,
// and iOS home-screen apps shrink innerHeight together with the visual viewport, so an open
// keyboard looked closed. Chromium reproduces that by shrinking the window, which resizes both.
// Read-only: opens a note and focuses the editor, types nothing.

test.describe('Mobile markdown toolbar and the keyboard', () => {
	test('the toolbar stays visible when the keyboard opens and closes', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		await login(page);
		await ensureMobileFoldersScreen(page);
		await openMobileFolder(page, 'All Notes');
		await page.locator('#mobile-notes-body .mobile-note-row').first().click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();

		const content = page.locator('#mobile-editor-body #cm-host .cm-content');
		const toolbar = page.locator('#mobile-editor-body #editor-toolbar');
		// the editor mounts a moment after the screen switches; a note that opens rendered has no #cm-host
		const markdown = await content.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
		test.skip(!markdown, 'note opened in rendered mode, not markdown');
		await expect(toolbar).toBeVisible();

		const size = page.viewportSize();
		await content.click();
		// the keyboard: both innerHeight and the visual viewport shrink, as in an iOS home-screen app
		await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) });
		await page.waitForTimeout(700);
		await expect(toolbar, 'toolbar while the keyboard is up').toBeVisible();
		expect(await toolbar.evaluate(el => getComputedStyle(el).display)).not.toBe('none');

		await page.setViewportSize(size);
		await page.waitForTimeout(700);
		await expect(toolbar, 'toolbar after the keyboard closes').toBeVisible();
	});
	test('the shell follows the visible area while the keyboard is up, and the header and toolbar stay on screen', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		await login(page);
		await ensureMobileFoldersScreen(page);
		await openMobileFolder(page, 'All Notes');
		await page.locator('#mobile-notes-body .mobile-note-row').first().click();
		const content = page.locator('#mobile-editor-body #cm-host .cm-content');
		const markdown = await content.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
		test.skip(!markdown, 'note opened in rendered mode, not markdown');

		const geometry = () => page.evaluate(() => {
			const r = sel => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
			return {
				kb: document.documentElement.hasAttribute('data-keyboard'),
				appHeightVar: document.documentElement.style.getPropertyValue('--app-height'),
				vv: Math.round(window.visualViewport.height),
				app: r('#mobile-app'), header: r('.mobile-screen-active .mobile-header'), toolbar: r('#mobile-editor-body #editor-toolbar'),
			};
		});

		const before = await geometry();
		expect(before.kb).toBe(false);
		expect(before.appHeightVar).toBe('');

		const size = page.viewportSize();
		await content.click();
		await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) });
		await expect.poll(async () => (await geometry()).kb, { message: 'keyboard detected', timeout: 5000 }).toBe(true);
		const up = await geometry();
		expect(up.appHeightVar).toBe(`${up.vv}px`);
		expect(up.app.top).toBe(0);
		expect(up.app.bottom).toBe(up.vv);
		expect(up.header.top).toBe(0);
		expect(up.toolbar.top).toBeGreaterThanOrEqual(0);
		expect(up.toolbar.bottom).toBeLessThanOrEqual(up.vv);

		// keyboard dismissed: blur and restore the window; the shell goes back to inset:0
		await page.evaluate(() => document.activeElement && document.activeElement.blur());
		await page.setViewportSize(size);
		await expect.poll(async () => (await geometry()).kb, { message: 'keyboard gone', timeout: 5000 }).toBe(false);
		const down = await geometry();
		expect(down.appHeightVar).toBe('');
		expect(down.app.bottom).toBe(size.height);
	});

	test('viewport.js puts the page scroll back at 0 when the browser scrolls it (what iOS does for a caret under the keyboard)', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		await page.setContent('<!doctype html><html><body style="margin:0"><div data-viewport-pin style="height:3000px">tall page</div><input id="f"></body></html>');
		await page.addScriptTag({ path: path.join(__dirname, '..', 'public', 'viewport.js') });
		expect(await page.evaluate(() => window.JoplockViewport.enabled)).toBe(true);
		await page.evaluate(() => window.scrollTo(0, 340));
		await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'scroll pinned back to 0' }).toBe(0);
		const state = await page.evaluate(() => window.JoplockViewport.state());
		expect(state.pins).toBeGreaterThanOrEqual(1);
		expect(state.maxScroll).toBeGreaterThanOrEqual(300);
	});

	test('the localStorage kill switch turns viewport.js off', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		await page.goto('/login');
		await page.evaluate(() => localStorage.setItem('joplock-viewport', 'off'));
		await page.setContent('<!doctype html><html><body><div data-viewport-pin style="height:3000px"></div></body></html>');
		await page.addScriptTag({ path: path.join(__dirname, '..', 'public', 'viewport.js') });
		expect(await page.evaluate(() => window.JoplockViewport.enabled)).toBe(false);
		await page.evaluate(() => localStorage.removeItem('joplock-viewport'));
	});
});

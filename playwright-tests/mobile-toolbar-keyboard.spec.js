'use strict';

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
});

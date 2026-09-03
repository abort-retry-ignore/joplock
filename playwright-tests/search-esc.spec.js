'use strict';

/**
 * E2E: two-stage Escape for search.
 *
 * 1st Esc  -> exit the in-note search (dismiss the find-nav bar, strip marks),
 *             leaving the note-list search results intact.
 * 2nd Esc  -> exit the note-listing search results and clear the search field.
 */
const { test, expect } = require('@playwright/test');
const {
	login,
	createNotebook,
	deleteNotebook,
	createDesktopNote,
	setNoteTitle,
	waitForSaved,
	acceptDialogs,
	hasAdminCredentials,
	slug,
} = require('./helpers');

test.describe('two-stage Escape for search', () => {
	test.skip(!hasAdminCredentials(), 'requires admin credentials');
	// Desktop-shell flow: drives #nav-search and the desktop notelist. In the
	// mobile shell those live in a hidden drawer / different screen, so the
	// mobile project can't run these steps (mobile search is covered by
	// mobile-shell.spec.js instead).

	test('first Esc exits in-note search, second Esc clears the note list search', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'mobile', 'desktop-shell flow');
		test.setTimeout(90000);
		acceptDialogs(page);
		await login(page);

		const notebook = slug('esc-nb');
		const term = `zqe${Date.now().toString(36)}mk`;
		const noteTitle = slug('Esc-note');

		await createNotebook(page, notebook);
		try {
			await createDesktopNote(page, notebook);
			await setNoteTitle(page, noteTitle);

			await page.waitForFunction(() => !!(window.tinymce && window.tinymce.activeEditor && window.tinymce.activeEditor.initialized), null, { timeout: 15000 });
			const editArea = page.locator('#tinymce-host iframe').contentFrame().locator('body#tinymce');
			await expect(editArea).toBeVisible({ timeout: 15000 });
			await editArea.click();
			await page.keyboard.type(`Body with ${term} and again ${term} here.`);
			await waitForSaved(page);
			await expect(editArea).toContainText(term, { timeout: 15000 });

			// Reload so the note is cleanly searchable from the server.
			await page.goto('/');
			await expect(page.locator('body.app-shell')).toBeVisible();

			// Search, then open the matching result to enter in-note find.
			const nav = page.locator('#nav-search');
			await nav.fill(term);
			await nav.press('Enter');
			const results = page.locator('[data-folder-id="__search_results__"] .notelist-item');
			await expect(results.first()).toBeVisible({ timeout: 15000 });
			await results.first().click();

			// In-note find is active: marks + find-nav bar visible.
			const markCount = async () => page.evaluate(() => {
				const ed = window.tinymce && window.tinymce.activeEditor;
				return ed && ed.getBody ? ed.getBody().querySelectorAll('mark.search-highlight').length : -1;
			});
			await expect.poll(markCount, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
			const navBar = page.locator('#editor-panel #search-nav-bar');
			await expect(navBar).toBeVisible();

			// --- 1st Esc: exit in-note search only ---
			await page.keyboard.press('Escape');
			await expect(navBar).toBeHidden();
			await expect.poll(markCount, { timeout: 5000 }).toBe(0);
			// Note-list search results and the search field must remain.
			await expect(page.locator('[data-folder-id="__search_results__"]')).toBeVisible();
			await expect(nav).toHaveValue(term);

			// --- 2nd Esc: exit the note-list search results + clear the field ---
			await page.keyboard.press('Escape');
			await expect(nav).toHaveValue('');
			await expect(page.locator('[data-folder-id="__search_results__"]')).toHaveCount(0, { timeout: 10000 });
		} finally {
			await page.goto('/');
			await deleteNotebook(page, notebook).catch(() => {});
		}
	});
});

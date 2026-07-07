'use strict';

/**
 * E2E: in-note find/highlight in rendered (TinyMCE) mode.
 *
 * Regression: after the TinyMCE migration, searching from the note list and
 * opening the matching note stopped highlighting the term in the body, because
 * applySearchHighlight() only handled the removed #note-preview contenteditable
 * and had no rendered-mode (TinyMCE iframe) branch. This drives the real desktop
 * flow — type in the nav search, open the matching result, and assert the term
 * is wrapped in <mark class="search-highlight"> inside the live TinyMCE iframe
 * with the find-nav bar showing a match count.
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

test.describe('rendered-mode in-note search highlight', () => {
	test.skip(!hasAdminCredentials(), 'requires admin credentials');

	test('search opens the note and highlights the term inside TinyMCE', async ({ page }) => {
		test.setTimeout(90000);
		acceptDialogs(page);
		await login(page);

		const notebook = slug('search-nb');
		// Unique token so this run's note is the only search hit.
		const term = `zqx${Date.now().toString(36)}mk`;
		const noteTitle = slug('Findable-note');

		await createNotebook(page, notebook);
		try {
			await createDesktopNote(page, notebook);
			await setNoteTitle(page, noteTitle);

			// The note opens in rendered (TinyMCE) mode by default. Type the body
			// directly into the persistent TinyMCE editor so it is real rendered
			// content. The persistent iframe lives under #tinymce-host (repositioned
			// over the editor slot), so drive/read it via the tinymce API to avoid
			// brittle iframe selectors across htmx swaps.
			await page.waitForFunction(() => !!(window.tinymce && window.tinymce.activeEditor && window.tinymce.activeEditor.initialized), null, { timeout: 15000 });
			const editArea = page.locator('#tinymce-host iframe').contentFrame().locator('body#tinymce');
			await expect(editArea).toBeVisible({ timeout: 15000 });
			await editArea.click();
			await page.keyboard.type(`This paragraph contains the ${term} token to find.`);
			await page.keyboard.press('Enter');
			await page.keyboard.type(`Another ${term} appears here too.`);
			await waitForSaved(page);
			await expect(editArea).toContainText(term, { timeout: 15000 });

			// Reload so the note exists cleanly server-side before searching — this
			// mirrors real usage (finding a term in a note that already exists) and
			// avoids the write→read propagation lag of a just-created note.
			await page.goto('/');
			await expect(page.locator('body.app-shell')).toBeVisible();

			// Search from the nav search box.
			const nav = page.locator('#nav-search');
			await nav.fill(term);
			await nav.press('Enter');
			const results = page.locator('[data-folder-id="__search_results__"] .notelist-item');
			await expect(results.first()).toBeVisible({ timeout: 15000 });

			// Open the matching result — this seeds the pending search term and
			// applySearchHighlight() runs after the editor settles.
			await results.first().click();

			// Rendered-mode highlight: the term must be wrapped in
			// mark.search-highlight inside the live TinyMCE body. Read via the
			// tinymce API (the persistent editor), which is what the app touches.
			const markCount = async () => page.evaluate(() => {
				const ed = window.tinymce && window.tinymce.activeEditor;
				if (!ed || !ed.getBody) return -1;
				return ed.getBody().querySelectorAll('mark.search-highlight').length;
			});
			await expect.poll(markCount, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
			const activeCount = async () => page.evaluate(() => {
				const ed = window.tinymce && window.tinymce.activeEditor;
				if (!ed || !ed.getBody) return -1;
				return ed.getBody().querySelectorAll('mark.search-highlight-active').length;
			});
			await expect.poll(activeCount, { timeout: 5000 }).toBeGreaterThanOrEqual(1);

			// The desktop find-nav bar shows the match counter.
			const navBar = page.locator('#editor-panel #search-nav-bar');
			await expect(navBar).toBeVisible({ timeout: 15000 });
			await expect(page.locator('#editor-panel #search-nav-counter')).toContainText('/');

			// Stepping keeps exactly one active highlight.
			await page.locator('#editor-panel #search-nav-bar .search-nav-btn').nth(1).click();
			await expect.poll(activeCount, { timeout: 5000 }).toBe(1);

			// Dismiss strips every mark (nothing leaks into the saved markdown).
			await page.locator('#editor-panel #search-nav-bar .search-nav-close').click();
			await expect(navBar).toBeHidden();
			await expect.poll(markCount, { timeout: 5000 }).toBe(0);
		} finally {
			await page.goto('/');
			await deleteNotebook(page, notebook).catch(() => {});
		}
	});
});

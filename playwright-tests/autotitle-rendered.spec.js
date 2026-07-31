'use strict';

// Regression test: auto-title must populate while typing in RENDER
// (TinyMCE) mode, not just markdown mode.
//
// Root cause history: commit ffb7bd0 ("Fix TinyMCE autosave sync +
// shell-mode readonly + FormatBlock partial split") optimised onEdit() to
// avoid a full HTML->markdown conversion on every keystroke (that
// conversion is now deferred to the debounced scheduleSave timer via
// _lazyTinyMCESyncBeforeSave()). The old onEdit() used to dispatch an
// 'input' event on the #note-body textarea on every change, which is what
// triggered autoTitle() (wired via `ta.addEventListener('input', autoTitle)`
// in initEditorPanel). Removing that per-edit textarea sync silently broke
// title auto-fill for rendered mode, since nothing else called autoTitle()
// for TinyMCE edits. Fixed by adding a cheap, DOM-only
// autoTitleFromTinyMCE() that reads just the first block's plain text
// (no full markdown conversion) and calling it directly from onEdit().

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs, login, logout, hasAdminCredentials,
	createNotebook, createDesktopNote, teardownTestData, waitForSaved,
} = require('./helpers');

test.describe('Auto-title in rendered (TinyMCE) mode', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('typing in a brand-new note (render mode) auto-fills the title', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials());

		const folder = `pw-autotitle-${Date.now()}`;
		try {
			await login(page);
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);

			// New notes open in rich/render mode by default on desktop.
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
			// TinyMCE has an 800ms post-load "quiet window" after content is set
			// during which onEdit() intentionally no-ops (absorbs mceFocus/
			// normalization noise). Wait past it so typing below reaches the
			// real onEdit path (markEdited/scheduleSave/autoTitleFromTinyMCE),
			// matching how a real user would interact (nobody starts typing
			// within 800ms of a note visually appearing).
			await page.waitForTimeout(1200);

			const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
			await iframeBody.click();
			await page.keyboard.type('My New Note Title Here');
			await page.waitForTimeout(1000);

			// Title should auto-populate immediately (does not require waiting
			// for the debounced save/hash cycle).
			await expect(page.locator('#editor-panel .editor-title-hidden')).toHaveValue('My New Note Title Here', { timeout: 5000 });

			// Typing more text on a NEW line must not change the already-set
			// title (only the first block is used, and _titleManual should not
			// be triggered by typing in TinyMCE body).
			await page.keyboard.press('Enter');
			await page.keyboard.type('second line, should not affect title');
			await page.waitForTimeout(500);
			await expect(page.locator('#editor-panel .editor-title-hidden')).toHaveValue('My New Note Title Here');

			// Confirm it actually saves with this title.
			await waitForSaved(page);
			const savedTitle = await page.locator('#editor-panel .editor-title-hidden').inputValue();
			expect(savedTitle).toBe('My New Note Title Here');
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});
});

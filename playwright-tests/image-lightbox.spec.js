'use strict';

// Desktop double-click on an image / viewable attachment opens the in-app
// lightbox overlay (#resource-viewer) instead of navigating away or opening a
// new tab. Covers the TinyMCE (rendered) editor path, which is the desktop
// "rendered mode". Also asserts Close button + Escape dismissal.

const path = require('path');
const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	hasAdminCredentials,
	login,
	logout,
	setNoteBody,
	setNoteTitle,
	teardownTestData,
	waitForSaved,
} = require('./helpers');

const TEST_IMAGE = path.resolve(__dirname, '..', 'public', 'icon-192.png');

// Upload TEST_IMAGE into the currently-open note (must be in rich/TinyMCE mode)
// via the upload modal, then return the 32-hex resource id parsed from the
// markdown body. Mirrors the flow used by resource-lifecycle.spec.js.
async function uploadImageAndGetResourceId(page) {
	await page.evaluate(() => window.openUploadModal());
	await expect(page.locator('#upload-modal')).toBeVisible({ timeout: 5000 });
	await page.locator('#upload-modal-file-input').setInputFiles(TEST_IMAGE);
	await expect(page.locator('#upload-insert-btn')).not.toBeDisabled({ timeout: 15000 });
	// On full upload success the modal auto-dismisses (and inserts). If it is
	// still open (e.g. it stayed for a partial batch), click Insert ourselves.
	if (await page.locator('#upload-modal').isVisible()) {
		await page.locator('#upload-insert-btn').click().catch(() => {});
	}
	await expect(page.locator('#upload-modal')).toBeHidden({ timeout: 10000 });

	// Force a save round-trip (TinyMCE -> markdown) so the body is populated.
	await page.waitForTimeout(2000);
	await page.locator('#editor-panel #markdown-toggle').click();
	await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
	const bodyText = await page.locator('#editor-panel #note-body').inputValue();
	const match = bodyText.match(/!\[[^\]]*\]\(:\/([0-9a-fA-F]{32})\)/);
	expect(match, 'Note body should contain an image reference ![...](:/<32-hex>)').toBeTruthy();
	// Back to rich mode for the double-click interaction.
	await page.locator('#editor-panel #preview-toggle').click();
	await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
	return match[1];
}

test.describe('Desktop image/attachment double-click lightbox', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('double-click an image in rendered mode opens the lightbox, Close and Esc dismiss it', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials(), 'Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD (or PLAYWRIGHT_ADMIN_*) for the image-lightbox test');

		const folder = `pw-lightbox-${Date.now()}`;
		const noteTitle = `Lightbox note ${Date.now()}`;

		try {
			await login(page);
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);
			await setNoteTitle(page, noteTitle);

			// Seed body in markdown mode, then switch to rich (TinyMCE) for upload.
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			await setNoteBody(page, 'Lightbox anchor text.');
			await waitForSaved(page);
			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });

			const resourceId = await uploadImageAndGetResourceId(page);

			// The image lives inside the TinyMCE iframe body.
			const frame = page.frameLocator('iframe.tox-edit-area__iframe');
			const img = frame.locator(`img[data-resource-id="${resourceId}"]`);
			await expect(img).toBeVisible({ timeout: 15000 });

			// No lightbox yet.
			await expect(page.locator('#resource-viewer')).toHaveCount(0);

			// Double-click the image -> in-app lightbox overlay appears in the top document.
			await img.dblclick();
			const viewer = page.locator('#resource-viewer');
			await expect(viewer).toBeVisible({ timeout: 10000 });
			// It shows the image (not the "cannot preview" message).
			await expect(viewer.locator('img.resource-viewer-img')).toBeVisible();
			await expect(viewer.locator('.resource-viewer-msg')).toHaveCount(0);

			// Close button dismisses it.
			await viewer.getByRole('button', { name: 'Close' }).click();
			await expect(page.locator('#resource-viewer')).toHaveCount(0);

			// Re-open and dismiss with Escape.
			await img.dblclick();
			await expect(page.locator('#resource-viewer')).toBeVisible({ timeout: 10000 });
			await page.keyboard.press('Escape');
			await expect(page.locator('#resource-viewer')).toHaveCount(0);
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});
});

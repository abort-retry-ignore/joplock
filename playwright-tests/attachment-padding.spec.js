'use strict';

// Verifies the blank-line padding around inserted attachments in rendered
// (TinyMCE) mode: two images dropped one after another must end up separated
// by a blank line in the saved markdown, so each stays individually deletable.
// Desktop-only. Exercises _uploadFileToTinyMCE / _tinyMCEBlockAttachmentHtml
// (the drag-drop path).

const path = require('path');
const fs = require('fs');
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
const IMG_B64 = fs.readFileSync(TEST_IMAGE).toString('base64');

// Drop an image file onto the TinyMCE iframe body (the drag-drop upload path).
async function dropImageOnTinyMCE(page, name) {
	await page.evaluate(async ({ name, data }) => {
		const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
		const file = new File([bytes], name, { type: 'image/png' });
		const dt = new DataTransfer();
		dt.items.add(file);
		const iframe = document.querySelector('iframe.tox-edit-area__iframe');
		const body = iframe.contentDocument.body;
		const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
		body.dispatchEvent(event);
	}, { name, data: IMG_B64 });
	await page.waitForTimeout(2500);
}

test.describe('Attachment blank-line padding (rendered mode)', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('two images dropped in rendered mode are separated by a blank line in markdown', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials(), 'Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD (or PLAYWRIGHT_ADMIN_*) for this test');

		const folder = `pw-padding-${Date.now()}`;
		const noteTitle = `Padding note ${Date.now()}`;

		try {
			await login(page);
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);
			await setNoteTitle(page, noteTitle);

			// Seed body, then switch to rich (TinyMCE) mode.
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			await setNoteBody(page, 'Intro text.');
			await waitForSaved(page);
			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });

			// Drop two images back to back.
			await dropImageOnTinyMCE(page, 'one.png');
			await dropImageOnTinyMCE(page, 'two.png');

			// Force a save round-trip and read the markdown body.
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
			await page.waitForTimeout(500);
			const body = await page.locator('#editor-panel #note-body').inputValue();

			// Two resource refs present.
			const refs = body.match(/!\[[^\]]*\]\(:\/[0-9a-fA-F]{32}\)/g) || [];
			expect(refs.length, `expected two image refs, body was:\n${body}`).toBeGreaterThanOrEqual(2);

			// A blank line (>=1 empty line == a deletable md-blank-line paragraph on
			// re-render) must separate the two images — they are not glued together.
			const between = body.slice(
				body.indexOf(refs[0]) + refs[0].length,
				body.lastIndexOf(refs[1]),
			);
			expect(/\n[ \t]*\n/.test(between), `images must be separated by a blank line, got between: ${JSON.stringify(between)}`).toBe(true);
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});
});

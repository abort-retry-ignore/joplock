'use strict';

// Regression: switching editor mode (rendered <-> markdown) must NOT mark an
// unchanged note as "Edited". The markdown<->HTML round-trip emits synthetic
// input events (and can be slightly lossy), which used to flip the save status
// to "Edited" even though the user changed nothing. A real edit made after the
// switch must still register. Desktop-only.

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

const FENCE = '```';
// A code block with a blank line round-trips slightly lossily through TinyMCE,
// which is exactly the case that produced the spurious "Edited".
const BODY = [
	`${FENCE}c`,
	'#include <stdio.h>',
	'',
	'int main() {',
	'    return 0;',
	'}',
	FENCE,
	'',
	'Some text after.',
].join('\n');

async function switchToMarkdown(page) {
	await page.locator('#editor-panel #markdown-toggle').click();
	await expect.poll(
		async () => page.locator('#editor-panel #note-editor-form').evaluate(f => f.dataset.editorMode || ''),
		{ timeout: 15000 },
	).toBe('markdown');
}

async function switchToRich(page) {
	await page.locator('#editor-panel #preview-toggle').click();
	await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });
}

test.describe('Mode switch does not mark note edited', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('rendered -> markdown on an unchanged note stays Saved; a later edit marks Edited', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials(), 'Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD (or PLAYWRIGHT_ADMIN_*) for this test');

		const folder = `pw-modeedit-${Date.now()}`;
		const status = page.locator('#editor-panel #autosave-status');

		try {
			await login(page);
			await createNotebook(page, folder);
			await createDesktopNote(page, folder);
			await setNoteTitle(page, `modeedit ${Date.now()}`);

			await switchToMarkdown(page);
			await setNoteBody(page, BODY);
			await waitForSaved(page);

			// markdown -> rendered, settle, ensure saved.
			await switchToRich(page);
			await page.waitForTimeout(1500);
			await waitForSaved(page).catch(() => {});

			// rendered -> markdown: must NOT flip to "Edited".
			await switchToMarkdown(page);
			await page.waitForTimeout(400); // allow the suppression window to clear
			await expect(status).toHaveText('Saved');

			// A genuine edit after the switch must still register as "Edited".
			await page.locator('#editor-panel .cm-content').click();
			await page.keyboard.type(' EDIT');
			await expect(status).toHaveText('Edited', { timeout: 5000 });
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});
});

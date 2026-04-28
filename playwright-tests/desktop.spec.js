'use strict';

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	openDesktopNote,
	openSettings,
	searchDesktop,
	setNoteBody,
	setNoteTitle,
	slug,
	waitForSaved,
} = require('./helpers');

test.describe('Desktop UI', () => {
	test('covers login, notebook and note flows, search, settings, history, and logout', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		const folderName = slug('pw-desktop-folder');
		const noteTitle = slug('pw desktop note');
		const noteBody = `${noteTitle}\n\nDesktop body update.`;

		await login(page);
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);

		await setNoteTitle(page, noteTitle);
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel #cm-host')).toBeVisible();
		await setNoteBody(page, noteBody);
		await waitForSaved(page);

		await expect(page.locator(`.nav-folder[data-folder-title="${folderName}"]`)).toBeVisible();

		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('#editor-panel #note-preview')).toBeVisible();
		await expect(page.locator('#editor-panel #note-preview')).toContainText('Desktop body update.');

		await page.locator('#editor-panel .tb[title="Note history"]').click();
		await expect(page.locator('#history-modal')).toBeVisible();
		await expect(page.locator('#history-modal-inner')).not.toContainText('Loading...', { timeout: 15000 });
		await page.getByRole('button', { name: 'Close' }).click();
		await expect(page.locator('#history-modal')).toBeHidden();

		await searchDesktop(page, noteTitle);
		await expect(page.getByRole('button', { name: noteTitle, exact: true })).toBeVisible();
		await expect(page.locator('.nav-folder-title', { hasText: 'Search Results' })).toBeVisible();
		await openDesktopNote(page, noteTitle);

		await openSettings(page);
		await page.locator('#settings-theme').selectOption('nord');
		await expect(page.locator('body')).toHaveClass(/theme-nord/);
		await page.locator('[data-tab="security"]').click();
		await expect(page.locator('#tab-security')).toHaveClass(/active/);
		await page.locator('#settings-confirm-trash').uncheck();
		await expect(page.locator('#settings-confirm-trash')).not.toBeChecked();
		await page.getByRole('link', { name: 'Back to notes' }).click();
		await page.waitForURL(/\/$/);

		await deleteNotebook(page, folderName);
		await logout(page);
	});
});

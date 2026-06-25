'use strict';

// Regression tests for Escape-key dismissal of modals.
// Each test opens a modal, presses Escape, and asserts the modal is hidden.
// Desktop-only: the reported bug is on the desktop shell.

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	setNoteBody,
	setNoteTitle,
	slug,
	trashDesktopNote,
	waitForSaved,
} = require('./helpers');

test.describe('Modal Escape dismissal', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('new-folder modal closes on Escape', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		await login(page);
		await page.locator('button[title="New notebook"]').click();
		await expect(page.locator('#new-folder-modal')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.locator('#new-folder-modal')).toBeHidden();
		await expect(page.locator('#new-folder-modal-backdrop')).toBeHidden();
		await logout(page);
	});

	test('history modal closes on Escape', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folder = slug('pw-esc-history-folder');
		const noteTitle = slug('pw esc history note');
		const body = 'history-escape-body';

		await login(page);
		await createNotebook(page, folder);
		await createDesktopNote(page, folder);
		await setNoteTitle(page, noteTitle);
		await setNoteBody(page, body);
		await waitForSaved(page);

		await page.locator('#editor-panel .tb[title="Note history"]').click();
		await expect(page.locator('#history-modal')).toBeVisible();
		await expect(page.locator('#history-modal-inner')).not.toContainText('Loading...', { timeout: 15000 });
		await page.keyboard.press('Escape');
		await expect(page.locator('#history-modal')).toBeHidden();
		await expect(page.locator('#history-modal-backdrop')).toBeHidden();

		await deleteNotebook(page, folder);
		await logout(page);
	});

	test('empty-trash modal closes on Escape', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		const folder = slug('pw-esc-trash-folder');
		const noteTitle = slug('pw esc trash note');

		await login(page);
		await createNotebook(page, folder);
		await createDesktopNote(page, folder);
		await setNoteTitle(page, noteTitle);
		await waitForSaved(page);
		await trashDesktopNote(page);

		const trashRow = page.locator('.nav-folder[data-folder-id="de1e7ede1e7ede1e7ede1e7ede1e7ede"] .nav-folder-row').first();
		await expect(trashRow.locator('.trash-folder-empty')).toBeVisible();
		await trashRow.locator('.trash-folder-empty').click();
		await expect(page.locator('#empty-trash-modal')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.locator('#empty-trash-modal')).toBeHidden();
		await expect(page.locator('#empty-trash-modal-backdrop')).toBeHidden();

		await deleteNotebook(page, folder);
		await logout(page);
	});
});
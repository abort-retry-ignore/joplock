'use strict';

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	login,
	logout,
	openMobileFolder,
	openMobileNote,
	openSettings,
	setNoteBody,
	setNoteTitle,
	slug,
	waitForSaved,
} = require('./helpers');

test.describe('Tablet and mobile shell UI', () => {
	test('covers mobile shell navigation, note creation, editor modes, search, settings, and logout', async ({ page }, testInfo) => {
		test.skip(!['tablet', 'mobile'].includes(testInfo.project.name));
		acceptDialogs(page);
		const projectName = testInfo.project.name;
		const noteBody = `${slug(`pw-${projectName}-note`)}\n\n${projectName} body update`;

		await login(page);
		await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
		await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });

		await openMobileFolder(page, 'All Notes');
		await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();

		await page.locator('#mobile-md-toggle').click();
		await expect(page.locator('#mobile-editor-body #cm-host')).toBeVisible();
		await setNoteBody(page, noteBody);
		await waitForSaved(page);

		await page.locator('#mobile-preview-toggle').click();
		await expect(page.locator('#mobile-editor-body #note-preview')).toBeVisible();
		await expect(page.locator('#mobile-editor-body #note-preview')).toContainText(`${projectName} body update`);

		await page.locator('#mobile-editor-back').click();
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await expect(page.locator('#mobile-notes-body')).toContainText('Untitled note');

		await page.locator('#mobile-notes-body .mobile-note-row').first().click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
		await page.locator('#mobile-editor-search-open').click();
		await expect(page.locator('#mobile-editor-search-header')).toBeVisible();
		await page.locator('#mobile-editor-search-input').fill(projectName);
		await expect(page.locator('#mobile-search-next-btn')).toBeVisible();
		await page.locator('#mobile-search-next-btn').click();
		await page.locator('#mobile-editor-search-header .mobile-back-btn').click();

		await page.locator('#mobile-editor-back').click();
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await page.locator('#mobile-notes-screen .mobile-back-btn').click();
		await expect(page.locator('#mobile-folders-screen.mobile-screen-active')).toBeVisible();

		await page.locator('#mobile-folders-header .mobile-header-btn[title="Search"]').click();
		await page.locator('#mobile-search-input').fill(projectName);
		await expect(page.locator('#mobile-folders-body')).toContainText(projectName, { timeout: 10000 });
		await page.locator('#mobile-folders-body .mobile-note-row', { hasText: projectName }).first().click();
		await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
		await expect(page.locator('#mobile-editor-body #note-preview')).toContainText(projectName);

		await openSettings(page);
		await page.locator('[data-tab="appearance"]').click();
		await page.locator('#settings-note-open-mode').selectOption('markdown');
		await expect(page.locator('#settings-note-open-mode')).toHaveValue('markdown');
		await page.getByRole('link', { name: 'Back to notes' }).click();
		await page.waitForURL(/\/$/);

		await logout(page);
	});
});

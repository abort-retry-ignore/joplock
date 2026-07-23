'use strict';

const { test: base, expect } = require('@playwright/test');
const {
	acceptDialogs,
	hasAdminCredentials,
	login,
	loginAs,
	createNotebook,
	openDesktopNote,
	shareNotebookWithEmail,
	closeShareDialog,
	teardownTestData,
	slug,
	verifyEditorReadOnly,
	verifyEditorEditable,
	toggleShareCanWrite,
	openShareModalForNotebook,
	ensureShareTestUsers,
	SHARE_READER_EMAIL,
	SHARE_READER_PASSWORD,
} = require('./helpers');

const test = base.extend({
	ownerPage: async ({ browser }, use) => { const page = await browser.newPage(); await use(page); await page.close(); },
	readerPage: async ({ browser }, use) => { const page = await browser.newPage(); await use(page); await page.close(); },
});

test.describe('share cross-account access', () => {

	test.beforeAll(async ({ browser }) => {
		if (!hasAdminCredentials()) return;
		const page = await browser.newPage();
		await login(page);
		await ensureShareTestUsers(page);
		await page.close();
	});

	test('shared folder visible to reader', async ({ ownerPage, readerPage }) => {
		if (!hasAdminCredentials()) test.skip();
		await acceptDialogs(ownerPage);
		await acceptDialogs(readerPage);

		const folder = slug('share-vis');
		await login(ownerPage);
		await createNotebook(ownerPage, folder);
		await shareNotebookWithEmail(ownerPage, folder, SHARE_READER_EMAIL);
		await closeShareDialog(ownerPage);

		await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible({ timeout: 15000 });
		await expect(readerPage.locator(`[data-folder-title="${folder}"] .nav-share-icon`)).toBeVisible();

		await readerPage.close();
		await teardownTestData(ownerPage, { folders: [folder] });
	});

	test('reader with can_write=false sees read-only editor', async ({ ownerPage, readerPage }) => {
		test.skip('flaky: + button editor timing');
		if (!hasAdminCredentials()) test.skip();
		await acceptDialogs(ownerPage);
		await acceptDialogs(readerPage);

		const folder = slug('share-ro');
		await login(ownerPage);
		await createNotebook(ownerPage, folder);
		const addBtn = ownerPage.locator(`.nav-folder[data-folder-title="${folder}"] .nav-folder-add`);
		await addBtn.click();
		await ownerPage.waitForTimeout(1000);
		await ownerPage.locator('#editor-panel #note-body').fill('readonly-body-' + Date.now());
		await ownerPage.waitForTimeout(2000);

		await shareNotebookWithEmail(ownerPage, folder, SHARE_READER_EMAIL);
		await openShareModalForNotebook(ownerPage, folder);
		await toggleShareCanWrite(ownerPage, SHARE_READER_EMAIL, false);
		await closeShareDialog(ownerPage);

		await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible({ timeout: 15000 });
		await readerPage.locator(`[data-folder-title="${folder}"] .nav-folder-title`).click();
		await readerPage.waitForTimeout(1000);

		await verifyEditorReadOnly(readerPage);

		await readerPage.close();
		await teardownTestData(ownerPage, { folders: [folder] });
	});
});

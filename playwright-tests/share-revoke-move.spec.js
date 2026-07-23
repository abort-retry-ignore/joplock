'use strict';

const { test: base, expect } = require('@playwright/test');
const {
	acceptDialogs,
	hasAdminCredentials,
	login,
	loginAs,
	createNotebook,
	shareNotebookWithEmail,
	leaveSharedNotebook,
	openShareModalForNotebook,
	removeShareUserFromModal,
	closeShareDialog,
	stopSharingNotebookFromModal,
	teardownTestData,
	slug,
	ensureShareTestUsers,
	SHARE_READER_EMAIL,
	SHARE_READER_PASSWORD,
} = require('./helpers');

const test = base.extend({
	ownerPage: async ({ browser }, use) => { const page = await browser.newPage(); await use(page); await page.close(); },
	readerPage: async ({ browser }, use) => { const page = await browser.newPage(); await use(page); await page.close(); },
});

test.describe('share revoke leave stop', () => {

	test.beforeAll(async ({ browser }) => {
		if (!hasAdminCredentials()) return;
		const page = await browser.newPage();
		await login(page);
		await ensureShareTestUsers(page);
		await page.close();
	});

	test('owner revokes access — reader loses folder', async ({ ownerPage, readerPage }) => {
		if (!hasAdminCredentials()) test.skip();
		await acceptDialogs(ownerPage);
		await acceptDialogs(readerPage);

		const folder = slug('share-rev');
		await login(ownerPage);
		await createNotebook(ownerPage, folder);
		await shareNotebookWithEmail(ownerPage, folder, SHARE_READER_EMAIL);
		await closeShareDialog(ownerPage);

		await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible({ timeout: 15000 });

		await openShareModalForNotebook(ownerPage, folder);
		await removeShareUserFromModal(ownerPage, SHARE_READER_EMAIL);
		await closeShareDialog(ownerPage);

		await readerPage.reload();
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).not.toBeVisible({ timeout: 10000 });
		await expect(ownerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible();

		await readerPage.close();
		await teardownTestData(ownerPage, { folders: [folder] });
	});

	test('reader leaves shared notebook — loses access', async ({ ownerPage, readerPage }) => {
		test.skip('flaky: login timeout on re-used context');
		if (!hasAdminCredentials()) test.skip();
		await acceptDialogs(ownerPage);

		const folder = slug('share-lv');
		await login(ownerPage);
		await createNotebook(ownerPage, folder);
		await shareNotebookWithEmail(ownerPage, folder, SHARE_READER_EMAIL);
		await closeShareDialog(ownerPage);

		await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible({ timeout: 15000 });

		await leaveSharedNotebook(readerPage, folder);
		await readerPage.reload();
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).not.toBeVisible({ timeout: 10000 });

		await readerPage.close();
		await teardownTestData(ownerPage, { folders: [folder] });
	});

	test('owner stop sharing — reader loses folder', async ({ ownerPage, readerPage }) => {
		if (!hasAdminCredentials()) test.skip();
		await acceptDialogs(ownerPage);
		await acceptDialogs(readerPage);

		const folder = slug('share-st');
		await login(ownerPage);
		await createNotebook(ownerPage, folder);
		await shareNotebookWithEmail(ownerPage, folder, SHARE_READER_EMAIL);
		await closeShareDialog(ownerPage);

		await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible({ timeout: 15000 });

		await openShareModalForNotebook(ownerPage, folder);
		await stopSharingNotebookFromModal(ownerPage);

		await readerPage.reload();
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).not.toBeVisible({ timeout: 10000 });
		await expect(ownerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible();

		await readerPage.close();
		await teardownTestData(ownerPage, { folders: [folder] });
	});

	test('reader cannot see owner controls in share dialog', async ({ ownerPage, readerPage }) => {
		if (!hasAdminCredentials()) test.skip();
		await acceptDialogs(ownerPage);
		await acceptDialogs(readerPage);

		const folder = slug('share-nc');
		await login(ownerPage);
		await createNotebook(ownerPage, folder);
		await shareNotebookWithEmail(ownerPage, folder, SHARE_READER_EMAIL);
		await closeShareDialog(ownerPage);

		await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);
		await expect(readerPage.locator(`[data-folder-title="${folder}"]`)).toBeVisible({ timeout: 15000 });
		await openShareModalForNotebook(readerPage, folder);

		await expect(readerPage.locator('#share-invite-email')).not.toBeVisible({ timeout: 5000 });
		await expect(readerPage.locator('#share-invite-btn')).not.toBeVisible({ timeout: 5000 });
		await expect(readerPage.locator('#share-stop-btn')).not.toBeVisible({ timeout: 5000 });
		await expect(readerPage.locator('#share-leave-btn')).toBeVisible();
		await expect(readerPage.locator('.share-can-write-cb')).not.toBeVisible({ timeout: 5000 });

		await closeShareDialog(readerPage);
		await readerPage.close();
		await teardownTestData(ownerPage, { folders: [folder] });
	});
});

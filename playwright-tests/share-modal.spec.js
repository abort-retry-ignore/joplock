'use strict';

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	hasAdminCredentials,
	login,
	createNotebook,
	teardownTestData,
	slug,
	ensureShareTestUsers,
	openShareModalForNotebook,
	closeShareDialog,
	shareNotebookWithEmail,
	removeShareUserFromModal,
	stopSharingNotebookFromModal,
	SHARE_READER_EMAIL,
} = require('./helpers');

test.describe('share modal', () => {
	test.beforeEach(async ({ page }) => {
		await acceptDialogs(page);
	});

	test.skip(({ isMobile }) => isMobile, 'desktop only (right-click context menu)');
	test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');

	test.beforeAll(async ({ browser }) => {
		if (!hasAdminCredentials()) return;
		const page = await browser.newPage();
		await login(page);
		await ensureShareTestUsers(page);
		await page.close();
	});

	test('right-click shared folder shows share modal with owner controls', async ({ page }) => {
		if (!hasAdminCredentials()) test.skip();
		await login(page);
		const folder = slug('share-dialog');
		await createNotebook(page, folder);

		await openShareModalForNotebook(page, folder);
		await expect(page.locator('#share-modal')).toBeVisible();
		await expect(page.locator('#share-modal-backdrop')).toBeVisible();
		await expect(page.locator('#share-invite-email')).toBeVisible();
		await expect(page.locator('#share-invite-btn')).toBeVisible();

		await closeShareDialog(page);
		await teardownTestData(page, { folders: [folder] });
	});

	test('escape key closes share modal', async ({ page }) => {
		if (!hasAdminCredentials()) test.skip();
		await login(page);
		const folder = slug('share-esc');
		await createNotebook(page, folder);

		await openShareModalForNotebook(page, folder);
		await expect(page.locator('#share-modal')).toBeVisible();
		await page.keyboard.press('Escape');

		await teardownTestData(page, { folders: [folder] });
	});

	test('empty email invite shows error', async ({ page }) => {
		if (!hasAdminCredentials()) test.skip();
		await login(page);
		const folder = slug('share-empty');
		await createNotebook(page, folder);

		await openShareModalForNotebook(page, folder);
		await page.locator('#share-invite-btn').click();
		await expect(page.locator('#share-invite-error')).toBeVisible();

		await closeShareDialog(page);
		await teardownTestData(page, { folders: [folder] });
	});

	test('invite reader user with can_write shows Has access', async ({ page }) => {
		if (!hasAdminCredentials()) test.skip();
		await login(page);
		const folder = slug('share-invite');
		await createNotebook(page, folder);

		await shareNotebookWithEmail(page, folder, SHARE_READER_EMAIL);
		const row = page.locator('.share-person-row', { has: page.locator('.share-person-email', { hasText: SHARE_READER_EMAIL }) });
		await expect(row.locator('.share-person-status')).toContainText('Has access');
		const cb = row.locator('.share-can-write-cb');
		await expect(cb).toBeChecked();

		await closeShareDialog(page);
		await page.goto('/');
		await page.waitForTimeout(500);
		await openShareModalForNotebook(page, folder);
		await stopSharingNotebookFromModal(page);
		await teardownTestData(page, { folders: [folder] });
	});

	test('owner removes user from share', async ({ page }) => {
		if (!hasAdminCredentials()) test.skip();
		await login(page);
		const folder = slug('share-remove');
		await createNotebook(page, folder);

		await shareNotebookWithEmail(page, folder, SHARE_READER_EMAIL);
		await removeShareUserFromModal(page, SHARE_READER_EMAIL);

		await expect(page.locator('.share-person-row')).not.toBeVisible({ timeout: 5000 });
		await closeShareDialog(page);
		await teardownTestData(page, { folders: [folder] });
	});

	test('stop sharing removes entire share', async ({ page }) => {
		if (!hasAdminCredentials()) test.skip();
		await login(page);
		const folder = slug('share-stop');
		await createNotebook(page, folder);

		await shareNotebookWithEmail(page, folder, SHARE_READER_EMAIL);
		await closeShareDialog(page);
		await openShareModalForNotebook(page, folder);
		await stopSharingNotebookFromModal(page);

		await teardownTestData(page, { folders: [folder] });
	});

	test('no page errors during share lifecycle', async ({ page }) => {
		test.skip('flaky due to stale modal');
		if (!hasAdminCredentials()) test.skip();
		const pageErrors = [];
		page.on('pageerror', e => pageErrors.push(e));
		await login(page);
		const folder = slug('share-clean');
		await createNotebook(page, folder);

		await openShareModalForNotebook(page, folder);
		await closeShareDialog(page);
		await openShareModalForNotebook(page, folder);
		await shareNotebookWithEmail(page, folder, SHARE_READER_EMAIL);
		await closeShareDialog(page);

		await expect(pageErrors.length).toBe(0);
		await teardownTestData(page, { folders: [folder] });
	});
});

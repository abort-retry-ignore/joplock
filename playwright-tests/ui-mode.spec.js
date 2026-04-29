'use strict';

const { test, expect } = require('@playwright/test');
const { login, logout, setUiMode, ensureMobileFoldersScreen } = require('./helpers');

test.describe('UI mode setting', () => {
	test.beforeEach(async ({}, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
	});

	test.afterEach(async ({ page }) => {
		try {
			await setUiMode(page, 'auto');
		} catch (e) { /* ignore */ }
	});

	test('auto on desktop viewport renders desktop shell', async ({ page }) => {
		await login(page);
		await setUiMode(page, 'auto');
		await page.goto('/');
		await expect(page.locator('body.app-shell')).toBeVisible();
		await expect(page.locator('#mobile-app')).toHaveAttribute('aria-hidden', 'true');
		await expect(page.locator('.app')).toBeVisible();
		await logout(page);
	});

	test('force mobile renders mobile shell on desktop viewport with clickable notebooks', async ({ page }) => {
		await login(page);
		await setUiMode(page, 'mobile');
		await page.goto('/');
		await expect(page.locator('body.force-mobile')).toBeVisible();
		await expect(page.locator('#mobile-app')).toBeVisible();
		await ensureMobileFoldersScreen(page);
		await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
		const row = page.locator('#mobile-folders-body .mobile-folder-row', { hasText: 'All Notes' }).first();
		await expect(row).toBeVisible();
		await row.click();
		await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
		await expect(page.locator('#mobile-notes-title')).toContainText('All Notes');
		await setUiMode(page, 'auto');
		await logout(page);
	});

	test('force desktop renders desktop shell at mobile viewport', async ({ page }) => {
		await login(page);
		await setUiMode(page, 'desktop');
		await page.setViewportSize({ width: 500, height: 900 });
		await page.goto('/');
		await expect(page.locator('body.force-desktop')).toBeVisible();
		await expect(page.locator('.app')).toBeVisible();
		await expect(page.locator('#mobile-app')).toBeHidden();
		await setUiMode(page, 'auto');
		await logout(page);
	});
});

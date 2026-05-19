'use strict';

const { test, expect } = require('@playwright/test');
const { openSettings } = require('./helpers');

const ADMIN_EMAIL = process.env.PLAYWRIGHT_ADMIN_EMAIL || process.env.PLAYWRIGHT_EMAIL || '';
const ADMIN_PASSWORD = process.env.PLAYWRIGHT_ADMIN_PASSWORD || process.env.PLAYWRIGHT_PASSWORD || '';

const loginAsAdmin = async page => {
	await page.goto('/login');
	await expect(page.getByRole('heading', { name: 'Joplock' })).toBeVisible();
	await page.getByPlaceholder('Email').fill(ADMIN_EMAIL);
	await page.locator('#login-password').fill(ADMIN_PASSWORD);
	await page.getByRole('button', { name: 'Login' }).click();
	await page.waitForURL(/\/$/);
	await expect(page.locator('body.app-shell')).toBeVisible();
};

const saveAuthRateLimit = async (page, value) => {
	await page.locator('[data-tab="admin"]').click();
	await expect(page.locator('#tab-admin')).toHaveClass(/active/);
	const input = page.locator('input[name="authRateLimitAttempts"]');
	await expect(input).toBeVisible();
	await input.fill(`${value}`);
	await Promise.all([
		page.waitForURL(/\/settings\?saved=1&tab=admin/),
		page.getByRole('button', { name: 'Save security settings' }).click(),
	]);
	await expect(page.locator('.settings-flash.settings-flash-ok')).toContainText('Settings saved.');
	await expect(input).toHaveValue(`${value}`);
};

const submitBadLogin = async (page, email, password) => {
	const responsePromise = page.waitForResponse(response => {
		const url = new URL(response.url());
		return url.pathname === '/login' && response.request().method() === 'POST';
	});
	await page.getByPlaceholder('Email').fill(email);
	await page.locator('#login-password').fill(password);
	await page.getByRole('button', { name: 'Login' }).click();
	return responsePromise;
};

test.describe('Auth rate limit UI', () => {
	test('admin-configured limit blocks repeated bad logins and can be restored', async ({ page, browser }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'Set PLAYWRIGHT_ADMIN_EMAIL and PLAYWRIGHT_ADMIN_PASSWORD for admin UI tests.');

		await loginAsAdmin(page);
		await openSettings(page);

		const limitInput = page.locator('input[name="authRateLimitAttempts"]');
		await page.locator('[data-tab="admin"]').click();
		await expect(page.locator('#tab-admin')).toHaveClass(/active/);
		await expect(limitInput).toBeVisible();
		const originalLimit = await limitInput.inputValue();

		const probeIp = `198.51.100.${50 + Math.floor(Math.random() * 150)}`;
		const probeContext = await browser.newContext({
			baseURL: testInfo.project.use.baseURL,
			extraHTTPHeaders: { 'X-Forwarded-For': probeIp },
		});
		const probePage = await probeContext.newPage();

		try {
			await saveAuthRateLimit(page, 3);

			await probePage.goto('/login');
			await expect(probePage.getByRole('heading', { name: 'Joplock' })).toBeVisible();

			for (let attempt = 1; attempt <= 3; attempt += 1) {
				const response = await submitBadLogin(probePage, 'pw-rate-limit@example.com', 'wrongpass');
				expect(response.status()).toBe(302);
				await expect(probePage.locator('#login-error')).toContainText('Invalid email or password');
			}

			const blocked = await submitBadLogin(probePage, 'pw-rate-limit@example.com', 'wrongpass');
			expect(blocked.status()).toBe(429);
			await expect(probePage.locator('#login-error')).toContainText('Too many login attempts. Try again later.');
		} finally {
			await saveAuthRateLimit(page, originalLimit);
			await probeContext.close();
		}
	});
});

'use strict';

const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

// The service worker (public/service-worker.js) caches only versioned scripts/stylesheets and an
// offline page. A launch with no network must land on that page, never on the browser's error
// page and never on a cached signed-in page. Read-only: logs in, goes offline, comes back.

test.describe('PWA offline launch', () => {
	test('the worker caches versioned assets, an offline launch shows the offline page, and it recovers', async ({ page, context }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		await login(page);
		await page.evaluate(() => navigator.serviceWorker.ready);
		await page.reload(); // now controlled by the worker
		await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

		const version = await page.evaluate(() => window._joplockConfig.assetVersion);
		expect(version).toMatch(/^[0-9a-f]{10}$/);
		const cached = await page.evaluate(async () => {
			const names = await caches.keys();
			const entries = {};
			for (const name of names) entries[name] = (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname + new URL(r.url).search);
			return entries;
		});
		expect(Object.keys(cached)).toEqual([`joplock-shell-${version}`]);
		const entries = cached[`joplock-shell-${version}`];
		expect(entries).toContain('/offline.html');
		await expect.poll(async () => (await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname + new URL(r.url).search), `joplock-shell-${version}`)).includes(`/app.js?v=${version}`)).toBe(true);
		// never a page, never an API response
		expect(entries.filter(e => e === '/' || e.startsWith('/api') || e.startsWith('/fragments'))).toEqual([]);

		await context.setOffline(true);
		await page.goto('/');
		await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
		await expect(page.locator('#retry')).toBeVisible();

		// while still offline the button says so instead of reloading into an error
		await page.locator('#retry').click();
		await expect(page.locator('#status')).toHaveText('Still offline.');

		// back online: the page notices (online event) and reloads into the app by itself
		await context.setOffline(false);
		await expect(page.locator('body.app-shell')).toBeVisible({ timeout: 15000 });
	});
});

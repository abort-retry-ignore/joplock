'use strict';

const { test, expect, devices } = require('@playwright/test');
const { login } = require('./helpers');

// A phone in landscape is 812-956px wide, past the 768px breakpoint. It used to get the desktop
// layout in ~390px of height and rotating reloaded the page. The mobile shell now follows the
// physical screen of a touch device, so rotation keeps it, and a tablet whose window the keyboard
// squashes does not flip to it. Read-only: logs in and resizes the window.

test.describe('Landscape and the shell', () => {
	test('a phone in landscape keeps the mobile shell, and rotating does not reload the page', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		await login(page);
		await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
		const portrait = page.viewportSize();
		await page.evaluate(() => { window.__notReloaded = true; });

		await page.setViewportSize({ width: portrait.height, height: portrait.width }); // landscape
		await page.waitForTimeout(1200);

		const state = await page.evaluate(() => ({
			marker: window.__notReloaded === true,
			mobileShell: isMobileShellMode(),
			w: innerWidth,
			h: innerHeight,
			mobileApp: getComputedStyle(document.getElementById('mobile-app')).display,
			desktopApp: getComputedStyle(document.querySelector('.app')).display,
			headerH: Math.round(document.querySelector('.mobile-screen-active .mobile-header').getBoundingClientRect().height),
			overflowX: document.documentElement.scrollWidth - innerWidth,
		}));
		expect(state.w).toBeGreaterThan(768);
		expect(state.marker, 'the page must not reload when the phone rotates').toBe(true);
		expect(state.mobileShell).toBe(true);
		expect(state.mobileApp).toBe('flex');
		expect(state.desktopApp).toBe('none');
		expect(state.headerH, 'the title bar tightens in a short window').toBe(36);
		expect(state.overflowX).toBeLessThanOrEqual(0);

		// and back
		await page.setViewportSize(portrait);
		await page.waitForTimeout(800);
		expect(await page.evaluate(() => window.__notReloaded === true && isMobileShellMode())).toBe(true);
	});

	test('a tablet whose window the keyboard squashes stays on the desktop shell', async ({ browser }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		const context = await browser.newContext({ ...devices['iPad Pro 11 landscape'], baseURL: testInfo.project.use.baseURL });
		try {
			const page = await context.newPage();
			await login(page);
			await page.evaluate(() => { window.__notReloaded = true; });
			expect(await page.evaluate(() => isMobileShellMode())).toBe(false);
			// the soft keyboard: the window loses over half its height, the physical screen does not.
			// page.setViewportSize() would shrink the emulated screen with the window, so set them apart.
			const cdp = await context.newCDPSession(page);
			await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1194, height: 380, deviceScaleFactor: 2, mobile: true, screenWidth: 1194, screenHeight: 834 });
			await page.waitForTimeout(1200);
			expect(await page.evaluate(() => [innerHeight, screen.height])).toEqual([380, 834]);
			const state = await page.evaluate(() => ({ marker: window.__notReloaded === true, mobileShell: isMobileShellMode(), screen: [screen.width, screen.height] }));
			expect(state.marker, 'no reload while typing').toBe(true);
			expect(state.mobileShell).toBe(false);
			expect(Math.min(...state.screen)).toBeGreaterThan(500);
		} finally {
			await context.close();
		}
	});

	test('a mouse-driven desktop window that is short stays on the desktop shell', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		await page.setViewportSize({ width: 1000, height: 400 });
		await login(page);
		expect(await page.evaluate(() => isMobileShellMode())).toBe(false);
		await expect(page.locator('.app')).toBeVisible();
	});
});

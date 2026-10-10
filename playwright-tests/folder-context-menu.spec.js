'use strict';

// The notebook context menu floats over the sidebar and the editor:
//   - it must be opaque (it used the bare translucent --bg-elevated, so content showed through)
//   - it must stay on screen (it opened exactly at the pointer, so right-clicking a notebook near
//     the bottom of a long list pushed Share / Delete below the viewport, unreachable)

const { test, expect } = require('@playwright/test');
const { acceptDialogs, login, slug, teardownTestData } = require('./helpers');

const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
	const res = await fetch(u, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
	const text = await res.text();
	let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
	return { status: res.status, data, text };
}, [method, url, body]);

test.describe('Notebook context menu', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
	});

	test('is opaque: the background is a solid colour with the tint layered on top', async ({ page }) => {
		await login(page);
		const row = page.locator('#nav-panel .nav-folder:not([data-all-notes]) > .nav-folder-row').first();
		await expect(row).toBeVisible({ timeout: 15000 });
		for (const theme of ['earth', 'light', 'matrix', 'dark-grey']) {
			await page.evaluate(t => { [...document.body.classList].filter(c => c.startsWith('theme-')).forEach(c => document.body.classList.remove(c)); document.body.classList.add(`theme-${t}`); }, theme);
			await row.click({ button: 'right', position: { x: 60, y: 10 } });
			await expect(page.locator('#folder-context-menu')).toBeVisible();
			const bg = await page.locator('#folder-context-menu').evaluate(el => getComputedStyle(el).backgroundColor);
			expect(bg, `${theme}: base colour must not carry alpha`).toMatch(/^rgb\(/);
			await page.keyboard.press('Escape');
			await page.mouse.click(800, 500);
		}
	});

	test('stays fully on screen when opened near the bottom of a short window', async ({ page }) => {
		const base = slug('zz-pw-menu'); // sorts last, so its row sits at the bottom of the list
		await page.setViewportSize({ width: 1200, height: 520 });
		await login(page);
		try {
			const id = (await api(page, 'POST', '/api/web/folders', { title: `${base}-last`, parentId: '' })).data.item.id;
			await page.reload();
			const folder = page.locator(`#nav-panel .nav-folder[data-folder-id="${id}"]`);
			await expect(folder).toBeVisible({ timeout: 15000 });
			const row = folder.locator(':scope > .nav-folder-row');
			await row.scrollIntoViewIfNeeded();
			await row.click({ button: 'right' });

			const menu = page.locator('#folder-context-menu');
			await expect(menu).toBeVisible();
			const vh = page.viewportSize().height;
			const box = await menu.boundingBox();
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.y + box.height).toBeLessThanOrEqual(vh);
			// every entry is inside the window and actually reachable
			for (const name of ['Pin to top', 'Edit notebook', 'Share', 'Delete notebook']) {
				const item = menu.getByRole('button', { name });
				await expect(item).toBeVisible();
				const b = await item.boundingBox();
				expect(b.y + b.height, `${name} below the fold`).toBeLessThanOrEqual(vh);
			}
			// ...so the last one can really be clicked (this timed out before the fix)
			await menu.getByRole('button', { name: 'Share' }).click();
			await expect(page.locator('#share-modal')).toBeVisible({ timeout: 10000 });
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});
});

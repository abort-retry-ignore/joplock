'use strict';

const { test, expect } = require('@playwright/test');
const { ensureMobileFoldersScreen, login, openMobileFolder } = require('./helpers');

// The floating "+" button sits over the bottom-right of the folder and note lists. The lists
// must end with enough padding that the last row can be scrolled out from beneath it, otherwise
// that row's count / "+" / chevron (or the "Load more" button) can never be tapped.
// Read-only: navigates and measures, creates nothing.

async function measureAtEnd(page, bodySelector) {
	// Scroll and measure in one step: htmx can still be swapping a list in (which resets its
	// scroll position), so callers poll this until the list has settled at its end.
	return page.evaluate(selector => {
		const body = document.querySelector(selector);
		body.scrollTop = body.scrollHeight;
		const fab = document.getElementById('mobile-fab').getBoundingClientRect();
		const last = body.lastElementChild;
		const lastRect = last.getBoundingClientRect();
		const covered = [];
		for (const el of [last, ...last.querySelectorAll('button, a, [role="button"]')]) {
			const r = el.getBoundingClientRect();
			if (!r.width || !r.height) continue;
			// Probe points on the right half of the row, where the FAB lives.
			for (const [fx, fy] of [[0.5, 0.5], [0.9, 0.5], [0.9, 0.2], [0.9, 0.8]]) {
				const top = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
				if (top && top.closest('#mobile-fab')) covered.push(`${el.className || el.tagName}@${fx},${fy}`);
			}
		}
		return {
			padBottom: parseFloat(getComputedStyle(body).paddingBottom),
			lastBottom: Math.round(lastRect.bottom),
			fabTop: Math.round(fab.top),
			covered,
		};
	}, bodySelector);
}

async function expectLastRowClearOfFab(page, bodySelector) {
	await expect.poll(async () => {
		const r = await measureAtEnd(page, bodySelector);
		return r.lastBottom <= r.fabTop;
	}, { message: `${bodySelector} last row bottom must settle above the FAB top`, timeout: 10000 }).toBe(true);
	const result = await measureAtEnd(page, bodySelector);
	expect(result.padBottom, `${bodySelector} bottom padding`).toBeGreaterThanOrEqual(96);
	expect(result.covered, `${bodySelector} last row points under the FAB`).toEqual([]);
}

test.describe('Mobile list bottom clearance', () => {
	test('folder and note lists scroll their last row clear of the FAB', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		await login(page);
		await ensureMobileFoldersScreen(page);
		await expect(page.locator('#mobile-folders-body .mobile-folder-row').first()).toBeVisible({ timeout: 15000 });
		await expectLastRowClearOfFab(page, '#mobile-folders-body');

		await openMobileFolder(page, 'All Notes');
		await expect(page.locator('#mobile-notes-body > *').first()).toBeVisible({ timeout: 15000 });
		await expectLastRowClearOfFab(page, '#mobile-notes-body');
	});

	test('the editor body does not get list padding', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		await login(page);
		await expect(page.locator('#mobile-app[aria-hidden="false"]')).toBeVisible();
		const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('mobile-editor-body')).paddingBottom));
		expect(pad).toBe(0);
	});
});

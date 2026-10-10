'use strict';

// Pin a notebook to the top of the list. A per-user Joplock setting: the Joplin notebook
// itself is never written (checked byte-for-byte below), and it follows the user to the
// mobile shell. Pinned notebooks sort first among their siblings under whichever order is
// active; pinning a nested notebook pulls its parents up so it stays near the top, under them.

const { test, expect } = require('@playwright/test');
const { acceptDialogs, ensureMobileFoldersScreen, login, slug, teardownTestData } = require('./helpers');

const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
	const res = await fetch(u, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
	const text = await res.text();
	let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
	return { status: res.status, data, text };
}, [method, url, body]);

const seed = async (page, base) => {
	const ids = {};
	const mk = async (key, title, parentId = '') => { ids[key] = (await api(page, 'POST', '/api/web/folders', { title, parentId })).data.item.id; };
	await mk('a', `${base}-a`);
	await mk('b', `${base}-b`);
	await mk('kid', `${base}-b-kid`, ids.b);
	await mk('c', `${base}-c`);
	return ids;
};
const unpinAll = async (page, ids) => { for (const id of Object.values(ids || {})) await api(page, 'DELETE', `/api/web/pinned-folders/${id}`); };

const desktopOrder = (page, base) => page.evaluate(b => [...document.querySelectorAll('#nav-panel .nav-folder[data-folder-title]')]
	.filter(e => e.dataset.folderTitle.startsWith(b)).map(e => e.dataset.folderTitle.slice(b.length + 1)), base);
const mobileOrder = (page, base) => page.evaluate(b => [...document.querySelectorAll('#mobile-folders-body .mobile-folder-row[data-folder-id]')]
	.map(e => (e.querySelector('.mobile-folder-title') || {}).textContent).filter(t => t && t.startsWith(b)).map(t => t.slice(b.length + 1)), base);

const navFolder = (page, id) => page.locator(`#nav-panel .nav-folder[data-folder-id="${id}"]`);
const navRow = (page, id) => navFolder(page, id).locator(':scope > .nav-folder-row');
const sessionId = async page => (await page.context().cookies()).find(c => c.name === 'sessionId').value;
// the item exactly as a Joplin app downloads it (X-API-AUTH only, no browser cookie)
const rawItem = async (page, request, id) => (await request.get(`/joplin/api/items/root:/${id}.md:/content`, { headers: { 'X-API-AUTH': await sessionId(page) } })).text();

test.describe('Pin a notebook — desktop', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		await login(page);
		await page.evaluate(() => localStorage.removeItem('joplock-nav-folders'));
	});

	test('pin from the context menu, see it first with a pin, keep it after reload, unpin', async ({ page, request }) => {
		const base = slug('pw-pin');
		let ids;
		try {
			ids = await seed(page, base);
			await page.reload();
			await expect(navFolder(page, ids.c)).toBeVisible({ timeout: 15000 });
			expect(await desktopOrder(page, base)).toEqual(['a', 'b', 'b-kid', 'c']);
			const before = await rawItem(page, request, ids.c);

			await navRow(page, ids.c).click({ button: 'right' });
			await expect(page.locator('#folder-ctx-pin')).toHaveText('Pin to top');
			await page.locator('#folder-ctx-pin').click();
			await expect.poll(() => desktopOrder(page, base)).toEqual(['c', 'a', 'b', 'b-kid']);
			await expect(navFolder(page, ids.c)).toHaveAttribute('data-pinned', '1');
			await expect(navRow(page, ids.c).locator('.nav-pin-icon')).toBeVisible();
			await expect(page.locator('#nav-panel .nav-pin-icon')).toHaveCount(await page.locator('#nav-panel .nav-folder[data-pinned="1"]').count());

			// the Joplin notebook was not touched
			expect(await rawItem(page, request, ids.c)).toBe(before);

			// saved server-side
			await page.reload();
			await expect.poll(() => desktopOrder(page, base)).toEqual(['c', 'a', 'b', 'b-kid']);

			await navRow(page, ids.c).click({ button: 'right' });
			await expect(page.locator('#folder-ctx-pin')).toHaveText('Unpin from top');
			await page.locator('#folder-ctx-pin').click();
			await expect.poll(() => desktopOrder(page, base)).toEqual(['a', 'b', 'b-kid', 'c']);
			await expect(navRow(page, ids.c).locator('.nav-pin-icon')).toHaveCount(0);
			expect(await rawItem(page, request, ids.c)).toBe(before);
		} finally {
			await unpinAll(page, ids);
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('pinning a nested notebook pulls its parent up and keeps it underneath', async ({ page }) => {
		const base = slug('pw-pin');
		let ids;
		try {
			ids = await seed(page, base);
			await page.reload();
			await expect(navFolder(page, ids.c)).toBeVisible({ timeout: 15000 });
			expect((await api(page, 'PUT', `/api/web/pinned-folders/${ids.kid}`)).status).toBe(204);
			await page.reload();
			// b rises above a and c; its pinned child stays inside it. Open b to see the child.
			await expect.poll(async () => (await desktopOrder(page, base)).filter(t => ['a', 'b', 'c'].includes(t))).toEqual(['b', 'a', 'c']);
			await navFolder(page, ids.b).locator(':scope > .nav-folder-row .nav-folder-toggle').click();
			await expect(navFolder(page, ids.kid)).toBeVisible();
			await expect(navFolder(page, ids.kid)).toHaveAttribute('data-parent-id', ids.b);
			await expect(navRow(page, ids.kid).locator('.nav-pin-icon')).toBeVisible();
			await expect(navRow(page, ids.b).locator('.nav-pin-icon')).toHaveCount(0);
		} finally {
			await unpinAll(page, ids);
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('pinned notebooks stay first under the most-recent order, and pickers stay alphabetical', async ({ page }) => {
		const base = slug('pw-pin');
		let ids;
		try {
			ids = await seed(page, base);
			await api(page, 'POST', '/api/web/notes', { title: `${base}-n`, body: 'x', parentId: ids.a });
			await api(page, 'PUT', '/api/web/settings', { folderSort: 'recent' });
			await api(page, 'PUT', `/api/web/pinned-folders/${ids.c}`);
			await page.reload();
			await expect.poll(() => desktopOrder(page, base)).toEqual(['c', 'a', 'b', 'b-kid']);
			// the open note's notebook picker ignores pins and recency
			await navFolder(page, ids.a).locator(':scope > .nav-folder-row .nav-folder-toggle').click();
			await navFolder(page, ids.a).locator('.notelist-item').first().click();
			await expect(page.locator('#editor-panel #note-editor-form')).toBeVisible({ timeout: 15000 });
			const titles = await page.locator('#editor-panel #editor-folder-select option').evaluateAll(els => els.map(o => o.textContent.replace(/[\u00a0\u21b3]/g, '').trim()));
			expect(titles.filter(t => t.startsWith(base)).map(t => t.slice(base.length + 1))).toEqual(['a', 'b', 'b-kid', 'c']);
		} finally {
			await api(page, 'PUT', '/api/web/settings', { folderSort: 'alpha' });
			await unpinAll(page, ids);
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('pinning a notebook that does not exist is refused', async ({ page }) => {
		const r = await api(page, 'PUT', '/api/web/pinned-folders/ffffffffffffffffffffffffffffffff');
		expect(r.status).toBe(404);
	});
});

test.describe('Pin a notebook — mobile', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);
		await login(page);
		await page.evaluate(() => localStorage.removeItem('joplock-mobile-folders'));
	});

	test('long-press sheet pins and unpins; the pinned notebook moves to the top with a pin', async ({ page }) => {
		const base = slug('pw-pin');
		let ids;
		try {
			ids = await seed(page, base);
			await page.reload();
			await ensureMobileFoldersScreen(page);
			const row = id => page.locator(`#mobile-folders-body .mobile-folder-row[data-folder-id="${id}"]`);
			await expect(row(ids.c)).toBeVisible({ timeout: 15000 });
			expect(await mobileOrder(page, base)).toEqual(['a', 'b', 'b-kid', 'c']); // b-kid is in the list (collapsed under b)

			await row(ids.c).dispatchEvent('contextmenu');
			await expect(page.locator('#mobile-folder-ctx-pin')).toContainText('Pin to top');
			await page.locator('#mobile-folder-ctx-pin').click();
			await expect.poll(() => mobileOrder(page, base)).toEqual(['c', 'a', 'b', 'b-kid']);
			await expect(row(ids.c)).toHaveAttribute('data-pinned', '1');
			await expect(row(ids.c).locator('.mobile-pin-icon')).toBeVisible();

			await row(ids.c).dispatchEvent('contextmenu');
			await expect(page.locator('#mobile-folder-ctx-pin')).toContainText('Unpin from top');
			await page.locator('#mobile-folder-ctx-pin').click();
			await expect.poll(() => mobileOrder(page, base)).toEqual(['a', 'b', 'b-kid', 'c']);
			await expect(row(ids.c).locator('.mobile-pin-icon')).toHaveCount(0);
		} finally {
			await unpinAll(page, ids);
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});
});

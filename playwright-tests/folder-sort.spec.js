'use strict';

// Notebook order: A-Z <-> most recently updated. The switch is next to the notebooks (desktop
// sidebar header / mobile folders header) and the choice is a saved per-user setting.
// "Recent" ranks a notebook by the newest note anywhere in its subtree, so a parent rises
// with its busiest child, and a child is always drawn under its parent.

const { test, expect } = require('@playwright/test');
const { acceptDialogs, ensureMobileFoldersScreen, login, slug, teardownTestData } = require('./helpers');

const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
	const res = await fetch(u, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
	const text = await res.text();
	let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
	return { status: res.status, data, text };
}, [method, url, body]);

const setSort = async (page, value) => {
	const r = await api(page, 'PUT', '/api/web/settings', { folderSort: value });
	expect(r.status).toBe(204);
};

// a (with child a-kid), b, c. Alphabetical: a, b, c. Newest note is in a-kid, then c, then b.
const seed = async (page, base) => {
	const ids = {};
	const mk = async (key, title, parentId = '') => { ids[key] = (await api(page, 'POST', '/api/web/folders', { title, parentId })).data.item.id; };
	await mk('a', `${base}-a`);
	await mk('kid', `${base}-a-kid`, ids.a);
	await mk('b', `${base}-b`);
	await mk('c', `${base}-c`);
	const note = async (key, parentId) => { ids[key] = (await api(page, 'POST', '/api/web/notes', { title: `${base}-${key}`, body: key, parentId })).data.item.id; await page.waitForTimeout(60); };
	await note('nb', ids.b);
	await note('nc', ids.c);
	await note('nkid', ids.kid);
	return ids;
};

const desktopOrder = (page, base) => page.evaluate(b => [...document.querySelectorAll('#nav-panel .nav-folder[data-folder-title]')]
	.filter(e => e.dataset.folderTitle.startsWith(b)).map(e => e.dataset.folderTitle.slice(b.length + 1)), base);
const mobileOrder = (page, base) => page.evaluate(b => [...document.querySelectorAll('#mobile-folders-body .mobile-folder-row[data-folder-id]')]
	.map(e => (e.querySelector('.mobile-folder-title') || {}).textContent).filter(t => t && t.startsWith(b)).map(t => t.slice(b.length + 1)), base);

test.describe('Notebook order — desktop', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		await login(page);
		await setSort(page, 'alpha');
		await page.evaluate(() => { localStorage.removeItem('joplock-nav-folders'); });
	});

	test('switch between A-Z and most recent; children stay under their parent; the choice persists', async ({ page }) => {
		const base = slug('pw-sort');
		try {
			const ids = await seed(page, base);
			await page.reload();
			await expect(page.locator(`#nav-panel .nav-folder[data-folder-id="${ids.c}"]`)).toBeVisible({ timeout: 15000 });
			await expect(page.locator('body')).toHaveAttribute('data-folder-sort', 'alpha');
			await expect(page.locator('#nav-sort-btn .sort-on-alpha')).toBeVisible();
			expect(await desktopOrder(page, base)).toEqual(['a', 'a-kid', 'b', 'c']);

			await page.locator('#nav-sort-btn').click();
			await expect(page.locator('body')).toHaveAttribute('data-folder-sort', 'recent');
			await expect(page.locator('#nav-sort-btn .sort-on-recent')).toBeVisible();
			// a rises (its child holds the newest note) and the child stays right under it
			await expect.poll(() => desktopOrder(page, base)).toEqual(['a', 'a-kid', 'c', 'b']);
			await expect(page.locator(`#nav-panel .nav-folder[data-folder-id="${ids.kid}"]`)).toHaveAttribute('data-parent-id', ids.a);

			// saved on the server: survives a reload
			await page.reload();
			await expect(page.locator('body')).toHaveAttribute('data-folder-sort', 'recent');
			await expect.poll(() => desktopOrder(page, base)).toEqual(['a', 'a-kid', 'c', 'b']);

			await page.locator('#nav-sort-btn').click();
			await expect(page.locator('body')).toHaveAttribute('data-folder-sort', 'alpha');
			await expect.poll(() => desktopOrder(page, base)).toEqual(['a', 'a-kid', 'b', 'c']);
		} finally {
			await setSort(page, 'alpha');
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('editing a note moves its notebook up; moving it does not', async ({ page }) => {
		const base = slug('pw-sort');
		try {
			const ids = await seed(page, base);
			await setSort(page, 'recent');
			await page.reload();
			await expect.poll(() => desktopOrder(page, base)).toEqual(['a', 'a-kid', 'c', 'b']);
			// a real edit in b makes b the most recent
			await api(page, 'PUT', `/api/web/notes/${ids.nb}`, { title: `${base}-nb`, body: 'edited', parentId: ids.b });
			await page.reload();
			await expect.poll(() => desktopOrder(page, base)).toEqual(['b', 'a', 'a-kid', 'c']);
			// moving a note out of b into c is not an "edit": c does not leapfrog... b keeps its place
			await api(page, 'PUT', `/api/web/notes/${ids.nc}`, { title: `${base}-nc`, body: 'c', parentId: ids.b });
			await page.reload();
			expect((await desktopOrder(page, base))[0]).toBe('b');
		} finally {
			await setSort(page, 'alpha');
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('pickers stay alphabetical in most-recent mode, and the open note stays highlighted after switching', async ({ page }) => {
		const base = slug('pw-sort');
		try {
			const ids = await seed(page, base);
			await setSort(page, 'recent');
			await page.reload();
			const c = page.locator(`#nav-panel .nav-folder[data-folder-id="${ids.c}"]`);
			await expect(c).toBeVisible({ timeout: 15000 });
			await c.locator(':scope > .nav-folder-row .nav-folder-toggle').click();
			await c.locator('.notelist-item').first().click();
			await expect(page.locator('#editor-panel #note-editor-form')).toBeVisible({ timeout: 15000 });

			const optionTitles = await page.locator('#editor-panel #editor-folder-select option').evaluateAll(els => els.map(o => o.textContent.replace(/[\u00a0\u21b3]/g, '').trim()));
			const mine = optionTitles.filter(t => t.startsWith(base)).map(t => t.slice(base.length + 1));
			expect(mine).toEqual(['a', 'a-kid', 'b', 'c']);

			await expect(c.locator('.notelist-item.active')).toHaveCount(1);
			await page.locator('#nav-sort-btn').click();
			await expect(page.locator('body')).toHaveAttribute('data-folder-sort', 'alpha');
			await expect.poll(() => desktopOrder(page, base)).toEqual(['a', 'a-kid', 'b', 'c']);
			await expect(page.locator(`#nav-panel .nav-folder[data-folder-id="${ids.c}"] .notelist-item.active`)).toHaveCount(1, { timeout: 10000 });
		} finally {
			await setSort(page, 'alpha');
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('the Settings page offers the same choice', async ({ page }) => {
		await setSort(page, 'recent');
		try {
			await page.goto('/settings');
			await expect(page.locator('#settings-folder-sort')).toHaveValue('recent');
			await page.locator('#settings-folder-sort').selectOption('alpha');
			await expect.poll(async () => (await api(page, 'GET', '/api/web/me')).status).toBe(200);
			await page.waitForTimeout(600);
			await page.goto('/');
			await expect(page.locator('body')).toHaveAttribute('data-folder-sort', 'alpha');
		} finally {
			await setSort(page, 'alpha');
		}
	});
});

test.describe('Notebook order — mobile', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);
		await login(page);
		await setSort(page, 'alpha');
		await page.evaluate(() => { localStorage.removeItem('joplock-mobile-folders'); });
	});

	test('the folders screen has the switch and follows the order', async ({ page }) => {
		const base = slug('pw-sort');
		try {
			const ids = await seed(page, base);
			await page.reload();
			await ensureMobileFoldersScreen(page);
			await expect(page.locator(`#mobile-folders-body .mobile-folder-row[data-folder-id="${ids.c}"]`)).toBeVisible({ timeout: 15000 });
			await expect(page.locator('#mobile-sort-btn .sort-on-alpha')).toBeVisible();
			// expand a so its child is part of the visible order
			await page.locator(`#mobile-folders-body .mobile-folder-row[data-folder-id="${ids.a}"] .mobile-folder-toggle`).click();
			expect(await mobileOrder(page, base)).toEqual(['a', 'a-kid', 'b', 'c']);

			await page.locator('#mobile-sort-btn').click();
			await expect(page.locator('body')).toHaveAttribute('data-folder-sort', 'recent');
			await expect(page.locator('#mobile-sort-btn .sort-on-recent')).toBeVisible();
			await expect.poll(() => mobileOrder(page, base)).toEqual(['a', 'a-kid', 'c', 'b']);
			await expect(page.locator(`#mobile-folders-body .mobile-folder-row[data-folder-id="${ids.kid}"]`)).toHaveAttribute('data-parent-id', ids.a);
		} finally {
			await setSort(page, 'alpha');
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});
});

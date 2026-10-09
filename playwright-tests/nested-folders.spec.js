'use strict';

// Nested notebooks: desktop tree + mobile inline tree, create / move / delete.
// Data is created through the JSON API (fast, deterministic) and removed in a
// finally block with teardownTestData (children share the base prefix).

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	ensureMobileFoldersScreen,
	login,
	slug,
	teardownTestData,
} = require('./helpers');

const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => {
	const res = await fetch(u, {
		method: m,
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json' },
		body: b === undefined ? undefined : JSON.stringify(b),
	});
	const text = await res.text();
	let data = null;
	try { data = JSON.parse(text); } catch { /* not json */ }
	return { status: res.status, data };
}, [method, url, body]);

const mkFolder = async (page, title, parentId = '') => {
	const r = await api(page, 'POST', '/api/web/folders', { title, parentId });
	expect(r.status).toBe(201);
	return r.data.item.id;
};

const mkNote = async (page, title, parentId) => {
	const r = await api(page, 'POST', '/api/web/notes', { title, body: `${title} body`, parentId });
	expect(r.status).toBe(201);
	return r.data.item.id;
};

// parent > child > grand, plus an unrelated top-level sibling. One note in grand.
const seedTree = async (page, base) => {
	const parent = await mkFolder(page, `${base}-parent`);
	const child = await mkFolder(page, `${base}-child`, parent);
	const grand = await mkFolder(page, `${base}-grand`, child);
	const sibling = await mkFolder(page, `${base}-sibling`);
	const note = await mkNote(page, `${base}-note`, grand);
	return { parent, child, grand, sibling, note };
};

const navFolder = (page, id) => page.locator(`#nav-panel .nav-folder[data-folder-id="${id}"]`);
const navRow = (page, id) => navFolder(page, id).locator(':scope > .nav-folder-row');
const navToggle = (page, id) => navRow(page, id).locator('.nav-folder-toggle');
const parentOf = async (page, id) => (await api(page, 'GET', '/api/web/folders')).data.items.find(f => f.id === id)?.parentId;

const reloadUntilFolderVisible = async (page, id) => {
	for (let i = 0; i < 6; i++) {
		await page.reload();
		if (await navFolder(page, id).count()) return;
		await page.waitForTimeout(700);
	}
	await expect(navFolder(page, id)).toHaveCount(1);
};

test.describe('Nested notebooks — desktop', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		await login(page);
		// Start every test with a clean expansion state.
		await page.evaluate(() => { localStorage.removeItem('joplock-nav-folders'); localStorage.removeItem('joplock-mobile-folders'); });
	});

	test('renders a collapsible tree; several branches stay open; state survives reload', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			await reloadUntilFolderVisible(page, ids.grand);

			// Collapsed by default: only the top level shows.
			await expect(navFolder(page, ids.parent)).toBeVisible();
			await expect(navFolder(page, ids.sibling)).toBeVisible();
			await expect(navFolder(page, ids.child)).toBeHidden();
			await expect(navFolder(page, ids.parent)).toHaveAttribute('data-depth', '0');
			await expect(navFolder(page, ids.grand)).toHaveAttribute('data-depth', '2');
			await expect(navFolder(page, ids.grand)).toHaveAttribute('data-parent-id', ids.child);

			// Rolled-up count: the note lives two levels down.
			await expect(navRow(page, ids.parent).locator('.sidebar-item-count')).toHaveText('1');

			// Open level by level; the open parent stays open.
			await navToggle(page, ids.parent).click();
			await expect(navFolder(page, ids.child)).toBeVisible();
			await expect(navFolder(page, ids.grand)).toBeHidden();
			await navToggle(page, ids.child).click();
			await expect(navFolder(page, ids.grand)).toBeVisible();
			await expect(navFolder(page, ids.child)).toBeVisible();

			// Several branches open at once (no accordion).
			await navToggle(page, ids.grand).click();
			await expect(navFolder(page, ids.grand).locator(':scope > .nav-folder-notes .notelist-item')).toHaveCount(1);
			// Notes belong to their own notebook, not an ancestor's list.
			await expect(navFolder(page, ids.parent).locator(':scope > .nav-folder-notes .notelist-item')).toHaveCount(0);

			// Indentation grows with depth.
			const pad = async id => navRow(page, id).evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
			expect(await pad(ids.child)).toBeGreaterThan(await pad(ids.parent));
			expect(await pad(ids.grand)).toBeGreaterThan(await pad(ids.child));

			// Collapsing the top hides the whole subtree.
			await navToggle(page, ids.parent).click();
			await expect(navFolder(page, ids.grand)).toBeHidden();
			await navToggle(page, ids.parent).click();
			await expect(navFolder(page, ids.grand)).toBeVisible();

			// Saved state restores the same view after a reload.
			await page.reload();
			await expect(navFolder(page, ids.grand)).toBeVisible();
			await expect(navFolder(page, ids.grand).locator(':scope > .nav-folder-notes .notelist-item')).toHaveCount(1);
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('opening a note in a nested notebook shows an indented, ordered notebook picker', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			await reloadUntilFolderVisible(page, ids.grand);
			await navToggle(page, ids.parent).click();
			await navToggle(page, ids.child).click();
			await navFolder(page, ids.grand).locator(':scope > .nav-folder-row .nav-folder-title').click();
			await expect(page.locator('#editor-panel #note-editor-form')).toBeVisible({ timeout: 15000 });

			const options = page.locator('#editor-panel #editor-folder-select option');
			const values = await options.evaluateAll(els => els.map(o => o.value));
			const order = [ids.parent, ids.child, ids.grand].map(id => values.indexOf(id));
			expect(order.every(i => i >= 0)).toBe(true);
			expect(order[0]).toBeLessThan(order[1]);
			expect(order[1]).toBeLessThan(order[2]);
			await expect(page.locator('#editor-panel #editor-folder-select')).toHaveValue(ids.grand);
			const grandLabel = await page.locator(`#editor-panel #editor-folder-select option[value="${ids.grand}"]`).textContent();
			expect(grandLabel).toContain('\u21b3');
			expect(grandLabel).toContain(`${base}-grand`);
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('New sub-notebook from the context menu creates it under the parent and reveals it', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const parent = await mkFolder(page, `${base}-parent`);
			await reloadUntilFolderVisible(page, parent);
			await navRow(page, parent).click({ button: 'right' });
			await expect(page.locator('#folder-context-menu')).toBeVisible();
			await page.getByRole('button', { name: 'New sub-notebook' }).click();
			await expect(page.locator('#new-folder-modal')).toBeVisible();
			await expect(page.locator('#new-folder-parent')).toHaveValue(parent);
			await page.locator('#new-folder-title').fill(`${base}-sub`);
			await page.locator('#new-folder-modal-form').evaluate(form => form.requestSubmit());
			await expect(page.locator('#new-folder-modal')).toBeHidden();

			const sub = page.locator(`#nav-panel .nav-folder[data-folder-title="${base}-sub"]`);
			await expect(sub).toBeVisible();
			await expect(sub).toHaveAttribute('data-parent-id', parent);
			expect(await parentOf(page, await sub.getAttribute('data-folder-id'))).toBe(parent);
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('Move notebook: tree picker disables the subtree; the move lands and a vault-free notebook can go to the top level', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			await reloadUntilFolderVisible(page, ids.grand);

			// Moving the parent: it and its descendants are not valid targets.
			await navRow(page, ids.parent).click({ button: 'right' });
			await page.getByRole('button', { name: /Move notebook/ }).click();
			await expect(page.locator('#move-folder-modal')).toBeVisible();
			const opt = id => page.locator(`#move-folder-parent option[value="${id}"]`);
			await expect(opt(ids.sibling)).toBeEnabled();
			await expect(opt(ids.child)).toBeDisabled();
			await expect(opt(ids.grand)).toBeDisabled();
			await expect(opt(ids.parent)).toBeDisabled();
			await page.getByRole('button', { name: 'Cancel' }).last().click();
			await expect(page.locator('#move-folder-modal')).toBeHidden();

			// Move the sibling into grand.
			await navRow(page, ids.sibling).click({ button: 'right' });
			await page.getByRole('button', { name: /Move notebook/ }).click();
			await expect(opt(ids.grand)).toBeEnabled();
			await page.locator('#move-folder-parent').selectOption(ids.grand);
			await page.locator('#move-folder-form').evaluate(form => form.requestSubmit());
			await expect(page.locator('#move-folder-modal')).toBeHidden();
			await expect.poll(() => parentOf(page, ids.sibling)).toBe(ids.grand);
			await expect(navFolder(page, ids.sibling)).toHaveAttribute('data-parent-id', ids.grand);

			// ...and back out to the top level.
			await navRow(page, ids.sibling).click({ button: 'right' });
			await page.getByRole('button', { name: /Move notebook/ }).click();
			await page.locator('#move-folder-parent').selectOption('');
			await page.locator('#move-folder-form').evaluate(form => form.requestSubmit());
			await expect(page.locator('#move-folder-modal')).toBeHidden();
			await expect.poll(() => parentOf(page, ids.sibling)).toBe('');
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('the server refuses to move a notebook into its own descendant', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			const r = await api(page, 'PUT', `/api/web/folders/${ids.parent}`, { parentId: ids.grand });
			expect(r.status).toBe(400);
			expect(r.data.error).toMatch(/sub-notebooks/);
			expect(await parentOf(page, ids.parent)).toBe('');
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('deleting a middle notebook promotes its children and notes instead of deleting them', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			const childNote = await mkNote(page, `${base}-childnote`, ids.child);
			await reloadUntilFolderVisible(page, ids.grand);
			await navToggle(page, ids.parent).click();

			await navRow(page, ids.child).click({ button: 'right' });
			await page.getByRole('button', { name: 'Delete notebook' }).click(); // confirm auto-accepted
			await expect(navFolder(page, ids.child)).toHaveCount(0);

			// grand moved up under parent; the child's own note moved to parent too.
			await expect.poll(() => parentOf(page, ids.grand)).toBe(ids.parent);
			const headers = (await api(page, 'GET', '/api/web/notes/headers')).data.items;
			expect(headers.find(n => n.id === childNote).parentId).toBe(ids.parent);
			expect(headers.find(n => n.id === ids.note).parentId).toBe(ids.grand);
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});
});

// Real mouse-driven HTML5 drag and drop. The "top level" strip only exists once a drag has
// started, so Locator.dragTo (which waits for the target first) cannot be used for it.
const dragNotebook = async (page, fromLocator, toLocator, { hold = 0 } = {}) => {
	await fromLocator.scrollIntoViewIfNeeded();
	const from = await fromLocator.boundingBox();
	await page.mouse.move(from.x + 40, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + 60, from.y + from.height / 2 + 8, { steps: 4 });
	await expect(page.locator('body.nav-dragging-folder')).toHaveCount(1, { timeout: 5000 });
	await expect(toLocator).toBeVisible();
	await toLocator.scrollIntoViewIfNeeded();
	const to = await toLocator.boundingBox();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
	if (hold) await page.waitForTimeout(hold);
	await page.mouse.up();
};

test.describe('Nested notebooks — drag and drop (desktop)', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);
		await login(page);
		await page.evaluate(() => { localStorage.removeItem('joplock-nav-folders'); localStorage.removeItem('joplock-mobile-folders'); });
	});

	test('drag a notebook onto another to nest it, onto the top-level strip to un-nest it', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			await reloadUntilFolderVisible(page, ids.grand);
			await navToggle(page, ids.parent).click();
			await navToggle(page, ids.child).click();
			await expect(navFolder(page, ids.grand)).toBeVisible();

			// only ordinary notebooks take part
			await expect(navRow(page, ids.sibling)).toHaveAttribute('draggable', 'true');
			await expect(page.locator('#nav-panel .nav-folder[data-all-notes="1"] > .nav-folder-row')).not.toHaveAttribute('draggable', 'true');

			// sibling -> into grand
			await dragNotebook(page, navRow(page, ids.sibling), navRow(page, ids.grand));
			await expect.poll(() => parentOf(page, ids.sibling)).toBe(ids.grand);
			await expect(navFolder(page, ids.sibling)).toHaveAttribute('data-parent-id', ids.grand);
			await expect(page.locator('body.nav-dragging-folder')).toHaveCount(0);

			// ...and back to the top level through the strip
			await expect(navFolder(page, ids.sibling)).toBeVisible();
			await dragNotebook(page, navRow(page, ids.sibling), page.locator('#nav-drop-root'));
			await expect.poll(() => parentOf(page, ids.sibling)).toBe('');
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('dropping a notebook into its own descendant does nothing', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			await reloadUntilFolderVisible(page, ids.grand);
			await navToggle(page, ids.parent).click();
			await navToggle(page, ids.child).click();
			await expect(navFolder(page, ids.grand)).toBeVisible();
			await dragNotebook(page, navRow(page, ids.parent), navRow(page, ids.grand));
			await expect(page.locator('body.nav-dragging-folder')).toHaveCount(0);
			await page.waitForTimeout(800);
			expect(await parentOf(page, ids.parent)).toBe('');
			expect(await parentOf(page, ids.grand)).toBe(ids.child);
			expect(await page.locator('.nav-drop-target').count()).toBe(0);
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('holding a dragged notebook over a closed one opens it so deeper targets are reachable', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			await reloadUntilFolderVisible(page, ids.grand);
			await expect(navFolder(page, ids.child)).toBeHidden();
			await dragNotebook(page, navRow(page, ids.sibling), navRow(page, ids.parent), { hold: 1100 });
			// it was dropped into `parent`, and hovering opened it so the new child is visible
			await expect.poll(() => parentOf(page, ids.sibling)).toBe(ids.parent);
			await expect(navFolder(page, ids.child)).toBeVisible();
			await expect(navFolder(page, ids.sibling)).toBeVisible();
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('the server\'s refusal is shown, not swallowed (a share root cannot be nested)', async ({ page }) => {
		const base = slug('pw-nest');
		let shareId = '';
		try {
			const a = await mkFolder(page, `${base}-a`);
			const b = await mkFolder(page, `${base}-b`);
			const share = await api(page, 'POST', '/api/web/shares', { notebookId: a });
			expect(share.status, share.text).toBe(200);
			shareId = share.data.id;
			await reloadUntilFolderVisible(page, b);
			const dialogs = [];
			page.on('dialog', d => dialogs.push(d.message())); // acceptDialogs() already accepts them
			await dragNotebook(page, navRow(page, a), navRow(page, b));
			await expect.poll(() => dialogs.length).toBeGreaterThan(0);
			expect(dialogs[0]).toMatch(/Stop sharing this notebook/);
			expect(await parentOf(page, a)).toBe('');
		} finally {
			if (shareId) await api(page, 'DELETE', `/api/web/shares/${shareId}`);
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});
});

test.describe('Nested notebooks — mobile', () => {
	test.beforeEach(async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);
		await login(page);
		await page.evaluate(() => { localStorage.removeItem('joplock-nav-folders'); localStorage.removeItem('joplock-mobile-folders'); });
	});

	const mrow = (page, id) => page.locator(`#mobile-folders-body .mobile-folder-row[data-folder-id="${id}"]`);

	const reloadMobileUntil = async (page, id) => {
		for (let i = 0; i < 6; i++) {
			await page.reload();
			await ensureMobileFoldersScreen(page);
			if (await mrow(page, id).count()) return;
			await page.waitForTimeout(700);
		}
		await expect(mrow(page, id)).toHaveCount(1);
	};

	test('inline tree: chevron expands one level at a time, the row still opens the notes, state survives reload', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const ids = await seedTree(page, base);
			await reloadMobileUntil(page, ids.grand);

			await expect(mrow(page, ids.parent)).toBeVisible();
			await expect(mrow(page, ids.child)).toBeHidden();
			await expect(mrow(page, ids.parent).locator('.mobile-folder-count')).toHaveText('1');

			await mrow(page, ids.parent).locator('.mobile-folder-toggle').click();
			await expect(mrow(page, ids.child)).toBeVisible();
			await expect(mrow(page, ids.grand)).toBeHidden();
			// The chevron tap must not have opened the notes screen.
			await expect(page.locator('#mobile-folders-screen.mobile-screen-active')).toBeVisible();

			await mrow(page, ids.child).locator('.mobile-folder-toggle').click();
			await expect(mrow(page, ids.grand)).toBeVisible();
			const pad = async id => mrow(page, id).evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
			expect(await pad(ids.grand)).toBeGreaterThan(await pad(ids.parent));

			await page.reload();
			await ensureMobileFoldersScreen(page);
			await expect(mrow(page, ids.grand)).toBeVisible();

			// Tapping the row (not the chevron) opens that notebook's notes.
			await mrow(page, ids.grand).click();
			await expect(page.locator('#mobile-notes-screen.mobile-screen-active')).toBeVisible();
			await expect(page.locator('#mobile-notes-title')).toContainText(`${base}-grand`);
			await expect(page.locator('#mobile-notes-body .mobile-note-row')).toHaveCount(1);
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});

	test('long-press sheet: New sub-notebook and Move notebook work from the folders screen', async ({ page }) => {
		const base = slug('pw-nest');
		try {
			const parent = await mkFolder(page, `${base}-parent`);
			const other = await mkFolder(page, `${base}-other`);
			await reloadMobileUntil(page, other);

			// New sub-notebook
			await mrow(page, parent).dispatchEvent('contextmenu');
			await expect(page.locator('#mobile-folder-ctx-sheet')).toBeVisible();
			await page.locator('#mobile-folder-ctx-add-sub').click();
			await expect(page.locator('#new-folder-modal')).toBeVisible();
			await expect(page.locator('#new-folder-parent')).toHaveValue(parent);
			await page.locator('#new-folder-title').fill(`${base}-sub`);
			await page.locator('#new-folder-modal-form').evaluate(form => form.requestSubmit());
			await expect(page.locator('#new-folder-modal')).toBeHidden();
			const sub = page.locator(`#mobile-folders-body .mobile-folder-row[data-parent-id="${parent}"]`);
			await expect(sub).toBeVisible(); // parent was expanded so the new notebook is visible
			const subId = await sub.getAttribute('data-folder-id');

			// Move it under "other"
			await mrow(page, subId).dispatchEvent('contextmenu');
			await page.locator('#mobile-folder-ctx-move').click();
			await expect(page.locator('#move-folder-modal')).toBeVisible();
			await page.locator('#move-folder-parent').selectOption(other);
			await page.locator('#move-folder-form').evaluate(form => form.requestSubmit());
			await expect(page.locator('#move-folder-modal')).toBeHidden();
			await expect.poll(() => parentOf(page, subId)).toBe(other);
			await expect(mrow(page, subId)).toHaveAttribute('data-parent-id', other);
			await expect(mrow(page, subId)).toBeVisible();
		} finally {
			await teardownTestData(page, { folderPrefixes: [base] });
		}
	});
});

'use strict';

// Sharing and nested notebooks (two accounts, desktop only).
//   - sharing a notebook shares its WHOLE subtree (sub-notebooks and their notes)
//   - a notebook moved into / out of a share is granted / revoked with its subtree
//   - a share root stays at the top level; a nested notebook is lifted before sharing
//   - recipients cannot create, move or delete inside the owner's share
//   - stopping the share removes every level
// Data goes through the JSON API; the reader's tree is also checked in the UI.

const { test: base, expect } = require('@playwright/test');
const {
	acceptDialogs,
	hasAdminCredentials,
	login,
	loginAs,
	teardownTestData,
	slug,
	ensureShareTestUsers,
	SHARE_READER_EMAIL,
	SHARE_READER_PASSWORD,
} = require('./helpers');

const test = base.extend({
	ownerPage: async ({ browser }, use) => { const page = await browser.newPage(); await use(page); await page.close(); },
	readerPage: async ({ browser }, use) => { const page = await browser.newPage(); await use(page); await page.close(); },
});

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
	return { status: res.status, data, text };
}, [method, url, body]);

const mkFolder = async (page, title, parentId = '') => {
	const r = await api(page, 'POST', '/api/web/folders', { title, parentId });
	expect(r.status, r.text).toBe(201);
	return r.data.item.id;
};
const mkNote = async (page, title, parentId) => {
	const r = await api(page, 'POST', '/api/web/notes', { title, body: `${title} body`, parentId });
	expect(r.status, r.text).toBe(201);
	return r.data.item.id;
};
const visibleFolderIds = async page => new Set(((await api(page, 'GET', '/api/web/folders')).data.items || []).map(f => f.id));
const visibleNoteIds = async page => new Set(((await api(page, 'GET', '/api/web/notes/headers')).data.items || []).map(n => n.id));

test.describe('nested notebooks and sharing', () => {
	test.beforeAll(async ({ browser }) => {
		if (!hasAdminCredentials()) return;
		const page = await browser.newPage();
		await login(page);
		await ensureShareTestUsers(page);
		await page.close();
	});

	test.beforeEach(async ({}, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		if (!hasAdminCredentials()) test.skip();
	});

	const shareWithReader = async (ownerPage, folderId) => {
		const created = await api(ownerPage, 'POST', '/api/web/shares', { notebookId: folderId });
		expect(created.status, created.text).toBe(200);
		const shareId = created.data.id;
		const invited = await api(ownerPage, 'POST', `/api/web/shares/${shareId}/invites`, { email: SHARE_READER_EMAIL, can_write: 1 });
		expect(invited.status, invited.text).toBe(200);
		return shareId;
	};

	test('the whole subtree is shared, then moved in/out, then unshared', async ({ ownerPage, readerPage }) => {
		await acceptDialogs(ownerPage);
		await acceptDialogs(readerPage);
		const base = slug('share-nest');
		await login(ownerPage);
		try {
			const root = await mkFolder(ownerPage, `${base}-root`);
			const sub = await mkFolder(ownerPage, `${base}-sub`, root);
			const leaf = await mkFolder(ownerPage, `${base}-leaf`, sub);
			const nRoot = await mkNote(ownerPage, `${base}-n-root`, root);
			const nLeaf = await mkNote(ownerPage, `${base}-n-leaf`, leaf);
			const outside = await mkFolder(ownerPage, `${base}-outside`);
			const nOutside = await mkNote(ownerPage, `${base}-n-outside`, outside);

			const shareId = await shareWithReader(ownerPage, root);
			await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);

			// 1. Every level reaches the reader, with the tree intact; unrelated data does not.
			const rFolders = (await api(readerPage, 'GET', '/api/web/folders')).data.items;
			const byId = Object.fromEntries(rFolders.map(f => [f.id, f]));
			expect(byId[root], 'root visible').toBeTruthy();
			expect(byId[sub] && byId[sub].parentId).toBe(root);
			expect(byId[leaf] && byId[leaf].parentId).toBe(sub);
			expect(byId[root].shareId).toBe(shareId);
			expect(byId[leaf].shareId).toBe(shareId);
			expect(byId[outside]).toBeUndefined();
			const rNotes = await visibleNoteIds(readerPage);
			expect(rNotes.has(nRoot) && rNotes.has(nLeaf)).toBe(true);
			expect(rNotes.has(nOutside)).toBe(false);

			// The reader's nav shows it as a tree under the shared root.
			await readerPage.reload();
			const readerFolder = id => readerPage.locator(`#nav-panel .nav-folder[data-folder-id="${id}"]`);
			await expect(readerFolder(root)).toBeVisible();
			await expect(readerFolder(sub)).toHaveAttribute('data-parent-id', root);
			await expect(readerFolder(leaf)).toHaveAttribute('data-depth', '2');

			// 2. Moving a notebook (with its subtree) INTO the share grants it.
			const r1 = await api(ownerPage, 'PUT', `/api/web/folders/${outside}`, { parentId: sub });
			expect(r1.status, r1.text).toBe(200);
			await expect.poll(async () => (await visibleFolderIds(readerPage)).has(outside)).toBe(true);
			await expect.poll(async () => (await visibleNoteIds(readerPage)).has(nOutside)).toBe(true);
			const moved = (await api(readerPage, 'GET', '/api/web/folders')).data.items.find(f => f.id === outside);
			expect(moved.parentId).toBe(sub);
			expect(moved.shareId).toBe(shareId);

			// 3. Moving it back OUT revokes the reader's access to the notebook and its notes.
			const r2 = await api(ownerPage, 'PUT', `/api/web/folders/${outside}`, { parentId: '' });
			expect(r2.status, r2.text).toBe(200);
			await expect.poll(async () => (await visibleFolderIds(readerPage)).has(outside)).toBe(false);
			await expect.poll(async () => (await visibleNoteIds(readerPage)).has(nOutside)).toBe(false);
			expect((await visibleFolderIds(readerPage)).has(sub), 'the rest of the share is untouched').toBe(true);
			const ownerView = (await api(ownerPage, 'GET', '/api/web/folders')).data.items.find(f => f.id === outside);
			expect(ownerView.shareId || '').toBe('');

			// 4. A sub-notebook created inside the share inherits it and reaches the reader.
			const fresh = await mkFolder(ownerPage, `${base}-fresh`, leaf);
			await expect.poll(async () => (await visibleFolderIds(readerPage)).has(fresh)).toBe(true);

			// 5. Stopping the share removes every level for the reader.
			const stopped = await api(ownerPage, 'DELETE', `/api/web/shares/${shareId}`);
			expect(stopped.status, stopped.text).toBeLessThan(300);
			await expect.poll(async () => {
				const ids = await visibleFolderIds(readerPage);
				return [root, sub, leaf, fresh].some(id => ids.has(id));
			}).toBe(false);
			const afterNotes = await visibleNoteIds(readerPage);
			expect(afterNotes.has(nRoot) || afterNotes.has(nLeaf)).toBe(false);

			// 6. The owner's tree no longer carries the dead share id, so everything is
			//    editable again (Joplin Server answers a write that names a deleted share
			//    with "share not found" / 422).
			const ownerFolders = (await api(ownerPage, 'GET', '/api/web/folders')).data.items;
			for (const id of [root, sub, leaf, fresh]) expect(ownerFolders.find(f => f.id === id).shareId || '', `share id cleared on ${id}`).toBe('');
			const rename = await api(ownerPage, 'PUT', `/api/web/folders/${sub}`, { title: `${base}-sub-renamed` });
			expect(rename.status, rename.text).toBe(200);
			const trashed = await api(ownerPage, 'DELETE', `/fragments/notes/${nLeaf}`);
			expect(trashed.status, trashed.text).toBe(200);
		} finally {
			await teardownTestData(ownerPage, { folderPrefixes: [base] });
		}
	});

	test('recipients cannot create, move or delete inside the owner\'s share', async ({ ownerPage, readerPage }) => {
		await acceptDialogs(ownerPage);
		await acceptDialogs(readerPage);
		const base = slug('share-nest');
		await login(ownerPage);
		try {
			const root = await mkFolder(ownerPage, `${base}-root`);
			const sub = await mkFolder(ownerPage, `${base}-sub`, root);
			await shareWithReader(ownerPage, root);
			await loginAs(readerPage, SHARE_READER_EMAIL, SHARE_READER_PASSWORD);
			await expect.poll(async () => (await visibleFolderIds(readerPage)).has(sub)).toBe(true);

			const create = await api(readerPage, 'POST', '/api/web/folders', { title: `${base}-nope`, parentId: sub });
			expect(create.status).toBe(403);
			const move = await api(readerPage, 'PUT', `/api/web/folders/${sub}`, { parentId: '' });
			expect(move.status).toBe(403);
			const del = await api(readerPage, 'DELETE', `/api/web/folders/${sub}`);
			expect(del.status).toBe(403);
			expect((await visibleFolderIds(readerPage)).has(sub)).toBe(true);
			expect((await visibleFolderIds(ownerPage)).has(sub)).toBe(true);
		} finally {
			await teardownTestData(ownerPage, { folderPrefixes: [base] });
		}
	});

	test('a nested notebook is lifted to the top level when shared; one inside a share cannot be shared again; a share root cannot be nested', async ({ ownerPage }) => {
		await acceptDialogs(ownerPage);
		const base = slug('share-nest');
		await login(ownerPage);
		try {
			const outer = await mkFolder(ownerPage, `${base}-outer`);
			const inner = await mkFolder(ownerPage, `${base}-inner`, outer);
			const innerKid = await mkFolder(ownerPage, `${base}-innerkid`, inner);

			const shareId = await shareWithReader(ownerPage, inner);
			const after = (await api(ownerPage, 'GET', '/api/web/folders')).data.items;
			expect(after.find(f => f.id === inner).parentId, 'lifted to the top level').toBe('');
			expect(after.find(f => f.id === innerKid).parentId).toBe(inner);
			expect(after.find(f => f.id === innerKid).shareId).toBe(shareId);

			// the kid is inside the share: sharing it separately is refused
			const again = await api(ownerPage, 'POST', '/api/web/shares', { notebookId: innerKid });
			expect(again.status).toBe(400);
			expect(again.data.error).toMatch(/already shared/);

			// a share root cannot be nested under another notebook
			const nest = await api(ownerPage, 'PUT', `/api/web/folders/${inner}`, { parentId: outer });
			expect(nest.status).toBe(400);
			expect(nest.data.error).toMatch(/Stop sharing/);
		} finally {
			await teardownTestData(ownerPage, { folderPrefixes: [base] });
		}
	});
});

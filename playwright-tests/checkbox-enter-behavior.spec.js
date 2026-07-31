'use strict';

// Regression coverage for the checkbox Enter-key handler in TinyMCE.
//
// Desired behaviour (matches markdown mode and typical editors):
//   1. Enter at the END of a NON-EMPTY checkbox ALWAYS inserts a new checkbox
//      item immediately after it — regardless of what follows in the document
//      (nothing, another checkbox, or a paragraph of other text). This is what
//      makes a checklist useful: you can go back to an existing list that is
//      followed by other text and keep adding items to it.
//   2. Exiting the list is done by pressing Enter on an EMPTY checkbox item
//      (i.e. double-Enter): the empty item is converted to a paragraph.
//
// The bug this guards against: a checklist followed by other text (created,
// saved, reopened) would refuse to add a new item when you pressed Enter at
// the end of the last checkbox — instead it silently exited the list. That
// made editing an existing checklist impossible; you could only append at the
// very bottom of the note.

const { test, expect } = require('@playwright/test');
const {
	acceptDialogs, login, logout, hasAdminCredentials,
	createNotebook, waitForSaved, teardownTestData,
} = require('./helpers');

async function createNoteWithBody(page, folderId, title, body) {
	const res = await page.evaluate(async ([parentId, t, b]) => {
		const r = await fetch('/api/web/notes', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ title: t, body: b, parentId }),
		});
		return { status: r.status, data: await r.json() };
	}, [folderId, title, body]);
	expect(res.status).toBe(201);
	return res.data.item.id;
}

async function openNote(page, noteId) {
	await page.evaluate((id) => {
		htmx.ajax('GET', '/fragments/editor/' + encodeURIComponent(id), { target: '#editor-panel', swap: 'innerHTML' });
	}, noteId);
	await page.waitForTimeout(2000);
}

test.describe('Checkbox Enter key behaviour', () => {
	test.beforeEach(({ page }) => acceptDialogs(page));

	test('Enter on the last checkbox at end of note creates a new checkbox', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials());

		const folder = `pw-cbend-${Date.now()}`;
		try {
			await login(page);
			await createNotebook(page, folder);
			const folderId = await page.locator(`.nav-folder[data-folder-title="${folder}"]`).getAttribute('data-folder-id');

			// Checklist is the LAST content in the note — nothing follows it.
			const body = [
				'- [x] task one',
				'- [ ] task two',
			].join('\n');
			const noteId = await createNoteWithBody(page, folderId, 'Checklist At End', body);

			await page.reload();
			await page.waitForTimeout(1500);
			await openNote(page, noteId);

			const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
			await expect(iframeBody.locator('.md-checkbox').first()).toBeVisible({ timeout: 15000 });

			const beforeCount = await iframeBody.locator('.md-checkbox').count();
			expect(beforeCount).toBe(2);

			// Click at end of last checkbox and press Enter
			const lastCb = iframeBody.locator('.md-checkbox', { hasText: 'task two' }).first();
			await lastCb.click();
			await page.keyboard.press('End');
			await page.waitForTimeout(200);
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// A new (empty) checkbox should now exist — total count increases
			const afterCount = await iframeBody.locator('.md-checkbox').count();
			expect(afterCount, 'Enter at end of checklist must add a new checkbox item').toBe(beforeCount + 1);

			await page.keyboard.type('task three');
			await page.waitForTimeout(500);
			await waitForSaved(page);

			await page.locator('#editor-panel #markdown-toggle').click();
			await page.waitForTimeout(500);
			const saved = await page.locator('#editor-panel #note-body').inputValue();
			console.log('Saved (end-of-note case):\n' + saved);

			expect(saved).toMatch(/-\s\[ \]\s*task three/);
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});

	test('Enter on the last checkbox of a list FOLLOWED BY other text still adds a checkbox', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials());

		// This is the exact user-reported regression: create a checklist, end it,
		// add some plain text below, then go back to the last checkbox and press
		// Enter — it must add a new checkbox item, NOT exit the list.
		const folder = `pw-cbmid-${Date.now()}`;
		try {
			await login(page);
			await createNotebook(page, folder);
			const folderId = await page.locator(`.nav-folder[data-folder-title="${folder}"]`).getAttribute('data-folder-id');

			const body = [
				'- [x] task one',
				'- [ ] task two',
				'',
				'some random text here',
				'more random text',
			].join('\n');
			const noteId = await createNoteWithBody(page, folderId, 'Checklist Then Text', body);

			await page.reload();
			await page.waitForTimeout(1500);
			await openNote(page, noteId);

			const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
			await expect(iframeBody.locator('.md-checkbox').first()).toBeVisible({ timeout: 15000 });

			const beforeCount = await iframeBody.locator('.md-checkbox').count();
			expect(beforeCount).toBe(2);

			// Go back to the last EXISTING checkbox and press Enter at its end.
			const lastCb = iframeBody.locator('.md-checkbox', { hasText: 'task two' }).first();
			await lastCb.click();
			await page.keyboard.press('End');
			await page.waitForTimeout(200);
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);

			// A NEW checkbox must have been created even though the list is
			// followed by plain text.
			const afterCount = await iframeBody.locator('.md-checkbox').count();
			expect(afterCount, 'Enter at end of an existing checklist item must add a checkbox even when text follows').toBe(beforeCount + 1);

			await page.keyboard.type('task three');
			await page.waitForTimeout(500);
			await waitForSaved(page);

			await page.locator('#editor-panel #markdown-toggle').click();
			await page.waitForTimeout(500);
			const saved = await page.locator('#editor-panel #note-body').inputValue();
			console.log('Saved (followed-by-text case):\n' + saved);

			// New checkbox item is present, and the following text is preserved.
			expect(saved).toMatch(/-\s\[ \]\s*task three/);
			expect(saved).toContain('some random text here');
			expect(saved).toContain('more random text');
			// The new item is a real checkbox, not plain text.
			expect(saved).not.toMatch(/^task three$/m);
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});

	test('Enter on an EMPTY checkbox exits the list (converts to paragraph)', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials());

		const folder = `pw-cbexit-${Date.now()}`;
		try {
			await login(page);
			await createNotebook(page, folder);
			const folderId = await page.locator(`.nav-folder[data-folder-title="${folder}"]`).getAttribute('data-folder-id');

			const body = [
				'- [x] task one',
				'- [ ] task two',
			].join('\n');
			const noteId = await createNoteWithBody(page, folderId, 'Checklist Exit', body);

			await page.reload();
			await page.waitForTimeout(1500);
			await openNote(page, noteId);

			const iframeBody = page.frameLocator('iframe.tox-edit-area__iframe').locator('body');
			await expect(iframeBody.locator('.md-checkbox').first()).toBeVisible({ timeout: 15000 });
			expect(await iframeBody.locator('.md-checkbox').count()).toBe(2);

			// Enter at end of last item -> new empty checkbox (count 3).
			const lastCb = iframeBody.locator('.md-checkbox', { hasText: 'task two' }).first();
			await lastCb.click();
			await page.keyboard.press('End');
			await page.waitForTimeout(200);
			await page.keyboard.press('Enter');
			await page.waitForTimeout(400);
			expect(await iframeBody.locator('.md-checkbox').count()).toBe(3);

			// Enter again on the now-empty checkbox -> exit the list (back to 2).
			await page.keyboard.press('Enter');
			await page.waitForTimeout(400);
			expect(
				await iframeBody.locator('.md-checkbox').count(),
				'Enter on an empty checkbox must remove it and exit the list',
			).toBe(2);

			// Typing now produces plain text, not a checkbox item.
			await page.keyboard.type('plain exit text');
			await page.waitForTimeout(500);
			await waitForSaved(page);

			await page.locator('#editor-panel #markdown-toggle').click();
			await page.waitForTimeout(500);
			const saved = await page.locator('#editor-panel #note-body').inputValue();
			console.log('Saved (empty-item exit case):\n' + saved);

			expect(saved).toContain('plain exit text');
			expect(saved).not.toMatch(/-\s\[.\]\s*plain exit text/);
		} finally {
			await teardownTestData(page, { folders: [folder] });
			await logout(page).catch(() => {});
		}
	});
});

'use strict';

const path = require('path');
const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	hasAdminCredentials,
	login,
	logout,
	setNoteBody,
	setNoteTitle,
	teardownTestData,
	waitForSaved,
} = require('./helpers');

const TEST_IMAGE = path.resolve(__dirname, '..', 'public', 'icon-192.png');

test.describe('Resource lifecycle', () => {
	test('upload, verify not orphaned, remove reference, verify orphaned, cleanup', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		test.skip(!hasAdminCredentials(), 'Set JOPLOCK_ADMIN_EMAIL/JOPLOCK_ADMIN_PASSWORD (or PLAYWRIGHT_ADMIN_*) for the admin resource-lifecycle test');
		acceptDialogs(page);

		const folderName = `res-lifecycle-${Date.now()}`;
		const noteTitle = `Resource lifecycle ${Date.now()}`;
		let resourceId = null;

		// --- helper to clean up even on failure ---
		async function runCleanup() {
			// Purge the test notebook's notes + the notebook + any orphaned resources.
			await teardownTestData(page, { folders: [folderName] });
			try {
				await logout(page).catch(() => {});
			} catch {}
		}

		try {

		// Login as admin (credentials resolved from the environment by the helper).
		await login(page);

		// 1. Create notebook and note
		await createNotebook(page, folderName);
		await createDesktopNote(page, folderName);
		await setNoteTitle(page, noteTitle);

		// 2. Set initial note body in markdown mode
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		await setNoteBody(page, 'Resource test anchor text.');
		await waitForSaved(page);

		// 3. Switch to rich (TinyMCE) mode
		await page.locator('#editor-panel #preview-toggle').click();
		await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });

		// 4. Open upload modal and upload the test image
		await page.evaluate(() => window.openUploadModal());
		await expect(page.locator('#upload-modal')).toBeVisible({ timeout: 5000 });
		await page.locator('#upload-modal-file-input').setInputFiles(TEST_IMAGE);

		// 5. Wait for upload to complete (insert button enabled)
		await expect(page.locator('#upload-insert-btn')).not.toBeDisabled({ timeout: 15000 });

		// 6. Insert the uploaded file. On full success the modal auto-dismisses
		// (and inserts) on its own; only click Insert if it is still open.
		if (await page.locator('#upload-modal').isVisible()) {
			await page.locator('#upload-insert-btn').click().catch(() => {});
		}
		await expect(page.locator('#upload-modal')).toBeHidden({ timeout: 10000 });

		// 7. Force save via mode toggle (syncs TinyMCE -> markdown -> save)
		await page.waitForTimeout(4000);
		await page.locator('#editor-panel #markdown-toggle').click();
		await page.waitForTimeout(1000);
		await page.locator('#editor-panel #preview-toggle').click();
		await page.waitForTimeout(2000);
		await waitForSaved(page);
		await page.waitForTimeout(1500);

		// 8. Switch to markdown mode and verify the resource reference is in the body
		await page.locator('#editor-panel #markdown-toggle').click();
		await expect(page.locator('#editor-panel .cm-content')).toBeVisible({ timeout: 15000 });
		const bodyText = await page.locator('#editor-panel #note-body').inputValue();
		const resourceMatch = bodyText.match(/!\[[^\]]*\]\(:\/([0-9a-fA-F]{32})\)/);
		expect(resourceMatch, 'Note body should contain a resource reference like ![...](:/<32-hex>)').toBeTruthy();
		resourceId = resourceMatch[1];
		expect(resourceId).toHaveLength(32);

		// 9. Helpers to call admin API from within the page context
		async function adminFetch(url, method = 'GET') {
			const result = await page.evaluate(async ({ url, method }) => {
				const res = await fetch(url, { method, credentials: 'same-origin' });
				const text = await res.text();
				return { status: res.status, text };
			}, { url, method });
			let data;
			try { data = JSON.parse(result.text); } catch { data = { error: result.text.slice(0, 100) }; }
			return { status: result.status, data };
		}
		async function getOrphanedIds() {
			const result = await page.evaluate(async () => {
				const res = await fetch('/admin/orphaned-resources/ids', { credentials: 'same-origin' });
				const text = await res.text();
				try { return JSON.parse(text); } catch { return []; }
			});
			return Array.isArray(result) ? result : [];
		}

		// 10. Verify resource exists (GET /resources/:id returns 200)
		const imageStatus = await page.evaluate(async (id) => {
			const res = await fetch('/resources/' + id, { credentials: 'same-origin' });
			return res.status;
		}, resourceId);
		expect(imageStatus, `Resource ${resourceId} should be accessible`).toBe(200);

		// 11. Verify the specific resource is NOT orphaned
		let orphanedIds = await getOrphanedIds();
		expect(orphanedIds, `Resource ${resourceId} should not be orphaned while referenced`).not.toContain(resourceId);

		// 12. Remove the resource reference from the note body
		const cleanedBody = bodyText.replace(resourceMatch[0], '').trim();
		expect(cleanedBody).not.toContain(':/');
		await setNoteBody(page, cleanedBody);
		await page.evaluate(() => {
			var form = document.querySelector('#editor-panel #note-editor-form');
			if (form) form.dispatchEvent(new CustomEvent('joplock:save', {bubbles: true}));
		});
		await waitForSaved(page);
		await page.waitForTimeout(1000);

		const taValue = await page.locator('#editor-panel #note-body').inputValue();
		expect(taValue, 'Textarea should have cleaned body').not.toContain(':/');

		// 13. Verify the resource is NOW orphaned
		await expect.poll(async () => {
			const ids = await getOrphanedIds();
			return ids.includes(resourceId);
		}, { timeout: 10000, message: `Resource ${resourceId} should become orphaned after removing reference` }).toBe(true);

		// 14. Clean up orphaned resources
		const { status: cleanupStatus, data: cleanupData } = await adminFetch('/admin/orphaned-resources/cleanup', 'POST');
		expect(cleanupStatus).toBe(200);
		expect(cleanupData.deleted, 'Should delete at least one orphan').toBeGreaterThanOrEqual(1);
		expect(cleanupData.failed).toBe(0);

		// 15. Verify the resource no longer exists
		const missingStatus = await page.evaluate(async (id) => {
			const res = await fetch('/resources/' + id, { credentials: 'same-origin' });
			return res.status;
		}, resourceId);
		expect([404, 500]).toContain(missingStatus);

		// 16. Verify the specific resource is no longer orphaned
		orphanedIds = await getOrphanedIds();
		expect(orphanedIds, `Resource ${resourceId} should be gone after cleanup`).not.toContain(resourceId);

		} finally {
			await runCleanup();
		}
	});
});

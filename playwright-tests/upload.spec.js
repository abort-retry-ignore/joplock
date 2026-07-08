'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	ensureMobileFoldersScreen,
	getActiveNoteId,
	login,
	logout,
	openMobileFolder,
	setNoteBody,
	setNoteTitle,
	teardownTestData,
	waitForSaved,
} = require('./helpers');

const TEST_IMAGE = path.resolve(__dirname, '..', 'public', 'icon-192.png');

test.describe('Uploads', () => {
	test('mobile single image upload inserts uploaded image and emits request', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);

		const consoleMessages = [];
		const pageErrors = [];
		const uploadRequests = [];
		page.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
		page.on('pageerror', error => pageErrors.push(error.message));
		page.on('request', request => {
			if (request.url().includes('/fragments/upload')) uploadRequests.push(request.url());
		});

		let noteId = '';
		try {
			await login(page);
			await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
			await ensureMobileFoldersScreen(page);
			await openMobileFolder(page, 'All Notes');
			await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
			await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
			await page.locator('#mobile-preview-toggle').click();
			await expect(page.locator('#mobile-editor-body #note-preview')).toBeVisible();

			const uploadInput = page.locator('#mobile-editor-body #file-upload');
			await expect(uploadInput).toHaveCount(1);
			await uploadInput.setInputFiles(TEST_IMAGE);

			await expect.poll(() => uploadRequests.length, { timeout: 15000 }).toBeGreaterThan(0);
			await expect(page.locator('#mobile-editor-body #note-preview img.preview-img')).toHaveCount(1, { timeout: 15000 });
			expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
			expect(consoleMessages.filter(msg => /error|ReferenceError|TypeError/i.test(msg)), `console messages: ${consoleMessages.join('\n')}`).toEqual([]);
			noteId = await getActiveNoteId(page);
		} finally {
			await teardownTestData(page, { noteIds: noteId ? [noteId] : [] });
			await logout(page).catch(() => {});
		}
	});

	test('mobile multi-image upload preserves sequence and note title', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);

		const uploadRequests = [];
		page.on('request', request => {
			if (request.url().includes('/fragments/upload')) uploadRequests.push(request.url());
		});

		let noteId = '';
		try {
			await login(page);
			await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
			await ensureMobileFoldersScreen(page);
			await openMobileFolder(page, 'All Notes');
			await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
			await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();

			await page.locator('#mobile-md-toggle').click();
			await setNoteBody(page, 'Anchor line');
			await waitForSaved(page);

			await page.locator('#mobile-preview-toggle').click();
			await expect(page.locator('#mobile-editor-body #note-preview')).toBeVisible();

			const imageBuffer = fs.readFileSync(TEST_IMAGE);
			await page.locator('#mobile-editor-body #file-upload').setInputFiles([
				{ name: 'first-image.png', mimeType: 'image/png', buffer: imageBuffer },
				{ name: 'second-image.png', mimeType: 'image/png', buffer: imageBuffer },
			]);

			await expect.poll(() => uploadRequests.length, { timeout: 15000 }).toBe(2);
			await expect(page.locator('#mobile-editor-body #note-preview img.preview-img')).toHaveCount(2, { timeout: 15000 });
			await expect.poll(async () => page.locator('#mobile-editor-body #note-preview img.preview-img').evaluateAll(nodes => nodes.map(node => node.getAttribute('alt'))), { timeout: 15000 }).toEqual(['first-image.png', 'second-image.png']);
			await expect(page.locator('#mobile-editor-body .editor-title-hidden')).toHaveValue('Anchor line');
			noteId = await getActiveNoteId(page);
		} finally {
			await teardownTestData(page, { noteIds: noteId ? [noteId] : [], titlePrefixes: ['Anchor line'] });
			await logout(page).catch(() => {});
		}
	});

	test('mobile image-only upload does not promote filename to note title', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);

		let noteId = '';
		try {
			await login(page);
			await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
			await ensureMobileFoldersScreen(page);
			await openMobileFolder(page, 'All Notes');
			await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
			await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
			await page.locator('#mobile-preview-toggle').click();
			await expect(page.locator('#mobile-editor-body #note-preview')).toBeVisible();

			await page.locator('#mobile-editor-body #file-upload').setInputFiles(TEST_IMAGE);

			await expect(page.locator('#mobile-editor-body #note-preview img.preview-img')).toHaveCount(1, { timeout: 15000 });
			await expect(page.locator('#mobile-editor-body .editor-title-hidden')).toHaveValue('Untitled note', { timeout: 15000 });
			noteId = await getActiveNoteId(page);
		} finally {
			await teardownTestData(page, { noteIds: noteId ? [noteId] : [] });
			await logout(page).catch(() => {});
		}
	});

	test('mobile multi-image upload on blank note shows both images', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile');
		acceptDialogs(page);

		let noteId = '';
		try {
			await login(page);
			await expect(page.locator('#mobile-folders-body')).toContainText('All Notes', { timeout: 15000 });
			await ensureMobileFoldersScreen(page);
			await openMobileFolder(page, 'All Notes');
			await page.locator('#mobile-notes-screen .mobile-header-btn[title="New note"]').click();
			await expect(page.locator('#mobile-editor-screen.mobile-screen-active')).toBeVisible();
			await page.locator('#mobile-preview-toggle').click();
			await expect(page.locator('#mobile-editor-body #note-preview')).toBeVisible();

			const imageBuffer = fs.readFileSync(TEST_IMAGE);
			await page.locator('#mobile-editor-body #file-upload').setInputFiles([
				{ name: 'blank-first.png', mimeType: 'image/png', buffer: imageBuffer },
				{ name: 'blank-second.png', mimeType: 'image/png', buffer: imageBuffer },
			]);

			await expect(page.locator('#mobile-editor-body #note-preview img.preview-img')).toHaveCount(2, { timeout: 15000 });
			await expect.poll(async () => page.locator('#mobile-editor-body #note-preview img.preview-img').evaluateAll(nodes => nodes.map(node => node.getAttribute('alt'))), { timeout: 15000 }).toEqual(['blank-first.png', 'blank-second.png']);
			await expect(page.locator('#mobile-editor-body .editor-title-hidden')).toHaveValue('Untitled note', { timeout: 15000 });
			noteId = await getActiveNoteId(page);
		} finally {
			await teardownTestData(page, { noteIds: noteId ? [noteId] : [] });
			await logout(page).catch(() => {});
		}
	});

	test('desktop multi-image upload after existing text keeps both images in order', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);

		let noteId = '';
		try {
			await login(page);
			await page.locator('.nav-folder-title', { hasText: 'All Notes' }).first().click();
			await createDesktopNote(page, 'All Notes');
			await page.locator('#editor-panel #markdown-toggle').click();
			await expect.poll(async () => page.locator('#editor-panel #note-editor-form').evaluate(form => form.dataset.editorMode || ''), { timeout: 15000 }).toBe('markdown');
			await setNoteBody(page, 'Desktop anchor line');
			await page.waitForTimeout(2500);

			const imageBuffer = fs.readFileSync(TEST_IMAGE);
			await page.locator('#editor-panel #file-upload').setInputFiles([
				{ name: 'desktop-existing-first.png', mimeType: 'image/png', buffer: imageBuffer },
				{ name: 'desktop-existing-second.png', mimeType: 'image/png', buffer: imageBuffer },
			]);

			// Both images must land in the markdown body, in the order selected, and
			// the anchor text must survive. Read the source of truth (#note-body).
			const noteBody = page.locator('#editor-panel #note-body');
			await expect.poll(async () => {
				const v = await noteBody.inputValue();
				return (v.match(/!\[[^\]]*\]\(:\/[0-9a-fA-F]{32}\)/g) || []).length;
			}, { timeout: 15000 }).toBeGreaterThanOrEqual(2);

			const body = await noteBody.inputValue();
			expect(body).toContain('Desktop anchor line');
			const firstIdx = body.indexOf('desktop-existing-first.png');
			const secondIdx = body.indexOf('desktop-existing-second.png');
			expect(firstIdx, 'first image must be present').toBeGreaterThanOrEqual(0);
			expect(secondIdx, 'second image must be present').toBeGreaterThanOrEqual(0);
			expect(firstIdx, 'images must keep upload order').toBeLessThan(secondIdx);

			// Image filenames must not be promoted into the note title.
			await expect(page.locator('#editor-panel .editor-title-hidden')).toHaveValue('Desktop anchor line');
			noteId = await getActiveNoteId(page);
		} finally {
			await teardownTestData(page, { noteIds: noteId ? [noteId] : [], titlePrefixes: ['Desktop anchor line'] });
			await logout(page).catch(() => {});
		}
	});
});

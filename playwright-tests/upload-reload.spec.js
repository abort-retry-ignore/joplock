'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
	acceptDialogs,
	createDesktopNote,
	createNotebook,
	deleteNotebook,
	login,
	logout,
	setNoteBody,
	setNoteTitle,
	waitForSaved,
} = require('./helpers');

const TEST_IMAGE = path.resolve(__dirname, '..', 'public', 'icon-192.png');

const RESOURCE_REF_RE = /!\[[^\]]*\]\(:\/[0-9a-fA-F]{32}\)/;

async function waitForAutosaveComplete(page) {
	await page.waitForTimeout(2500);
	await waitForSaved(page);
}

async function openNoteGetBody(page, folderName, noteTitle) {
	await page.locator('.nav-folder-title', { hasText: folderName }).first().click();
	await page.waitForTimeout(1000);
	const noteBtn = page.locator('.notelist-item-title', { hasText: noteTitle }).first();
	await expect(noteBtn).toBeVisible({ timeout: 15000 });
	await noteBtn.click();
	await expect(page.locator('#editor-panel #note-editor-form')).toBeVisible({ timeout: 10000 });
	await page.locator('#editor-panel #markdown-toggle').click();
	return page.locator('#editor-panel #note-body').inputValue();
}

test.describe('Upload reload persistence', () => {
	test('upload-modal inserts resource, saves, survives reload', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);

		const folderName = `up-mod-${Date.now()}`;
		const noteTitle = `Upload Modal ${Date.now()}`;
		let resourceId = null;

		try {
			await login(page);
			await createNotebook(page, folderName);
			await createDesktopNote(page, folderName);
			await setNoteTitle(page, noteTitle);

			await setNoteBody(page, 'Pre-upload anchor.');
			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });

			await page.evaluate(() => window.openUploadModal());
			await expect(page.locator('#upload-modal')).toBeVisible({ timeout: 5000 });
			await page.locator('#upload-modal-file-input').setInputFiles(TEST_IMAGE);
			await expect(page.locator('#upload-modal')).toBeHidden({ timeout: 30000 });

			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #markdown-toggle').click();
			const bodyBefore = await page.locator('#editor-panel #note-body').inputValue();
			const matchBefore = bodyBefore.match(RESOURCE_REF_RE);
			expect(matchBefore, 'Should have resource ref before reload').toBeTruthy();
			resourceId = bodyBefore.match(/:\/([0-9a-fA-F]{32})/)[1];

			await page.goto('/');
			await page.waitForURL(/\/$/);
			await expect(page.locator('body.app-shell')).toBeVisible({ timeout: 15000 });

			const bodyAfter = await openNoteGetBody(page, folderName, noteTitle);
			expect(bodyAfter, 'Should have resource ref after reload').toMatch(RESOURCE_REF_RE);
			expect(bodyAfter, 'Same resource ID after reload').toContain(`:/${resourceId}`);

			await logout(page);
		} finally {
			try { await deleteNotebook(page, folderName).catch(() => {}); } catch {}
			try { await page.goto('/logout').catch(() => {}); } catch {}
		}
	});

	test('file-picker upload saves and survives reload', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);

		const folderName = `up-pkr-${Date.now()}`;
		const noteTitle = `Upload Picker ${Date.now()}`;

		try {
			await login(page);
			await createNotebook(page, folderName);
			await createDesktopNote(page, folderName);
			await setNoteTitle(page, noteTitle);

			await setNoteBody(page, 'Picker anchor.');
			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });

			await page.locator('#editor-panel #file-upload').setInputFiles(TEST_IMAGE);
			await page.waitForTimeout(1500);

			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #markdown-toggle').click();
			const bodyBefore = await page.locator('#editor-panel #note-body').inputValue();
			expect(bodyBefore, 'Should have resource ref before reload').toMatch(RESOURCE_REF_RE);

			await page.goto('/');
			await page.waitForURL(/\/$/);
			await expect(page.locator('body.app-shell')).toBeVisible({ timeout: 15000 });

			const bodyAfter = await openNoteGetBody(page, folderName, noteTitle);
			expect(bodyAfter, 'Should have resource ref after reload').toMatch(RESOURCE_REF_RE);

			await logout(page);
		} finally {
			try { await deleteNotebook(page, folderName).catch(() => {}); } catch {}
			try { await page.goto('/logout').catch(() => {}); } catch {}
		}
	});

	test('drag-drop onto TinyMCE host saves and survives reload', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);

		const folderName = `up-dnd-${Date.now()}`;
		const noteTitle = `Drag Drop ${Date.now()}`;

		try {
			await login(page);
			await createNotebook(page, folderName);
			await createDesktopNote(page, folderName);
			await setNoteTitle(page, noteTitle);

			await setNoteBody(page, 'Drop anchor.');
			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });

			const imageBuffer = fs.readFileSync(TEST_IMAGE);
			await page.evaluate(async ({ name, data, mime }) => {
				const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
				const file = new File([bytes], name, { type: mime });
				const dt = new DataTransfer();
				dt.items.add(file);
				const host = document.getElementById('tinymce-host');
				const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
				host.dispatchEvent(event);
			}, { name: 'dropped.png', data: imageBuffer.toString('base64'), mime: 'image/png' });

			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #markdown-toggle').click();
			const bodyBefore = await page.locator('#editor-panel #note-body').inputValue();
			expect(bodyBefore, 'Should have resource ref before reload').toMatch(RESOURCE_REF_RE);

			await page.goto('/');
			await page.waitForURL(/\/$/);
			await expect(page.locator('body.app-shell')).toBeVisible({ timeout: 15000 });

			const bodyAfter = await openNoteGetBody(page, folderName, noteTitle);
			expect(bodyAfter, 'Should have resource ref after reload').toMatch(RESOURCE_REF_RE);

			await logout(page);
		} finally {
			try { await deleteNotebook(page, folderName).catch(() => {}); } catch {}
			try { await page.goto('/logout').catch(() => {}); } catch {}
		}
	});

	test('drag-drop onto TinyMCE iframe saves and survives reload', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop');
		acceptDialogs(page);

		const folderName = `up-dnd2-${Date.now()}`;
		const noteTitle = `Drag Frame ${Date.now()}`;

		try {
			await login(page);
			await createNotebook(page, folderName);
			await createDesktopNote(page, folderName);
			await setNoteTitle(page, noteTitle);

			await setNoteBody(page, 'Frame drop anchor.');
			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #preview-toggle').click();
			await expect(page.locator('iframe.tox-edit-area__iframe')).toBeVisible({ timeout: 15000 });

			const imageBuffer = fs.readFileSync(TEST_IMAGE);
			await page.evaluate(async ({ name, data, mime }) => {
				const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
				const file = new File([bytes], name, { type: mime });
				const dt = new DataTransfer();
				dt.items.add(file);
				const iframe = document.querySelector('iframe.tox-edit-area__iframe');
				const body = iframe && iframe.contentDocument && iframe.contentDocument.body;
				if (!body) throw new Error('TinyMCE iframe body not found');
				const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
				body.dispatchEvent(event);
			}, { name: 'frame-dropped.png', data: imageBuffer.toString('base64'), mime: 'image/png' });

			await waitForAutosaveComplete(page);

			await page.locator('#editor-panel #markdown-toggle').click();
			const bodyBefore = await page.locator('#editor-panel #note-body').inputValue();
			expect(bodyBefore, 'Should have resource ref before reload').toMatch(RESOURCE_REF_RE);

			await page.goto('/');
			await page.waitForURL(/\/$/);
			await expect(page.locator('body.app-shell')).toBeVisible({ timeout: 15000 });

			const bodyAfter = await openNoteGetBody(page, folderName, noteTitle);
			expect(bodyAfter, 'Should have resource ref after reload').toMatch(RESOURCE_REF_RE);

			await logout(page);
		} finally {
			try { await deleteNotebook(page, folderName).catch(() => {}); } catch {}
			try { await page.goto('/logout').catch(() => {}); } catch {}
		}
	});
});
